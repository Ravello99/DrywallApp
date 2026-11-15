"""Manpower: foremen request or release crew by trade; the PM approves and picks the people.

Approved requests become crew assignments (who is on which site, from/to), which drive each
employee's calendar and which sites they can clock in at."""
from datetime import date, datetime, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

import logic as L
from core import (OFFICE_ROLES, ROLE_ADMIN, ROLE_EMPLOYEE, ROLE_FOREMAN, ROLE_PM, SPECIALTIES, calculate_expiry_info,
                  db, ensure_site_access, foremen_for_site, get_current_user, get_site_or_404, is_office, notify,
                  oid, out, require_roles, site_filter, users_with_roles)

router = APIRouter(prefix="/api", tags=["manpower"])

APPROVERS = (ROLE_ADMIN, ROLE_PM)


class ManpowerRequestIn(BaseModel):
    site_id: str
    kind: str = Field(default="request", pattern="^(request|release)$")
    specialty: Optional[str] = None            # trade needed (requests)
    count: int = Field(default=1, ge=1, le=100)
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    user_ids: List[str] = Field(default_factory=list)   # releases: who to release
    notes: Optional[str] = None


class Approval(BaseModel):
    user_ids: List[str] = Field(default_factory=list)   # requests: who to send
    notes: Optional[str] = None


class AssignmentIn(BaseModel):
    user_id: str
    site_id: str
    start_date: str
    end_date: Optional[str] = None
    notes: Optional[str] = None


def _today() -> date:
    return datetime.utcnow().date()


async def safety_flags(user_id: str) -> dict:
    """{'expired': n, 'expiring_7': n} for a person's safety documents."""
    expired = soon = 0
    async for d in db.safety_documents.find({"user_id": user_id, "expiry_date": {"$nin": [None, ""]}}):
        _, _, days = calculate_expiry_info(d.get("expiry_date"))
        if days is None:
            continue
        if days < 0:
            expired += 1
        elif days <= 7:
            soon += 1
    return {"expired": expired, "expiring_7": soon}


async def active_assignments(user_id: str, start: date, end: Optional[date]) -> List[dict]:
    result = []
    async for a in db.crew_assignments.find({"user_id": user_id}):
        if L.ranges_overlap(L.parse_date(a["start_date"]), L.parse_date(a.get("end_date")), start, end):
            result.append(a)
    return result


async def _create_assignment(user: dict, site: dict, start: date, end: Optional[date], by: dict,
                             request_id: Optional[str] = None, notes: Optional[str] = None) -> dict:
    doc = {"user_id": str(user["_id"]), "user_name": user["name"], "site_id": str(site["_id"]),
           "site_name": site["name"], "start_date": start.isoformat(), "end_date": end.isoformat() if end else None,
           "request_id": request_id, "notes": notes, "assigned_by": str(by["_id"]), "assigned_by_name": by["name"],
           "created_at": datetime.utcnow()}
    res = await db.crew_assignments.insert_one(doc)
    doc["_id"] = res.inserted_id
    await db.users.update_one({"_id": user["_id"]}, {"$addToSet": {"assigned_sites": str(site["_id"])}})
    return doc


async def _end_assignment(user_id: str, site_id: str, end: date) -> None:
    """Release someone from a site: end their open assignments there and drop the site."""
    async for a in db.crew_assignments.find({"user_id": user_id, "site_id": site_id}):
        a_end = L.parse_date(a.get("end_date"))
        if a_end is None or a_end > end:
            new_end = max(end, L.parse_date(a["start_date"]) or end)
            await db.crew_assignments.update_one({"_id": a["_id"]}, {"$set": {"end_date": new_end.isoformat()}})
    await db.users.update_one({"_id": oid(user_id, "User")}, {"$pull": {"assigned_sites": site_id}})


# ---------------------------------------------------------------- requests

@router.post("/manpower/requests")
async def create_request(body: ManpowerRequestIn,
                         current_user: dict = Depends(require_roles(*OFFICE_ROLES, ROLE_FOREMAN))):
    site = await get_site_or_404(body.site_id)
    ensure_site_access(current_user, body.site_id)
    if body.kind == "request" and body.specialty and body.specialty not in SPECIALTIES:
        raise HTTPException(status_code=400, detail="Unknown specialty")
    if body.kind == "release" and not body.user_ids:
        raise HTTPException(status_code=400, detail="Pick who to release")
    names = []
    for uid in body.user_ids:
        u = await db.users.find_one({"_id": oid(uid, "User")})
        if not u:
            raise HTTPException(status_code=404, detail="User not found")
        names.append(u["name"])
    doc = {**body.model_dump(), "user_names": names, "site_name": site["name"], "status": "pending",
           "requested_by": str(current_user["_id"]), "requested_by_name": current_user["name"],
           "created_at": datetime.utcnow()}
    res = await db.manpower_requests.insert_one(doc)
    doc["_id"] = res.inserted_id
    what = ("%d x %s" % (body.count, (body.specialty or "crew").replace("_", " "))) if body.kind == "request" \
        else "release " + ", ".join(names)
    await notify([u["_id"] for u in await users_with_roles(APPROVERS)],
                 "Manpower %s: %s" % (body.kind, site["name"]), "%s: %s" % (current_user["name"], what),
                 kind="approval", link="/manager/approvals")
    return out(doc)


@router.get("/manpower/requests")
async def list_requests(site_id: Optional[str] = Query(None), status: Optional[str] = Query(None),
                        current_user: dict = Depends(require_roles(*OFFICE_ROLES, ROLE_FOREMAN))):
    q = site_filter(current_user, site_id)
    if status:
        q["status"] = {"$in": status.split(",")}
    return [out(d) for d in await db.manpower_requests.find(q).sort("created_at", -1).to_list(1000)]


@router.get("/manpower/available")
async def available_crew(specialty: Optional[str] = Query(None), start_date: Optional[str] = Query(None),
                         end_date: Optional[str] = Query(None),
                         current_user: dict = Depends(require_roles(*OFFICE_ROLES))):
    """Employees and foremen, best matches first: right trade, free on those dates, safety docs OK."""
    start = L.parse_date(start_date) or _today()
    end = L.parse_date(end_date)
    people = await db.users.find({"role": {"$in": [ROLE_EMPLOYEE, ROLE_FOREMAN]}, "active": {"$ne": False}}) \
        .sort("name", 1).to_list(5000)
    result = []
    for u in people:
        uid = str(u["_id"])
        busy = await active_assignments(uid, start, end)
        flags = await safety_flags(uid)
        matches = bool(specialty) and specialty in (u.get("specialties") or [])
        result.append({"id": uid, "name": u["name"], "role": u["role"], "level": u.get("level"),
                       "specialties": u.get("specialties") or [], "matches_specialty": matches,
                       "available": not busy, "busy_at": sorted({a["site_name"] for a in busy}),
                       "safety_expired": flags["expired"], "safety_expiring_7": flags["expiring_7"]})
    result.sort(key=lambda p: (not p["matches_specialty"], not p["available"], p["safety_expired"] > 0, p["name"]))
    return result


@router.post("/manpower/requests/{request_id}/approve")
async def approve(request_id: str, body: Approval, current_user: dict = Depends(require_roles(*APPROVERS))):
    r = await db.manpower_requests.find_one({"_id": oid(request_id, "Request")})
    if not r:
        raise HTTPException(status_code=404, detail="Request not found")
    if r["status"] != "pending":
        raise HTTPException(status_code=400, detail="This request has already been %s" % r["status"])
    site = await get_site_or_404(r["site_id"])
    foremen = [f["_id"] for f in await foremen_for_site(r["site_id"])]
    if r["kind"] == "request":
        if not body.user_ids:
            raise HTTPException(status_code=400, detail="Pick who to send to the site")
        start = L.parse_date(r.get("start_date")) or _today()
        end = L.parse_date(r.get("end_date"))
        names = []
        for uid in body.user_ids:
            u = await db.users.find_one({"_id": oid(uid, "User")})
            if not u:
                raise HTTPException(status_code=404, detail="User not found")
            await _create_assignment(u, site, start, end, current_user, request_id, r.get("notes"))
            names.append(u["name"])
            await notify([uid], "You're assigned to " + site["name"],
                         "Starting %s%s" % (start.isoformat(), (" until " + end.isoformat()) if end else ""),
                         kind="assignment", link="/worker/calendar")
        update = {"assigned_user_ids": body.user_ids, "assigned_user_names": names}
        await notify(foremen + [r["requested_by"]], "Crew approved for " + site["name"], ", ".join(names),
                     kind="request", link="/worker/requests")
    else:
        end = L.parse_date(r.get("end_date")) or _today()
        for uid in r["user_ids"]:
            await _end_assignment(uid, r["site_id"], end)
            await notify([uid], "Released from " + site["name"], "Last day: %s" % end.isoformat(),
                         kind="assignment", link="/worker/calendar")
        update = {}
        await notify(foremen + [r["requested_by"]], "Release approved for " + site["name"],
                     ", ".join(r.get("user_names") or []), kind="request", link="/worker/requests")
    update.update({"status": "approved", "decision_notes": body.notes, "decided_by": str(current_user["_id"]),
                   "decided_by_name": current_user["name"], "decided_at": datetime.utcnow()})
    await db.manpower_requests.update_one({"_id": r["_id"]}, {"$set": update})
    return out(await db.manpower_requests.find_one({"_id": r["_id"]}))


@router.post("/manpower/requests/{request_id}/reject")
async def reject(request_id: str, body: Approval, current_user: dict = Depends(require_roles(*APPROVERS))):
    r = await db.manpower_requests.find_one({"_id": oid(request_id, "Request")})
    if not r:
        raise HTTPException(status_code=404, detail="Request not found")
    if r["status"] != "pending":
        raise HTTPException(status_code=400, detail="This request has already been %s" % r["status"])
    await db.manpower_requests.update_one({"_id": r["_id"]}, {"$set": {
        "status": "rejected", "decision_notes": body.notes, "decided_by": str(current_user["_id"]),
        "decided_by_name": current_user["name"], "decided_at": datetime.utcnow()}})
    await notify([r["requested_by"]], "Manpower %s not approved: %s" % (r["kind"], r["site_name"]),
                 body.notes or "", kind="request", link="/worker/requests")
    return out(await db.manpower_requests.find_one({"_id": r["_id"]}))


# ---------------------------------------------------------------- assignments & calendar

@router.get("/crew/assignments")
async def list_assignments(site_id: Optional[str] = Query(None), user_id: Optional[str] = Query(None),
                           current_only: bool = Query(False), current_user: dict = Depends(get_current_user)):
    if is_office(current_user):
        q = {}
        if site_id:
            q["site_id"] = site_id
        if user_id:
            q["user_id"] = user_id
    elif current_user.get("role") == ROLE_FOREMAN:
        q = site_filter(current_user, site_id)
    else:
        q = {"user_id": str(current_user["_id"])}
    docs = await db.crew_assignments.find(q).sort("start_date", -1).to_list(5000)
    if current_only:
        today = _today()
        docs = [d for d in docs if L.ranges_overlap(L.parse_date(d["start_date"]), L.parse_date(d.get("end_date")),
                                                    today, today)]
    return [out(d) for d in docs]


@router.post("/crew/assignments")
async def create_assignment(body: AssignmentIn, current_user: dict = Depends(require_roles(*APPROVERS))):
    user = await db.users.find_one({"_id": oid(body.user_id, "User")})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    site = await get_site_or_404(body.site_id)
    start = L.parse_date(body.start_date)
    if not start:
        raise HTTPException(status_code=400, detail="Start date is required")
    end = L.parse_date(body.end_date)
    if end and end < start:
        raise HTTPException(status_code=400, detail="End date is before the start date")
    doc = await _create_assignment(user, site, start, end, current_user, notes=body.notes)
    await notify([body.user_id], "You're assigned to " + site["name"], "Starting " + start.isoformat(),
                 kind="assignment", link="/worker/calendar")
    return out(doc)


@router.delete("/crew/assignments/{assignment_id}")
async def delete_assignment(assignment_id: str, current_user: dict = Depends(require_roles(*APPROVERS))):
    a = await db.crew_assignments.find_one({"_id": oid(assignment_id, "Assignment")})
    if not a:
        raise HTTPException(status_code=404, detail="Assignment not found")
    await db.crew_assignments.delete_one({"_id": a["_id"]})
    still = await db.crew_assignments.find_one({"user_id": a["user_id"], "site_id": a["site_id"]})
    if not still:
        await db.users.update_one({"_id": oid(a["user_id"])}, {"$pull": {"assigned_sites": a["site_id"]}})
    return {"message": "Assignment removed"}


@router.get("/me/calendar")
async def my_calendar(start: Optional[str] = Query(None), end: Optional[str] = Query(None),
                      current_user: dict = Depends(get_current_user)):
    """Day-by-day: which site I'm on, plus tasks due. Defaults to this month +/- a week."""
    today = _today()
    first = L.parse_date(start) or (today.replace(day=1) - timedelta(days=7))
    last = L.parse_date(end) or (first + timedelta(days=49))
    if (last - first).days > 120:
        raise HTTPException(status_code=400, detail="Ask for 120 days or fewer")
    uid = str(current_user["_id"])
    assignments = [a async for a in db.crew_assignments.find({"user_id": uid})]
    tasks = await db.tasks.find({"assigned_to": uid, "due_date": {"$nin": [None, ""]},
                                 "status": {"$ne": "complete"}}).to_list(1000)
    shutdowns = {str(s["_id"]): s for s in await db.sites.find({"status": "shutdown"}).to_list(1000)}
    days = []
    d = first
    while d <= last:
        sites = [{"site_id": a["site_id"], "site_name": a["site_name"],
                  "shut_down": a["site_id"] in shutdowns}
                 for a in assignments
                 if L.ranges_overlap(L.parse_date(a["start_date"]), L.parse_date(a.get("end_date")), d, d)]
        due = [{"id": str(t["_id"]), "title": t["title"], "site_name": t.get("site_name")}
               for t in tasks if L.parse_date(t.get("due_date")) == d]
        if sites or due:
            days.append({"date": d.isoformat(), "sites": sites, "tasks_due": due})
        d += timedelta(days=1)
    return {"start": first.isoformat(), "end": last.isoformat(), "days": days}
