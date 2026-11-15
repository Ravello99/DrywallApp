"""Change orders: priced extras sent to the GC, tracked until approved or rejected.
Approved change orders are added to the job's revised contract value."""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

import logic as L
from core import (OFFICE_ROLES, ROLE_ADMIN, ROLE_COORDINATOR, ROLE_PM, db, get_site_or_404, next_number, oid, out,
                  require_roles)

router = APIRouter(prefix="/api/change-orders", tags=["change orders"])

EDITORS = (ROLE_ADMIN, ROLE_PM, ROLE_COORDINATOR)
REASONS = ["owner_request", "design_change", "site_condition", "rfi_result", "schedule", "other"]
MONEY = ("amount", "approved_amount")


class ChangeOrderIn(BaseModel):
    site_id: str
    title: str = Field(min_length=3, max_length=200)
    description: Optional[str] = None
    amount: float                              # dollars; negative for a credit
    reason: str = "owner_request"
    gc_reference: Optional[str] = None
    rfi_id: Optional[str] = None
    labour_hours: Optional[float] = Field(default=None, ge=0)


class ChangeOrderUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    amount: Optional[float] = None
    reason: Optional[str] = None
    gc_reference: Optional[str] = None
    labour_hours: Optional[float] = Field(default=None, ge=0)


class ChangeOrderDecision(BaseModel):
    decision: str = Field(pattern="^(approved|rejected)$")
    approved_amount: Optional[float] = None    # if the GC approved a different amount
    response_notes: Optional[str] = None
    gc_reference: Optional[str] = None


async def _get(co_id: str) -> dict:
    co = await db.change_orders.find_one({"_id": oid(co_id, "Change order")})
    if not co:
        raise HTTPException(status_code=404, detail="Change order not found")
    return co


@router.post("")
async def create(body: ChangeOrderIn, current_user: dict = Depends(require_roles(*EDITORS))):
    site = await get_site_or_404(body.site_id)
    if body.reason not in REASONS:
        raise HTTPException(status_code=400, detail="Unknown reason")
    doc = {**body.model_dump(), "amount": L.to_cents(body.amount),
           "number": await next_number("change_orders", body.site_id), "site_name": site["name"],
           "status": "draft", "created_by": str(current_user["_id"]), "created_by_name": current_user["name"],
           "created_at": datetime.utcnow()}
    res = await db.change_orders.insert_one(doc)
    doc["_id"] = res.inserted_id
    return out(doc, MONEY)


@router.get("")
async def list_cos(site_id: Optional[str] = Query(None), status: Optional[str] = Query(None),
                   current_user: dict = Depends(require_roles(*OFFICE_ROLES))):
    q = {}
    if site_id:
        q["site_id"] = site_id
    if status:
        q["status"] = {"$in": status.split(",")}
    docs = await db.change_orders.find(q).sort([("site_name", 1), ("number", -1)]).to_list(2000)
    return [out(d, MONEY) for d in docs]


@router.put("/{co_id}")
async def update(co_id: str, body: ChangeOrderUpdate, current_user: dict = Depends(require_roles(*EDITORS))):
    co = await _get(co_id)
    if co["status"] not in ("draft", "submitted"):
        raise HTTPException(status_code=400, detail="Decided change orders can't be edited")
    data = {k: v for k, v in body.model_dump().items() if v is not None}
    if "reason" in data and data["reason"] not in REASONS:
        raise HTTPException(status_code=400, detail="Unknown reason")
    if "amount" in data:
        data["amount"] = L.to_cents(data["amount"])
    data["updated_at"] = datetime.utcnow()
    await db.change_orders.update_one({"_id": co["_id"]}, {"$set": data})
    return out(await db.change_orders.find_one({"_id": co["_id"]}), MONEY)


@router.post("/{co_id}/submit")
async def submit(co_id: str, current_user: dict = Depends(require_roles(*EDITORS))):
    co = await _get(co_id)
    if co["status"] != "draft":
        raise HTTPException(status_code=400, detail="Only drafts can be submitted")
    await db.change_orders.update_one({"_id": co["_id"]}, {"$set": {
        "status": "submitted", "submitted_at": datetime.utcnow(), "submitted_by_name": current_user["name"]}})
    return out(await db.change_orders.find_one({"_id": co["_id"]}), MONEY)


@router.post("/{co_id}/respond")
async def respond(co_id: str, body: ChangeOrderDecision, current_user: dict = Depends(require_roles(*EDITORS))):
    """Record the GC's answer."""
    co = await _get(co_id)
    if co["status"] not in ("draft", "submitted"):
        raise HTTPException(status_code=400, detail="This change order has already been %s" % co["status"])
    approved = co["amount"] if body.approved_amount is None else L.to_cents(body.approved_amount)
    update = {"status": body.decision, "response_notes": body.response_notes, "decided_at": datetime.utcnow(),
              "decided_by_name": current_user["name"],
              "approved_amount": approved if body.decision == "approved" else None}
    if body.gc_reference:
        update["gc_reference"] = body.gc_reference
    await db.change_orders.update_one({"_id": co["_id"]}, {"$set": update})
    return out(await db.change_orders.find_one({"_id": co["_id"]}), MONEY)


@router.delete("/{co_id}")
async def delete(co_id: str, current_user: dict = Depends(require_roles(*EDITORS))):
    co = await _get(co_id)
    if co["status"] != "draft":
        raise HTTPException(status_code=400, detail="Only drafts can be deleted")
    await db.change_orders.delete_one({"_id": co["_id"]})
    return {"message": "Change order deleted"}


async def approved_changes_cents(site_id: str) -> int:
    total = 0
    async for co in db.change_orders.find({"site_id": site_id, "status": "approved"}, {"approved_amount": 1}):
        total += int(co.get("approved_amount") or 0)
    return total
