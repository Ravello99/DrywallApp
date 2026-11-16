"""Passwords: change your own (required on first sign-in and after a manager reset), forgot
password (emailed link when email is set up, and the office is always notified), reset by link,
and managers giving someone a temporary password."""
import os
import secrets
import time
from collections import defaultdict, deque
from datetime import datetime
from html import escape

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from core import ROLE_ADMIN, ROLE_COORDINATOR, ROLE_PM, Token, _normalize_email, db, get_password_hash, \
    get_signed_in_user, logger, make_link_token, notify, oid, password_problem, read_link_token, require_roles, \
    token_for, user_out, users_with_roles, verify_password
from features import mailer

router = APIRouter(prefix="/api", tags=["account"])

RESET_MINUTES = 60
RESETTERS = (ROLE_ADMIN, ROLE_PM, ROLE_COORDINATOR)   # who can give someone a temporary password
_recent = defaultdict(deque)


def _limited(key: str, limit: int = 5, window: int = 3600) -> bool:
    now = time.time()
    q = _recent[key]
    while q and now - q[0] > window:
        q.popleft()
    if len(q) >= limit:
        return True
    q.append(now)
    return False


async def _set_password(user: dict, new_password: str, must_change: bool) -> dict:
    version = int(user.get("pw_version") or 0) + 1
    await db.users.update_one({"_id": user["_id"]}, {"$set": {
        "password": get_password_hash(new_password), "must_change_password": must_change, "pw_version": version,
        "password_changed_at": datetime.utcnow()}})
    return await db.users.find_one({"_id": user["_id"]})


class ChangeIn(BaseModel):
    current_password: str
    new_password: str = Field(max_length=200)


@router.post("/auth/change-password", response_model=Token)
async def change_password(body: ChangeIn, current_user: dict = Depends(get_signed_in_user)):
    if not verify_password(body.current_password, current_user["password"]):
        raise HTTPException(status_code=400, detail="Your current password isn't right")
    if body.new_password == body.current_password:
        raise HTTPException(status_code=400, detail="Choose a different password from the current one")
    problem = password_problem(body.new_password, current_user)
    if problem:
        raise HTTPException(status_code=400, detail=problem)
    user = await _set_password(current_user, body.new_password, must_change=False)
    return Token(access_token=token_for(user), token_type="bearer", user=user_out(user, user))


class ForgotIn(BaseModel):
    email: str = Field(max_length=160)


def _app_url() -> str:
    return (os.environ.get("PUBLIC_APP_URL") or "").rstrip("/")


@router.post("/auth/forgot-password")
async def forgot_password(body: ForgotIn, request: Request):
    """Always answers the same way, so it can't be used to find out who has an account."""
    ip = request.headers.get("x-forwarded-for", "").split(",")[0].strip() or (
        request.client.host if request.client else "?")
    if _limited("ip:" + ip, 10):
        raise HTTPException(status_code=429, detail="Too many requests. Try again in an hour or ask your manager.")
    try:
        email = _normalize_email(body.email)
    except ValueError:
        raise HTTPException(status_code=400, detail="Enter the email address you sign in with")
    emailed = False
    user = await db.users.find_one({"email": email})
    if user and user.get("active") is not False and not _limited("email:" + email, 3):
        link_ok = bool(_app_url())
        if mailer.configured() and link_ok:
            token = make_link_token("pw_reset", {"uid": str(user["_id"]), "pwv": int(user.get("pw_version") or 0)},
                                    RESET_MINUTES)
            url = "%s/reset-password?token=%s" % (_app_url(), token)
            name = user["name"].split(" ")[0]
            emailed = await mailer.send(
                user["email"], "Reset your VanGuard password",
                "Hi %s,\n\nUse this link to set a new password for the VanGuard app. It works once, for %d minutes:\n\n"
                "%s\n\nIf you didn't ask for this, you can ignore this email.\n" % (name, RESET_MINUTES, url),
                "<p>Hi %s,</p><p>Use this button to set a new password for the VanGuard app. It works once, for %d "
                "minutes.</p><p><a href=\"%s\" style=\"background:#0B2556;color:#fff;padding:10px 18px;border-radius:4px;"
                "text-decoration:none;font-weight:bold\">Set a new password</a></p><p>If you didn't ask for this, "
                "you can ignore this email.</p>" % (escape(name), RESET_MINUTES, escape(url)))
        office = await users_with_roles(RESETTERS)
        await notify([u["_id"] for u in office if u["_id"] != user["_id"]],
                     "%s asked to reset their password" % user["name"],
                     ("A reset link was emailed to them. " if emailed else "") +
                     "If they need help, open Team & Sites, find them and tap Reset password.",
                     kind="account", link="/manager/members")
        logger.info("Password reset requested for %s (emailed: %s)", email, emailed)
    return {"ok": True, "email_enabled": mailer.configured() and bool(_app_url())}


class ResetIn(BaseModel):
    token: str
    new_password: str = Field(max_length=200)


@router.post("/auth/reset-password", response_model=Token)
async def reset_password(body: ResetIn):
    claims = read_link_token(body.token, "pw_reset")
    user = await db.users.find_one({"_id": oid(claims.get("uid"), "Account")})
    if not user or user.get("active") is False or int(claims.get("pwv", -1)) != int(user.get("pw_version") or 0):
        raise HTTPException(status_code=400, detail="This reset link has already been used. Ask for a new one.")
    problem = password_problem(body.new_password, user)
    if problem:
        raise HTTPException(status_code=400, detail=problem)
    user = await _set_password(user, body.new_password, must_change=False)
    return Token(access_token=token_for(user), token_type="bearer", user=user_out(user, user))


def temporary_password() -> str:
    """Easy to read out over the phone: e.g. 'bold-cedar-4827'."""
    words = ["amber", "brick", "cedar", "delta", "ember", "frost", "grove", "harbor", "iron", "jade", "kite", "lumen",
             "maple", "north", "ocean", "pine", "quartz", "river", "stone", "tiger", "union", "violet", "willow", "zinc"]
    return "%s-%s-%04d" % (secrets.choice(words), secrets.choice(words), secrets.randbelow(10000))


@router.post("/users/{user_id}/reset-password")
async def manager_reset(user_id: str, current_user: dict = Depends(require_roles(*RESETTERS))):
    target = await db.users.find_one({"_id": oid(user_id, "User")})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target.get("role") == ROLE_ADMIN and current_user.get("role") != ROLE_ADMIN:
        raise HTTPException(status_code=403, detail="Only an admin can reset an admin's password")
    if str(target["_id"]) == str(current_user["_id"]):
        raise HTTPException(status_code=400, detail="Change your own password from your profile instead")
    temp = temporary_password()
    await _set_password(target, temp, must_change=True)
    await db.account_events.insert_one({"user_id": user_id, "event": "password_reset_by_manager",
                                        "by_name": current_user["name"], "at": datetime.utcnow()})
    return {"temporary_password": temp, "user_name": target["name"], "email": target["email"]}
