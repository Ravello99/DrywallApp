"""Material requests (foreman -> PM approval) and material releases to job sites.

Every release records its cost, so the share of the material budget released can be compared
with the share of the contract billed through progress draws (see projects.py). If materials
run well ahead of billing, the company is financing the job and the office gets an alert."""
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

import logic as L
from core import (OFFICE_ROLES, ROLE_ADMIN, ROLE_COORDINATOR, ROLE_FOREMAN, ROLE_PM, db, ensure_site_access,
                  foremen_for_site, get_current_user, get_site_or_404, is_office, notify, oid, out,
                  require_roles, site_filter, users_with_roles)

router = APIRouter(prefix="/api/materials", tags=["materials"])

APPROVERS = (ROLE_ADMIN, ROLE_PM)
RELEASERS = (ROLE_ADMIN, ROLE_PM, ROLE_COORDINATOR)
STATUSES = ["pending", "approved", "rejected", "released", "delivered"]


class MaterialItem(BaseModel):
    description: str = Field(min_length=1, max_length=200)
    quantity: float = Field(gt=0)
    unit: str = Field(default="ea", max_length=20)     # sheets, studs, boxes, lf, bundles...
    notes: Optional[str] = None


class MaterialRequestIn(BaseModel):
    site_id: str
    items: List[MaterialItem] = Field(min_length=1)
    needed_by: Optional[str] = None
    priority: str = Field(default="normal", pattern="^(urgent|normal|low)$")
    notes: Optional[str] = None


class Decision(BaseModel):
    notes: Optional[str] = None


class ReleaseIn(BaseModel):
    site_id: Optional[str] = None          # required when not releasing against a request
    amount: float = Field(ge=0)            # cost of the material released, dollars
    supplier: Optional[str] = None
    po_number: Optional[str] = None
    description: Optional[str] = None
    released_on: Optional[str] = None      # date; defaults to today


async def _request_or_404(request_id: str) -> dict:
    r = await db.material_requests.find_one({"_id": oid(request_id, "Request")})
    if not r:
        raise HTTPException(status_code=404, detail="Request not found")
    return r


@router.post("/requests")
async def create_request(body: MaterialRequestIn,
                         current_user: dict = Depends(require_roles(*OFFICE_ROLES, ROLE_FOREMAN))):
    site = await get_site_or_404(body.site_id)
    ensure_site_access(current_user, body.site_id)
    doc = {**body.model_dump(), "site_name": site["name"], "status": "pending",
           "requested_by": str(current_user["_id"]), "requested_by_name": current_user["name"],
           "created_at": datetime.utcnow()}
    res = await db.material_requests.insert_one(doc)
    doc["_id"] = res.inserted_id
    approvers = await users_with_roles(APPROVERS)
    await notify([u["_id"] for u in approvers], "Material request: " + site["name"],
                 "%s requested %d item(s)%s" % (current_user["name"], len(body.items),
                                                " (URGENT)" if body.priority == "urgent" else ""),
                 kind="approval", link="/manager/approvals")
    return out(doc)


@router.get("/requests")
async def list_requests(site_id: Optional[str] = Query(None), status: Optional[str] = Query(None),
                        current_user: dict = Depends(get_current_user)):
    q = site_filter(current_user, site_id)
    if status:
        q["status"] = {"$in": status.split(",")}
    docs = await db.material_requests.find(q).sort("created_at", -1).to_list(1000)
    return [out(d) for d in docs]


@router.post("/requests/{request_id}/approve")
async def approve_request(request_id: str, body: Decision, current_user: dict = Depends(require_roles(*APPROVERS))):
    r = await _request_or_404(request_id)
    if r["status"] != "pending":
        raise HTTPException(status_code=400, detail="This request has already been %s" % r["status"])
    await db.material_requests.update_one({"_id": r["_id"]}, {"$set": {
        "status": "approved", "decision_notes": body.notes, "decided_by": str(current_user["_id"]),
        "decided_by_name": current_user["name"], "decided_at": datetime.utcnow()}})
    await notify([r["requested_by"]], "Materials approved: " + r["site_name"], body.notes or "", kind="request",
                 link="/worker/requests")
    return out(await db.material_requests.find_one({"_id": r["_id"]}))


@router.post("/requests/{request_id}/reject")
async def reject_request(request_id: str, body: Decision, current_user: dict = Depends(require_roles(*APPROVERS))):
    r = await _request_or_404(request_id)
    if r["status"] != "pending":
        raise HTTPException(status_code=400, detail="This request has already been %s" % r["status"])
    await db.material_requests.update_one({"_id": r["_id"]}, {"$set": {
        "status": "rejected", "decision_notes": body.notes, "decided_by": str(current_user["_id"]),
        "decided_by_name": current_user["name"], "decided_at": datetime.utcnow()}})
    await notify([r["requested_by"]], "Materials not approved: " + r["site_name"], body.notes or "",
                 kind="request", link="/worker/requests")
    return out(await db.material_requests.find_one({"_id": r["_id"]}))


async def _record_release(site: dict, body: ReleaseIn, user: dict, request: Optional[dict] = None) -> dict:
    released_on = L.parse_date(body.released_on) or datetime.utcnow().date()
    doc = {"site_id": str(site["_id"]), "site_name": site["name"], "amount": L.to_cents(body.amount),
           "supplier": body.supplier, "po_number": body.po_number,
           "description": body.description or (", ".join(
               "%g %s %s" % (i["quantity"], i["unit"], i["description"]) for i in request["items"])
               if request else None),
           "request_id": str(request["_id"]) if request else None, "released_on": released_on.isoformat(),
           "released_by": str(user["_id"]), "released_by_name": user["name"], "created_at": datetime.utcnow()}
    res = await db.material_releases.insert_one(doc)
    doc["_id"] = res.inserted_id
    return doc


@router.post("/requests/{request_id}/release")
async def release_request(request_id: str, body: ReleaseIn, current_user: dict = Depends(require_roles(*RELEASERS))):
    """Release (order/ship) the materials for an approved request and record their cost."""
    r = await _request_or_404(request_id)
    if r["status"] not in ("approved", "pending"):
        raise HTTPException(status_code=400, detail="Only pending or approved requests can be released")
    site = await get_site_or_404(r["site_id"])
    release = await _record_release(site, body, current_user, r)
    update = {"status": "released", "release_id": str(release["_id"]), "released_at": datetime.utcnow()}
    if r["status"] == "pending":   # releasing straight away counts as approval
        update.update({"decided_by": str(current_user["_id"]), "decided_by_name": current_user["name"],
                       "decided_at": datetime.utcnow()})
    await db.material_requests.update_one({"_id": r["_id"]}, {"$set": update})
    await notify([r["requested_by"]] + [f["_id"] for f in await foremen_for_site(r["site_id"])],
                 "Materials released to " + r["site_name"],
                 "Supplier: %s%s" % (body.supplier or "n/a", (", PO " + body.po_number) if body.po_number else ""),
                 kind="request", link="/worker/requests")
    return out(release, ("amount",))


@router.post("/requests/{request_id}/delivered")
async def mark_delivered(request_id: str, current_user: dict = Depends(require_roles(*OFFICE_ROLES, ROLE_FOREMAN))):
    r = await _request_or_404(request_id)
    ensure_site_access(current_user, r["site_id"])
    await db.material_requests.update_one({"_id": r["_id"]}, {"$set": {
        "status": "delivered", "delivered_at": datetime.utcnow(), "received_by_name": current_user["name"]}})
    return out(await db.material_requests.find_one({"_id": r["_id"]}))


@router.post("/releases")
async def create_release(body: ReleaseIn, current_user: dict = Depends(require_roles(*RELEASERS))):
    """Record a material release that didn't come from a foreman request (e.g. initial stocking)."""
    if not body.site_id:
        raise HTTPException(status_code=400, detail="site_id is required")
    site = await get_site_or_404(body.site_id)
    return out(await _record_release(site, body, current_user), ("amount",))


@router.get("/releases")
async def list_releases(site_id: Optional[str] = Query(None), current_user: dict = Depends(get_current_user)):
    if not is_office(current_user):
        raise HTTPException(status_code=403, detail="Office access required")
    q = {"site_id": site_id} if site_id else {}
    docs = await db.material_releases.find(q).sort("released_on", -1).to_list(2000)
    return [out(d, ("amount",)) for d in docs]


@router.delete("/releases/{release_id}")
async def delete_release(release_id: str, current_user: dict = Depends(require_roles(ROLE_ADMIN, ROLE_PM))):
    res = await db.material_releases.delete_one({"_id": oid(release_id, "Release")})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Release not found")
    await db.material_requests.update_many({"release_id": release_id},
                                           {"$set": {"status": "approved", "release_id": None}})
    return {"message": "Release deleted"}


async def material_released_cents(site_id: str) -> int:
    total = 0
    async for r in db.material_releases.find({"site_id": site_id}, {"amount": 1}):
        total += int(r.get("amount") or 0)
    return total
