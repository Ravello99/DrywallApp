"""RFIs: foremen raise questions from site, the PM answers (after checking with the GC or
designer if needed), and both sides can track what's still open."""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

import logic as L
from core import (OFFICE_ROLES, ROLE_ADMIN, ROLE_COORDINATOR, ROLE_FOREMAN, ROLE_PM, db, ensure_site_access,
                  foremen_for_site, get_site_or_404, next_number, notify, oid, out,
                  require_roles, site_filter, users_with_roles)

router = APIRouter(prefix="/api/rfis", tags=["rfis"])

RESPONDERS = (ROLE_ADMIN, ROLE_PM, ROLE_COORDINATOR)


class RFIIn(BaseModel):
    site_id: str
    subject: str = Field(min_length=3, max_length=200)
    question: str = Field(min_length=3, max_length=5000)
    drawing_ref: Optional[str] = None          # e.g. "A-301, detail 4"
    location: Optional[str] = None             # e.g. "Level 3, corridor C"
    priority: str = Field(default="normal", pattern="^(urgent|normal|low)$")
    needed_by: Optional[str] = None
    photo: Optional[str] = None                # base64 image (optional)


class RFIResponse(BaseModel):
    response: str = Field(min_length=1, max_length=5000)
    close: bool = True
    sent_to_gc: Optional[bool] = None
    gc_reference: Optional[str] = None


class RFIForward(BaseModel):
    gc_reference: Optional[str] = None
    notes: Optional[str] = None


def rfi_out(r: dict) -> dict:
    d = out(r)
    d.pop("photo", None)
    d["has_photo"] = bool(r.get("photo"))
    due = L.parse_date(r.get("needed_by"))
    d["overdue"] = bool(due and r.get("status") == "open" and due < datetime.utcnow().date())
    return d


async def _get(rfi_id: str) -> dict:
    r = await db.rfis.find_one({"_id": oid(rfi_id, "RFI")})
    if not r:
        raise HTTPException(status_code=404, detail="RFI not found")
    return r


@router.post("")
async def create_rfi(body: RFIIn, current_user: dict = Depends(require_roles(*OFFICE_ROLES, ROLE_FOREMAN))):
    site = await get_site_or_404(body.site_id)
    ensure_site_access(current_user, body.site_id)
    if body.photo and len(body.photo) > 7_000_000:
        raise HTTPException(status_code=413, detail="Photo is too large (5 MB max)")
    doc = {**body.model_dump(), "number": await next_number("rfis", body.site_id), "site_name": site["name"],
           "status": "open", "submitted_by": str(current_user["_id"]), "submitted_by_name": current_user["name"],
           "created_at": datetime.utcnow(), "sent_to_gc": False}
    res = await db.rfis.insert_one(doc)
    doc["_id"] = res.inserted_id
    await notify([u["_id"] for u in await users_with_roles((ROLE_ADMIN, ROLE_PM))],
                 "RFI #%d: %s" % (doc["number"], site["name"]), body.subject, kind="rfi", link="/manager/projects")
    return rfi_out(doc)


@router.get("")
async def list_rfis(site_id: Optional[str] = Query(None), status: Optional[str] = Query(None),
                    current_user: dict = Depends(require_roles(*OFFICE_ROLES, ROLE_FOREMAN))):
    q = site_filter(current_user, site_id)
    if status:
        q["status"] = {"$in": status.split(",")}
    docs = await db.rfis.find(q, {"photo": 0}).sort([("status", -1), ("created_at", -1)]).to_list(2000)
    return [rfi_out(d) for d in docs]


@router.get("/{rfi_id}")
async def get_rfi(rfi_id: str, current_user: dict = Depends(require_roles(*OFFICE_ROLES, ROLE_FOREMAN))):
    r = await _get(rfi_id)
    ensure_site_access(current_user, r["site_id"])
    d = rfi_out(r)
    d["photo"] = r.get("photo")
    return d


@router.post("/{rfi_id}/forward")
async def forward_to_gc(rfi_id: str, body: RFIForward, current_user: dict = Depends(require_roles(*RESPONDERS))):
    """Mark the RFI as sent to the GC / designer (the answer will come later)."""
    r = await _get(rfi_id)
    await db.rfis.update_one({"_id": r["_id"]}, {"$set": {
        "sent_to_gc": True, "gc_reference": body.gc_reference, "forward_notes": body.notes,
        "forwarded_at": datetime.utcnow(), "forwarded_by_name": current_user["name"]}})
    return rfi_out(await db.rfis.find_one({"_id": r["_id"]}))


@router.post("/{rfi_id}/respond")
async def respond(rfi_id: str, body: RFIResponse, current_user: dict = Depends(require_roles(*RESPONDERS))):
    r = await _get(rfi_id)
    update = {"response": body.response, "status": "closed" if body.close else "answered",
              "responded_by": str(current_user["_id"]), "responded_by_name": current_user["name"],
              "responded_at": datetime.utcnow()}
    if body.sent_to_gc is not None:
        update["sent_to_gc"] = body.sent_to_gc
    if body.gc_reference:
        update["gc_reference"] = body.gc_reference
    await db.rfis.update_one({"_id": r["_id"]}, {"$set": update})
    targets = [r["submitted_by"]] + [f["_id"] for f in await foremen_for_site(r["site_id"])]
    await notify(targets, "RFI #%d answered: %s" % (r["number"], r["site_name"]), r["subject"], kind="rfi",
                 link="/worker/rfis")
    return rfi_out(await db.rfis.find_one({"_id": r["_id"]}))


@router.post("/{rfi_id}/close")
async def close(rfi_id: str, current_user: dict = Depends(require_roles(*OFFICE_ROLES, ROLE_FOREMAN))):
    r = await _get(rfi_id)
    ensure_site_access(current_user, r["site_id"])
    await db.rfis.update_one({"_id": r["_id"]}, {"$set": {"status": "closed", "closed_at": datetime.utcnow(),
                                                         "closed_by_name": current_user["name"]}})
    return rfi_out(await db.rfis.find_one({"_id": r["_id"]}))


@router.post("/{rfi_id}/reopen")
async def reopen(rfi_id: str, current_user: dict = Depends(require_roles(*OFFICE_ROLES, ROLE_FOREMAN))):
    r = await _get(rfi_id)
    ensure_site_access(current_user, r["site_id"])
    await db.rfis.update_one({"_id": r["_id"]}, {"$set": {"status": "open"}})
    return rfi_out(await db.rfis.find_one({"_id": r["_id"]}))

