"""Bid tracking for estimators and coordinators.

Bid invites arrive three ways:
  * automatically from the bid inbox (IMAP, see bid_inbox.py),
  * pasted in from an email (POST /api/bids/import-email),
  * entered by hand.
Each is sorted into Multi-Family, Small Commercial Fit-Out, Institutional or Other. When a bid
is submitted a follow-up date is set; weekly counts, win rates and due follow-ups come from
GET /api/bids/stats. A won bid can be turned into a project with one call."""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

import logic as L
from core import (DEFAULT_GEOFENCE_M, OFFICE_ROLES, ROLE_ADMIN, ROLE_COORDINATOR, ROLE_ESTIMATOR, ROLE_PM, db,
                  notify, oid, out, require_roles, users_with_roles)

router = APIRouter(prefix="/api/bids", tags=["bids"])

BID_TEAM = (ROLE_ADMIN, ROLE_COORDINATOR, ROLE_ESTIMATOR, ROLE_PM)
MONEY = ("bid_amount",)
CATEGORY_TO_JOB_TYPE = {"multi_family": "multi_family", "commercial_fit_out": "commercial_fit_out",
                        "institutional": "institutional", "other": "other"}


class BidIn(BaseModel):
    project_name: str = Field(min_length=2, max_length=200)
    general_contractor: Optional[str] = None
    contact_name: Optional[str] = None
    contact_email: Optional[str] = None
    category: Optional[str] = None            # auto-sorted from the name/notes when empty
    location: Optional[str] = None
    due_date: Optional[str] = None
    bid_amount: Optional[float] = Field(default=None, ge=0)
    estimator_id: Optional[str] = None
    notes: Optional[str] = None
    scope: Optional[str] = None               # e.g. "Framing, board, tape, ACT"


class BidUpdate(BaseModel):
    project_name: Optional[str] = None
    general_contractor: Optional[str] = None
    contact_name: Optional[str] = None
    contact_email: Optional[str] = None
    category: Optional[str] = None
    location: Optional[str] = None
    due_date: Optional[str] = None
    bid_amount: Optional[float] = Field(default=None, ge=0)
    estimator_id: Optional[str] = None
    notes: Optional[str] = None
    scope: Optional[str] = None
    status: Optional[str] = None
    follow_up_date: Optional[str] = None


class SubmitIn(BaseModel):
    bid_amount: float = Field(ge=0)
    submitted_on: Optional[str] = None
    follow_up_days: int = Field(default=7, ge=1, le=90)


class OutcomeIn(BaseModel):
    outcome: str = Field(pattern="^(won|lost|declined)$")
    notes: Optional[str] = None
    winning_amount: Optional[float] = None    # if lost, what it went for (when known)


class FollowUpIn(BaseModel):
    note: Optional[str] = None
    next_follow_up: Optional[str] = None      # date, or empty for no more follow-ups


class EmailImport(BaseModel):
    subject: str
    body: str = ""
    sender: Optional[str] = None
    received_at: Optional[str] = None


def bid_out(b: dict) -> dict:
    d = out(b, MONEY)
    d.pop("email_body", None)
    d["category_label"] = L.BID_CATEGORIES.get(b.get("category") or "other")
    today = datetime.utcnow().date()
    fu = L.parse_date(b.get("follow_up_date"))
    due = L.parse_date(b.get("due_date"))
    d["follow_up_due"] = bool(b.get("status") == "submitted" and fu and fu <= today)
    d["days_until_due"] = (due - today).days if due and b.get("status") in ("invited", "reviewing") else None
    return d


async def _get(bid_id: str) -> dict:
    b = await db.bids.find_one({"_id": oid(bid_id, "Bid")})
    if not b:
        raise HTTPException(status_code=404, detail="Bid not found")
    return b


async def _estimator_name(estimator_id: Optional[str]):
    if not estimator_id:
        return None
    u = await db.users.find_one({"_id": oid(estimator_id, "User")})
    return u["name"] if u else None


async def create_bid_from_email(subject: str, body: str, sender: Optional[str], received_at: Optional[datetime],
                                message_id: Optional[str], source: str) -> Optional[dict]:
    """Shared by the IMAP poller and the paste-in endpoint. Skips duplicates by Message-ID."""
    if message_id and await db.bids.find_one({"email_message_id": message_id}):
        return None
    category, matched = L.classify_bid(subject, body)
    due = L.extract_due_date(subject, body)
    doc = {"project_name": L.clean_project_name(subject)[:200], "general_contractor": _gc_from_sender(sender),
           "contact_email": _email_from_sender(sender), "category": category, "category_keywords": matched,
           "due_date": due.isoformat() if due else None, "status": "invited", "source": source,
           "email_subject": subject[:500], "email_from": sender, "email_body": (body or "")[:20000],
           "email_message_id": message_id, "received_at": received_at or datetime.utcnow(),
           "created_at": datetime.utcnow(), "activity": [{"at": datetime.utcnow(), "text": "Received by email"}]}
    res = await db.bids.insert_one(doc)
    doc["_id"] = res.inserted_id
    await notify([u["_id"] for u in await users_with_roles((ROLE_ESTIMATOR, ROLE_COORDINATOR))],
                 "New bid invite (%s)" % L.BID_CATEGORIES[category], doc["project_name"], kind="bid",
                 link="/manager/bids")
    return doc


def _email_from_sender(sender: Optional[str]) -> Optional[str]:
    if not sender:
        return None
    if "<" in sender and ">" in sender:
        return sender.split("<", 1)[1].split(">", 1)[0].strip().lower()
    return sender.strip().lower() if "@" in sender else None


def _gc_from_sender(sender: Optional[str]) -> Optional[str]:
    """'Jane Doe <jane@ledcor.com>' -> 'Ledcor' (a guess the estimator can correct)."""
    email = _email_from_sender(sender)
    if not email or "@" not in email:
        return None
    domain = email.split("@", 1)[1]
    generic = {"gmail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com", "live.com", "shaw.ca",
               "telus.net", "rogers.com", "buildingconnected.com", "planhub.com", "procore.com",
               "smartbidnet.com", "isqft.com"}
    if domain in generic:
        return None
    return domain.split(".")[0].replace("-", " ").title()


# ---------------------------------------------------------------- endpoints

@router.get("")
async def list_bids(status: Optional[str] = Query(None), category: Optional[str] = Query(None),
                    q: Optional[str] = Query(None), followups: bool = Query(False),
                    current_user: dict = Depends(require_roles(*BID_TEAM))):
    query = {}
    if status:
        query["status"] = {"$in": status.split(",")}
    if category:
        query["category"] = category
    if q:
        import re
        rx = {"$regex": re.escape(q), "$options": "i"}
        query["$or"] = [{"project_name": rx}, {"general_contractor": rx}, {"location": rx}]
    docs = await db.bids.find(query, {"email_body": 0}).sort([("due_date", 1), ("created_at", -1)]).to_list(5000)
    result = [bid_out(d) for d in docs]
    if followups:
        result = [b for b in result if b["follow_up_due"]]
    return result


@router.get("/stats")
async def stats(weeks: int = Query(12, ge=4, le=52), current_user: dict = Depends(require_roles(*BID_TEAM))):
    docs = await db.bids.find({}, {"email_body": 0, "activity": 0}).to_list(20000)
    s = L.bid_stats(docs, datetime.utcnow().date(), weeks)
    s["pipeline_value"] = L.to_dollars(s["pipeline_value"])
    s["categories"] = L.BID_CATEGORIES
    return s


@router.post("")
async def create_bid(body: BidIn, current_user: dict = Depends(require_roles(*BID_TEAM))):
    data = body.model_dump()
    if data.get("category") and data["category"] not in L.BID_CATEGORIES:
        raise HTTPException(status_code=400, detail="Unknown category")
    if not data.get("category"):
        data["category"], _ = L.classify_bid(data["project_name"], data.get("notes") or "")
    data["bid_amount"] = L.to_cents(data["bid_amount"]) if data.get("bid_amount") is not None else None
    data["estimator_name"] = await _estimator_name(data.get("estimator_id"))
    data.update({"status": "invited", "source": "manual", "created_at": datetime.utcnow(),
                 "created_by_name": current_user["name"],
                 "activity": [{"at": datetime.utcnow(), "text": "Added by " + current_user["name"]}]})
    res = await db.bids.insert_one(data)
    data["_id"] = res.inserted_id
    return bid_out(data)


@router.post("/import-email")
async def import_email(body: EmailImport, current_user: dict = Depends(require_roles(*BID_TEAM))):
    """Paste a bid invite email (subject + text) to add it, sorted automatically."""
    doc = await create_bid_from_email(body.subject, body.body, body.sender,
                                      datetime.combine(L.parse_date(body.received_at), datetime.min.time())
                                      if L.parse_date(body.received_at) else None, None, "pasted")
    return bid_out(doc)


# ---------------------------------------------------------------- inbox

@router.get("/inbox/status")
async def inbox_status(current_user: dict = Depends(require_roles(*OFFICE_ROLES))):
    from features.bid_inbox import inbox_config
    cfg = inbox_config()
    state = await db.app_state.find_one({"_id": "bid_inbox"}) or {}
    return {"configured": bool(cfg), "mailbox": cfg["user"] if cfg else None,
            "folder": cfg["folder"] if cfg else None, "last_check": state.get("last_check"),
            "last_error": state.get("last_error"), "last_imported": state.get("last_imported", 0),
            "poll_minutes": cfg["poll_minutes"] if cfg else None}


@router.post("/inbox/check")
async def inbox_check_now(current_user: dict = Depends(require_roles(*BID_TEAM))):
    from features.bid_inbox import check_inbox
    return await check_inbox(days=14)


@router.get("/{bid_id}")
async def get_bid(bid_id: str, current_user: dict = Depends(require_roles(*BID_TEAM))):
    b = await _get(bid_id)
    d = bid_out(b)
    d["email_body"] = b.get("email_body")
    return d


@router.put("/{bid_id}")
async def update_bid(bid_id: str, body: BidUpdate, current_user: dict = Depends(require_roles(*BID_TEAM))):
    b = await _get(bid_id)
    data = {k: v for k, v in body.model_dump().items() if v is not None}
    if data.get("category") and data["category"] not in L.BID_CATEGORIES:
        raise HTTPException(status_code=400, detail="Unknown category")
    if data.get("status") and data["status"] not in L.BID_STATUSES:
        raise HTTPException(status_code=400, detail="Unknown status")
    if "bid_amount" in data:
        data["bid_amount"] = L.to_cents(data["bid_amount"])
    if "estimator_id" in data:
        data["estimator_name"] = await _estimator_name(data["estimator_id"])
    data["updated_at"] = datetime.utcnow()
    await db.bids.update_one({"_id": b["_id"]}, {"$set": data})
    return bid_out(await db.bids.find_one({"_id": b["_id"]}))


@router.post("/{bid_id}/submit")
async def submit_bid(bid_id: str, body: SubmitIn, current_user: dict = Depends(require_roles(*BID_TEAM))):
    b = await _get(bid_id)
    if b.get("status") in ("won", "lost", "declined"):
        raise HTTPException(status_code=400, detail="This bid is already closed")
    submitted = L.parse_date(body.submitted_on) or datetime.utcnow().date()
    follow_up = L.default_follow_up(submitted, body.follow_up_days)
    await db.bids.update_one({"_id": b["_id"]}, {
        "$set": {"status": "submitted", "bid_amount": L.to_cents(body.bid_amount),
                 "submitted_at": submitted.isoformat(), "follow_up_date": follow_up.isoformat(),
                 "submitted_by_name": current_user["name"]},
        "$push": {"activity": {"at": datetime.utcnow(),
                               "text": "Submitted $%.2f by %s; follow up %s" % (body.bid_amount, current_user["name"],
                                                                                 follow_up.isoformat())}}})
    return bid_out(await db.bids.find_one({"_id": b["_id"]}))


@router.post("/{bid_id}/follow-up")
async def log_follow_up(bid_id: str, body: FollowUpIn, current_user: dict = Depends(require_roles(*BID_TEAM))):
    b = await _get(bid_id)
    nxt = L.parse_date(body.next_follow_up)
    await db.bids.update_one({"_id": b["_id"]}, {
        "$set": {"follow_up_date": nxt.isoformat() if nxt else None, "last_follow_up": datetime.utcnow()},
        "$push": {"activity": {"at": datetime.utcnow(), "text": "Followed up (%s)%s%s" % (
            current_user["name"], ": " + body.note if body.note else "",
            "; next " + nxt.isoformat() if nxt else "")}}})
    return bid_out(await db.bids.find_one({"_id": b["_id"]}))


@router.post("/{bid_id}/outcome")
async def record_outcome(bid_id: str, body: OutcomeIn, current_user: dict = Depends(require_roles(*BID_TEAM))):
    b = await _get(bid_id)
    await db.bids.update_one({"_id": b["_id"]}, {
        "$set": {"status": body.outcome, "decided_at": datetime.utcnow().date().isoformat(),
                 "outcome_notes": body.notes, "follow_up_date": None,
                 "winning_amount": L.to_cents(body.winning_amount) if body.winning_amount is not None else None},
        "$push": {"activity": {"at": datetime.utcnow(), "text": "Marked %s by %s" % (body.outcome,
                                                                                      current_user["name"])}}})
    return bid_out(await db.bids.find_one({"_id": b["_id"]}))


@router.post("/{bid_id}/create-project")
async def create_project_from_bid(bid_id: str, current_user: dict = Depends(require_roles(ROLE_ADMIN, ROLE_PM,
                                                                                         ROLE_COORDINATOR))):
    """Turn a won bid into a project (site) with its contract value and job type filled in."""
    b = await _get(bid_id)
    if b.get("status") != "won":
        raise HTTPException(status_code=400, detail="Only won bids can become projects")
    if b.get("project_id"):
        raise HTTPException(status_code=400, detail="A project was already created from this bid")
    site = {"name": b["project_name"], "address": b.get("location") or "", "location": None,
            "geofence_radius_m": DEFAULT_GEOFENCE_M, "status": "active", "general_contractor": b.get("general_contractor"),
            "job_type": CATEGORY_TO_JOB_TYPE.get(b.get("category") or "other", "other"),
            "contract_value": L.to_dollars(b.get("bid_amount")) if b.get("bid_amount") else None,
            "bid_id": str(b["_id"]), "created_at": datetime.utcnow()}
    if site["address"]:
        from server import geocode_address   # late import: server imports this module
        site["location"] = await geocode_address(site["address"])
    res = await db.sites.insert_one(site)
    await db.bids.update_one({"_id": b["_id"]}, {"$set": {"project_id": str(res.inserted_id)},
                                                 "$push": {"activity": {"at": datetime.utcnow(),
                                                                        "text": "Project created"}}})
    return {"project_id": str(res.inserted_id), "message": "Project created. Add the address/GPS, "
                                                           "budgets and crew next."}


@router.delete("/{bid_id}")
async def delete_bid(bid_id: str, current_user: dict = Depends(require_roles(ROLE_ADMIN, ROLE_COORDINATOR,
                                                                             ROLE_ESTIMATOR))):
    b = await _get(bid_id)
    await db.bids.delete_one({"_id": b["_id"]})
    return {"message": "Bid deleted"}
