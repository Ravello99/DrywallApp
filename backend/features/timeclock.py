"""Time & attendance for the office: who's on site now, force clock-out, fix hours, add a missed
shift. Admin, project managers and project coordinators. Every change keeps an audit trail on
the record (who, when, why, before/after) and the employee is notified."""
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

import logic as L
from core import ROLE_ADMIN, ROLE_COORDINATOR, ROLE_PM, db, notify, oid, require_roles

router = APIRouter(prefix="/api/timeclock", tags=["timeclock"])

TIME_ROLES = (ROLE_ADMIN, ROLE_PM, ROLE_COORDINATOR)
MAX_SHIFT_HOURS = 24


def parse_when(value: Optional[str], field: str) -> Optional[datetime]:
    """ISO time from the app (with offset, e.g. 2026-11-16T07:00:00-05:00 or ...Z) -> naive UTC,
    which is how clock records are stored. A time without an offset is taken as UTC."""
    if value in (None, ""):
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(status_code=400, detail="%s isn't a valid date and time" % field)
    if dt.tzinfo:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


def check_times(clock_in: datetime, clock_out: Optional[datetime]) -> None:
    now = datetime.utcnow() + timedelta(minutes=5)
    if clock_in > now:
        raise HTTPException(status_code=400, detail="Clock-in can't be in the future")
    if clock_out is not None:
        if clock_out > now:
            raise HTTPException(status_code=400, detail="Clock-out can't be in the future")
        if clock_out <= clock_in:
            raise HTTPException(status_code=400, detail="Clock-out has to be after clock-in")
        if (clock_out - clock_in).total_seconds() > MAX_SHIFT_HOURS * 3600:
            raise HTTPException(status_code=400, detail="A shift can't be longer than %d hours" % MAX_SHIFT_HOURS)


def hours_between(a: datetime, b: datetime) -> float:
    return round((b - a).total_seconds() / 3600, 2)


async def overlapping(user_id: str, start: datetime, end: Optional[datetime], exclude=None) -> Optional[dict]:
    end = end or datetime.utcnow()
    q = {"user_id": user_id, "clock_in": {"$lt": end}}
    if exclude is not None:
        q["_id"] = {"$ne": exclude}
    async for r in db.clock_records.find(q):
        r_end = r.get("clock_out") or datetime.utcnow()
        if r_end > start:
            return r
    return None


def record_out(r: dict) -> dict:
    hours = L.record_hours(r)
    return {
        "id": str(r["_id"]), "user_id": r["user_id"], "user_name": r.get("user_name"),
        "site_id": r.get("site_id"), "site_name": r.get("site_name"),
        "task_id": r.get("task_id"), "task_title": r.get("task_title"),
        "clock_in": r.get("clock_in"), "clock_out": r.get("clock_out"), "status": r.get("status"),
        "hours": round(hours, 2), "total_hours": r.get("total_hours"),
        "flagged": bool(r.get("flagged")), "flag_reason": r.get("flag_reason"),
        "auto_clock_out_reason": r.get("auto_clock_out_reason"),
        "edited": bool(r.get("edits")), "edits": r.get("edits", []), "manual": bool(r.get("manual")),
    }


def _fmt(dt: Optional[datetime]) -> Optional[str]:
    return dt.isoformat() + "Z" if isinstance(dt, datetime) else None


def _edit(user: dict, action: str, reason: str, before: dict, after: dict) -> dict:
    return {"at": datetime.utcnow(), "by": str(user["_id"]), "by_name": user["name"], "action": action,
            "reason": reason, "before": before, "after": after}


@router.get("/open")
async def open_shifts(current_user: dict = Depends(require_roles(*TIME_ROLES))):
    """Everyone clocked in right now, longest first."""
    rows = await db.clock_records.find({"status": "clocked_in"}).sort("clock_in", 1).to_list(2000)
    return [record_out(r) for r in rows]


@router.get("/records")
async def records(start: str = Query(...), end: str = Query(...), user_id: Optional[str] = None,
                  site_id: Optional[str] = None, current_user: dict = Depends(require_roles(*TIME_ROLES))):
    """Shifts that started between two ISO times (send the local day boundaries with offset)."""
    a, b = parse_when(start, "Start"), parse_when(end, "End")
    q = {"clock_in": {"$gte": a, "$lt": b}}
    if user_id:
        q["user_id"] = user_id
    if site_id:
        q["site_id"] = site_id
    rows = await db.clock_records.find(q).sort("clock_in", -1).to_list(5000)
    return [record_out(r) for r in rows]


class ForceOutIn(BaseModel):
    clock_out: Optional[str] = None          # default: now
    reason: str = Field(min_length=3, max_length=300)


@router.post("/records/{record_id}/force-out")
async def force_out(record_id: str, body: ForceOutIn, current_user: dict = Depends(require_roles(*TIME_ROLES))):
    r = await db.clock_records.find_one({"_id": oid(record_id, "Shift")})
    if not r:
        raise HTTPException(status_code=404, detail="Shift not found")
    if r.get("status") != "clocked_in":
        raise HTTPException(status_code=400, detail="%s is already clocked out" % r.get("user_name"))
    out_at = parse_when(body.clock_out, "Clock-out") or datetime.utcnow()
    check_times(r["clock_in"], out_at)
    update = {"clock_out": out_at, "clock_out_location": None, "total_hours": hours_between(r["clock_in"], out_at),
              "status": "clocked_out", "auto_clock_out_reason": "Clocked out by %s: %s" % (current_user["name"],
                                                                                         body.reason.strip())}
    await db.clock_records.update_one({"_id": r["_id"]}, {"$set": update, "$push": {"edits": _edit(
        current_user, "force_clock_out", body.reason.strip(), {"clock_out": None}, {"clock_out": _fmt(out_at)})}})
    await notify([r["user_id"]], "You were clocked out by %s" % current_user["name"],
                 "%s: %s h recorded. Reason: %s" % (r.get("site_name"), update["total_hours"], body.reason.strip()),
                 kind="clock", link="/worker/hours")
    return record_out(await db.clock_records.find_one({"_id": r["_id"]}))


class EditIn(BaseModel):
    clock_in: str
    clock_out: Optional[str] = None          # empty keeps an open shift open
    site_id: Optional[str] = None
    task_id: Optional[str] = None
    reason: str = Field(min_length=3, max_length=300)


async def _site_and_task(site_id: str, task_id: Optional[str]):
    site = await db.sites.find_one({"_id": oid(site_id, "Site")})
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    task = None
    if task_id:
        task = await db.tasks.find_one({"_id": oid(task_id, "Task"), "site_id": site_id})
        if not task:
            raise HTTPException(status_code=404, detail="That task isn't on this site")
    return site, task


@router.put("/records/{record_id}")
async def edit_record(record_id: str, body: EditIn, current_user: dict = Depends(require_roles(*TIME_ROLES))):
    r = await db.clock_records.find_one({"_id": oid(record_id, "Shift")})
    if not r:
        raise HTTPException(status_code=404, detail="Shift not found")
    cin = parse_when(body.clock_in, "Clock-in")
    cout = parse_when(body.clock_out, "Clock-out")
    if cout is None and r.get("status") != "clocked_in":
        raise HTTPException(status_code=400, detail="Enter a clock-out time")
    check_times(cin, cout)
    clash = await overlapping(r["user_id"], cin, cout, exclude=r["_id"])
    if clash:
        raise HTTPException(status_code=400, detail="That overlaps another shift for %s at %s"
                            % (r.get("user_name"), clash.get("site_name")))
    site_id = body.site_id or r["site_id"]
    site, task = await _site_and_task(site_id, body.task_id if body.task_id is not None else
                                      (r.get("task_id") if site_id == r["site_id"] else None))
    before = {"clock_in": _fmt(r["clock_in"]), "clock_out": _fmt(r.get("clock_out")), "site_name": r.get("site_name"),
              "hours": r.get("total_hours")}
    update = {"clock_in": cin, "site_id": site_id, "site_name": site["name"],
              "task_id": str(task["_id"]) if task else None, "task_title": task["title"] if task else None}
    if cout is not None:
        update.update({"clock_out": cout, "total_hours": hours_between(cin, cout), "status": "clocked_out"})
    after = {"clock_in": _fmt(cin), "clock_out": _fmt(cout), "site_name": site["name"],
             "hours": update.get("total_hours")}
    await db.clock_records.update_one({"_id": r["_id"]}, {"$set": update, "$push": {"edits": _edit(
        current_user, "edit", body.reason.strip(), before, after)}})
    await notify([r["user_id"]], "Your hours were updated by %s" % current_user["name"],
                 "%s: %s. Reason: %s" % (site["name"], "%s h" % after["hours"] if after["hours"] is not None
                                         else "shift still open", body.reason.strip()),
                 kind="clock", link="/worker/hours")
    return record_out(await db.clock_records.find_one({"_id": r["_id"]}))


class AddShiftIn(BaseModel):
    user_id: str
    site_id: str
    task_id: Optional[str] = None
    clock_in: str
    clock_out: str
    reason: str = Field(min_length=3, max_length=300)


@router.post("/records")
async def add_shift(body: AddShiftIn, current_user: dict = Depends(require_roles(*TIME_ROLES))):
    """Add a shift someone forgot to clock (e.g. no phone on site)."""
    worker = await db.users.find_one({"_id": oid(body.user_id, "Employee")})
    if not worker:
        raise HTTPException(status_code=404, detail="Employee not found")
    cin, cout = parse_when(body.clock_in, "Clock-in"), parse_when(body.clock_out, "Clock-out")
    if cout is None:
        raise HTTPException(status_code=400, detail="Enter a clock-out time")
    check_times(cin, cout)
    clash = await overlapping(body.user_id, cin, cout)
    if clash:
        raise HTTPException(status_code=400, detail="That overlaps another shift for %s at %s"
                            % (worker["name"], clash.get("site_name")))
    site, task = await _site_and_task(body.site_id, body.task_id)
    doc = {"user_id": body.user_id, "user_name": worker["name"], "site_id": body.site_id, "site_name": site["name"],
           "clock_in": cin, "clock_in_location": None, "clock_out": cout, "clock_out_location": None,
           "total_hours": hours_between(cin, cout), "status": "clocked_out", "synced": True,
           "pay_rate": worker.get("pay_rate"), "task_id": str(task["_id"]) if task else None,
           "task_title": task["title"] if task else None, "flagged": False, "manual": True,
           "edits": [_edit(current_user, "added", body.reason.strip(), {}, {"clock_in": _fmt(cin), "clock_out": _fmt(cout),
                                                                              "site_name": site["name"]})]}
    res = await db.clock_records.insert_one(doc)
    await notify([body.user_id], "A shift was added for you by %s" % current_user["name"],
                 "%s: %s h. Reason: %s" % (site["name"], doc["total_hours"], body.reason.strip()),
                 kind="clock", link="/worker/hours")
    doc["_id"] = res.inserted_id
    return record_out(doc)


@router.delete("/records/{record_id}")
async def delete_shift(record_id: str, reason: str = Query(..., min_length=3),
                       current_user: dict = Depends(require_roles(ROLE_ADMIN, ROLE_COORDINATOR))):
    """Remove a shift entered by mistake. The record is kept in deleted_clock_records."""
    r = await db.clock_records.find_one({"_id": oid(record_id, "Shift")})
    if not r:
        raise HTTPException(status_code=404, detail="Shift not found")
    await db.deleted_clock_records.insert_one({**r, "deleted_at": datetime.utcnow(),
                                               "deleted_by_name": current_user["name"], "delete_reason": reason})
    await db.clock_records.delete_one({"_id": r["_id"]})
    return {"ok": True}
