"""Receipts / expenses: snap a photo of a receipt and log it against a job site or "Office".

Who: admin, project coordinators, estimators, project managers and foremen can submit.
Office managers (admin, coordinators, PMs) see everything; estimators and foremen see their own.
Admin and coordinators approve, reject and mark reimbursed (for receipts paid personally).
Receipt photos are stored separately from the expense list so lists stay fast."""
import base64
import binascii
import re
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

import logic as L
from core import ACCOUNTING_ROLES, ROLE_ADMIN, ROLE_COORDINATOR, ROLE_ESTIMATOR, ROLE_FOREMAN, ROLE_PM, db, notify, \
    oid, require_roles, users_with_roles

router = APIRouter(prefix="/api/expenses", tags=["expenses"])

SUBMITTERS = (ROLE_ADMIN, ROLE_COORDINATOR, ROLE_ESTIMATOR, ROLE_PM, ROLE_FOREMAN)
SEE_ALL = {ROLE_ADMIN, ROLE_COORDINATOR, ROLE_PM}
REVIEWERS = tuple(ACCOUNTING_ROLES)
OFFICE = "office"

CATEGORIES = {
    "materials": "Materials", "tools": "Tools and small equipment", "equipment_rental": "Equipment rental",
    "fuel": "Fuel and mileage", "parking": "Parking and tolls", "meals": "Meals", "safety": "Safety gear and PPE",
    "disposal": "Disposal and bins", "office_supplies": "Office supplies", "other": "Other",
}
PAID_WITH = {"company_card": "Company card", "personal": "Paid personally (reimburse me)", "cash": "Company cash",
             "account": "On account with the supplier"}
STATUSES = ["submitted", "approved", "rejected", "reimbursed"]
MAX_IMAGE_BYTES = 8 * 1024 * 1024


class ExpenseIn(BaseModel):
    site_id: str                                   # a site id, or "office"
    vendor: str = Field(min_length=1, max_length=120)
    amount: float = Field(gt=0, le=1_000_000)      # total on the receipt, tax included
    tax: Optional[float] = Field(default=None, ge=0)   # GST/HST on the receipt, if shown
    date: str                                      # YYYY-MM-DD on the receipt
    category: str = "materials"
    paid_with: str = "company_card"
    notes: Optional[str] = Field(default=None, max_length=1000)
    receipt_image: Optional[str] = None            # base64 or data: URI (JPEG/PNG/HEIC/PDF)
    receipt_type: Optional[str] = None             # e.g. image/jpeg


class ExpenseUpdate(BaseModel):
    site_id: Optional[str] = None
    vendor: Optional[str] = Field(default=None, max_length=120)
    amount: Optional[float] = Field(default=None, gt=0, le=1_000_000)
    tax: Optional[float] = Field(default=None, ge=0)
    date: Optional[str] = None
    category: Optional[str] = None
    paid_with: Optional[str] = None
    notes: Optional[str] = Field(default=None, max_length=1000)


class ReviewIn(BaseModel):
    action: str                                    # approve | reject | reimbursed | reopen
    note: Optional[str] = Field(default=None, max_length=500)


def _decode_image(data: str, declared: Optional[str]):
    content_type = declared or "image/jpeg"
    m = re.match(r"^data:([\w/+.-]+);base64,(.*)$", data, re.S)
    if m:
        content_type, data = m.group(1), m.group(2)
    if not (content_type.startswith("image/") or content_type == "application/pdf"):
        raise HTTPException(status_code=400, detail="The receipt has to be a photo or a PDF")
    try:
        raw = base64.b64decode(data, validate=False)
    except (binascii.Error, ValueError):
        raise HTTPException(status_code=400, detail="The receipt photo couldn't be read. Take it again.")
    if len(raw) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=400, detail="The receipt photo is too large (8 MB max). Take it again.")
    if len(raw) < 100:
        raise HTTPException(status_code=400, detail="The receipt photo is empty. Take it again.")
    return content_type, base64.b64encode(raw).decode()


async def _site_name(site_id: str) -> str:
    if site_id == OFFICE:
        return "Office"
    site = await db.sites.find_one({"_id": oid(site_id, "Job")})
    if not site:
        raise HTTPException(status_code=404, detail="Job not found")
    return site["name"]


def _check_choices(data: dict) -> None:
    if data.get("category") is not None and data["category"] not in CATEGORIES:
        raise HTTPException(status_code=400, detail="Choose a category")
    if data.get("paid_with") is not None and data["paid_with"] not in PAID_WITH:
        raise HTTPException(status_code=400, detail="Choose how it was paid")
    if data.get("date") is not None:
        d = L.parse_date(data["date"])
        if not d:
            raise HTTPException(status_code=400, detail="Enter the receipt date as YYYY-MM-DD")
        if d > datetime.utcnow().date():
            raise HTTPException(status_code=400, detail="The receipt date can't be in the future")
        data["date"] = d.isoformat()
    if data.get("tax") is not None and data.get("amount") is not None and data["tax"] > data["amount"]:
        raise HTTPException(status_code=400, detail="Tax can't be more than the total")


def expense_out(e: dict) -> dict:
    amount = L.to_dollars(e.get("amount"))
    tax = L.to_dollars(e.get("tax")) if e.get("tax") is not None else None
    return {
        "id": str(e["_id"]), "site_id": e.get("site_id"), "site_name": e.get("site_name"),
        "vendor": e.get("vendor"), "amount": amount, "tax": tax,
        "subtotal": round(amount - (tax or 0), 2), "date": e.get("date"),
        "category": e.get("category"), "category_label": CATEGORIES.get(e.get("category"), e.get("category")),
        "paid_with": e.get("paid_with"), "paid_with_label": PAID_WITH.get(e.get("paid_with"), e.get("paid_with")),
        "notes": e.get("notes"), "status": e.get("status"), "has_receipt": bool(e.get("has_receipt")),
        "submitted_by": e.get("submitted_by"), "submitted_by_name": e.get("submitted_by_name"),
        "submitted_by_role": e.get("submitted_by_role"),
        "created_at": e.get("created_at"), "reviewed_by_name": e.get("reviewed_by_name"),
        "reviewed_at": e.get("reviewed_at"), "review_note": e.get("review_note"),
        "reimbursed_at": e.get("reimbursed_at"), "history": e.get("history", []),
        "needs_reimbursement": e.get("paid_with") == "personal" and e.get("status") == "approved",
    }


async def _get(expense_id: str, user: dict) -> dict:
    e = await db.expenses.find_one({"_id": oid(expense_id, "Expense")})
    if not e:
        raise HTTPException(status_code=404, detail="Expense not found")
    if user.get("role") not in SEE_ALL and e.get("submitted_by") != str(user["_id"]):
        raise HTTPException(status_code=404, detail="Expense not found")
    return e


def _event(user: dict, text: str) -> dict:
    return {"at": datetime.utcnow(), "by": user["name"], "text": text}


@router.get("/meta")
async def meta(current_user: dict = Depends(require_roles(*SUBMITTERS))):
    return {"categories": [{"value": k, "label": v} for k, v in CATEGORIES.items()],
            "paid_with": [{"value": k, "label": v} for k, v in PAID_WITH.items()],
            "statuses": STATUSES, "can_review": current_user.get("role") in REVIEWERS,
            "sees_all": current_user.get("role") in SEE_ALL}


@router.post("")
async def create(body: ExpenseIn, current_user: dict = Depends(require_roles(*SUBMITTERS))):
    data = body.model_dump()
    _check_choices(data)
    if not body.receipt_image:
        raise HTTPException(status_code=400, detail="Add a photo of the receipt")
    content_type, image = _decode_image(body.receipt_image, body.receipt_type)
    if body.site_id != OFFICE and current_user.get("role") == ROLE_FOREMAN \
            and body.site_id not in (current_user.get("assigned_sites") or []):
        raise HTTPException(status_code=403, detail="You're not assigned to that job")
    now = datetime.utcnow()
    doc = {"site_id": body.site_id, "site_name": await _site_name(body.site_id), "vendor": body.vendor.strip(),
           "amount": L.to_cents(body.amount), "tax": L.to_cents(body.tax) if body.tax is not None else None,
           "date": data["date"], "category": body.category, "paid_with": body.paid_with,
           "notes": (body.notes or "").strip() or None, "status": "submitted", "has_receipt": True,
           "submitted_by": str(current_user["_id"]), "submitted_by_name": current_user["name"],
           "submitted_by_role": current_user.get("role"), "created_at": now,
           "history": [_event(current_user, "Submitted %s" % L.money_text(L.to_cents(body.amount)))]}
    res = await db.expenses.insert_one(doc)
    await db.expense_receipts.insert_one({"expense_id": str(res.inserted_id), "content_type": content_type,
                                          "data": image, "created_at": now})
    doc["_id"] = res.inserted_id
    reviewers = [u["_id"] for u in await users_with_roles(REVIEWERS) if u["_id"] != current_user["_id"]]
    await notify(reviewers, "Receipt to review: %s %s" % (doc["vendor"], L.money_text(doc["amount"])),
                 "%s · %s · %s" % (doc["site_name"], CATEGORIES[doc["category"]], current_user["name"]),
                 kind="expense", link="/manager/expenses")
    return expense_out(doc)


@router.get("")
async def list_expenses(site_id: Optional[str] = None, status: Optional[str] = None, mine: bool = False,
                        start: Optional[str] = None, end: Optional[str] = None,
                        current_user: dict = Depends(require_roles(*SUBMITTERS))):
    q = {}
    if mine or current_user.get("role") not in SEE_ALL:
        q["submitted_by"] = str(current_user["_id"])
    if site_id:
        q["site_id"] = site_id
    if status == "to_reimburse":
        q.update({"status": "approved", "paid_with": "personal"})
    elif status:
        q["status"] = status
    if start or end:
        q["date"] = {}
        if start:
            q["date"]["$gte"] = start
        if end:
            q["date"]["$lte"] = end
    rows = await db.expenses.find(q).sort([("date", -1), ("created_at", -1)]).to_list(5000)
    return [expense_out(e) for e in rows]


@router.get("/summary")
async def summary(start: Optional[str] = None, end: Optional[str] = None,
                  current_user: dict = Depends(require_roles(*SEE_ALL))):
    q = {"status": {"$ne": "rejected"}}
    if start or end:
        q["date"] = {k: v for k, v in (("$gte", start), ("$lte", end)) if v}
    by_site, by_cat, total, pending, to_reimburse = {}, {}, 0, 0, 0
    async for e in db.expenses.find(q):
        amt = int(e.get("amount") or 0)
        total += amt
        s = by_site.setdefault(e["site_id"], {"site_id": e["site_id"], "site_name": e.get("site_name"), "amount": 0,
                                              "count": 0})
        s["amount"] += amt
        s["count"] += 1
        by_cat[e.get("category")] = by_cat.get(e.get("category"), 0) + amt
        if e.get("status") == "submitted":
            pending += 1
        if e.get("status") == "approved" and e.get("paid_with") == "personal":
            to_reimburse += amt
    return {"total": L.to_dollars(total), "pending_review": pending, "to_reimburse": L.to_dollars(to_reimburse),
            "by_site": sorted(({**s, "amount": L.to_dollars(s["amount"])} for s in by_site.values()),
                              key=lambda s: -s["amount"]),
            "by_category": sorted(({"category": k, "label": CATEGORIES.get(k, k), "amount": L.to_dollars(v)}
                                   for k, v in by_cat.items()), key=lambda c: -c["amount"])}


@router.get("/{expense_id}/receipt")
async def receipt(expense_id: str, current_user: dict = Depends(require_roles(*SUBMITTERS))):
    e = await _get(expense_id, current_user)
    r = await db.expense_receipts.find_one({"expense_id": str(e["_id"])})
    if not r:
        raise HTTPException(status_code=404, detail="No receipt photo")
    return {"content_type": r["content_type"], "data_uri": "data:%s;base64,%s" % (r["content_type"], r["data"])}


@router.put("/{expense_id}")
async def update(expense_id: str, body: ExpenseUpdate, current_user: dict = Depends(require_roles(*SUBMITTERS))):
    e = await _get(expense_id, current_user)
    reviewer = current_user.get("role") in REVIEWERS
    if not reviewer and (e.get("submitted_by") != str(current_user["_id"]) or e.get("status") != "submitted"):
        raise HTTPException(status_code=400, detail="This receipt was already reviewed; ask accounting to change it")
    data = {k: v for k, v in body.model_dump().items() if v is not None}
    _check_choices({**data, "amount": data.get("amount", L.to_dollars(e.get("amount")))})
    update_ = {}
    if "site_id" in data:
        update_["site_id"], update_["site_name"] = data["site_id"], await _site_name(data["site_id"])
    for k in ("vendor", "date", "category", "paid_with", "notes"):
        if k in data:
            update_[k] = data[k].strip() if isinstance(data[k], str) else data[k]
    if "amount" in data:
        update_["amount"] = L.to_cents(data["amount"])
    if "tax" in data:
        update_["tax"] = L.to_cents(data["tax"])
    if update_:
        await db.expenses.update_one({"_id": e["_id"]}, {"$set": update_,
                                                          "$push": {"history": _event(current_user, "Edited")}})
    return expense_out(await db.expenses.find_one({"_id": e["_id"]}))


@router.post("/{expense_id}/review")
async def review(expense_id: str, body: ReviewIn, current_user: dict = Depends(require_roles(*REVIEWERS))):
    e = await _get(expense_id, current_user)
    now = datetime.utcnow()
    transitions = {"approve": ("submitted", "approved", "Approved"), "reject": ("submitted", "rejected", "Rejected"),
                   "reimbursed": ("approved", "reimbursed", "Marked reimbursed"),
                   "reopen": (None, "submitted", "Reopened")}
    if body.action not in transitions:
        raise HTTPException(status_code=400, detail="Unknown action")
    need, new, text = transitions[body.action]
    if need and e.get("status") != need:
        raise HTTPException(status_code=400, detail="This receipt is %s, so it can't be %s"
                            % (e.get("status"), text.lower()))
    if body.action == "reject" and not (body.note or "").strip():
        raise HTTPException(status_code=400, detail="Add a short reason so they know what to fix")
    if body.action == "reimbursed" and e.get("paid_with") != "personal":
        raise HTTPException(status_code=400, detail="Only receipts paid personally are reimbursed")
    upd = {"status": new, "reviewed_by_name": current_user["name"], "reviewed_at": now,
           "review_note": (body.note or "").strip() or None}
    if new == "reimbursed":
        upd["reimbursed_at"] = now
    await db.expenses.update_one({"_id": e["_id"]}, {"$set": upd, "$push": {"history": _event(
        current_user, text + (": " + body.note.strip() if body.note and body.note.strip() else ""))}})
    if e.get("submitted_by") != str(current_user["_id"]):
        await notify([e["submitted_by"]], "Receipt %s: %s %s" % (text.lower(), e.get("vendor"),
                                                                 L.money_text(e.get("amount"))),
                     body.note or "", kind="expense", link=None)
    return expense_out(await db.expenses.find_one({"_id": e["_id"]}))


@router.delete("/{expense_id}")
async def delete(expense_id: str, current_user: dict = Depends(require_roles(*SUBMITTERS))):
    e = await _get(expense_id, current_user)
    mine_and_open = e.get("submitted_by") == str(current_user["_id"]) and e.get("status") == "submitted"
    if not (mine_and_open or current_user.get("role") == ROLE_ADMIN):
        raise HTTPException(status_code=400, detail="Only receipts that haven't been reviewed can be deleted")
    await db.expenses.delete_one({"_id": e["_id"]})
    await db.expense_receipts.delete_many({"expense_id": str(e["_id"])})
    return {"ok": True}


async def expenses_for_export(start: Optional[str], end: Optional[str], site_id: Optional[str]) -> list:
    q = {}
    if start or end:
        q["date"] = {k: v for k, v in (("$gte", start), ("$lte", end)) if v}
    if site_id:
        q["site_id"] = site_id
    return [expense_out(e) for e in await db.expenses.find(q).sort([("date", 1), ("created_at", 1)]).to_list(20000)]


async def receipt_file(expense_id: str):
    r = await db.expense_receipts.find_one({"expense_id": expense_id})
    if not r:
        return None
    ext = {"image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/heic": "heic", "image/webp": "webp",
           "application/pdf": "pdf"}.get(r["content_type"], "jpg")
    return ext, base64.b64decode(r["data"])
