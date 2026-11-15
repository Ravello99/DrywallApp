"""Screens for foremen and employees: their dashboard, hours by week, crew safety status."""
from collections import defaultdict
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Query

import logic as L
from core import ROLE_FOREMAN, calculate_expiry_info, db, get_current_user, is_foreman, oid, require_roles

router = APIRouter(prefix="/api", tags=["field"])


async def _my_safety(user_id: str) -> list:
    problems = []
    async for d in db.safety_documents.find({"user_id": user_id, "expiry_date": {"$nin": [None, ""]}}):
        _, _, days = calculate_expiry_info(d.get("expiry_date"))
        if days is not None and days <= 14:
            problems.append({"id": str(d["_id"]), "name": d.get("document_type") or d.get("file_name"),
                             "expiry_date": d.get("expiry_date"), "days_until_expiry": days,
                             "expired": days < 0})
    return sorted(problems, key=lambda p: p["days_until_expiry"])


@router.get("/me/hours")
async def my_hours(weeks: int = Query(8, ge=1, le=52), current_user: dict = Depends(get_current_user)):
    """Hours per week (Mon-Sun) and per day for the last N weeks, newest first."""
    today = datetime.utcnow().date()
    first = L.week_start(today) - timedelta(weeks=weeks - 1)
    recs = await db.clock_records.find({"user_id": str(current_user["_id"]),
                                        "clock_in": {"$gte": datetime.combine(first, datetime.min.time())}}) \
        .sort("clock_in", -1).to_list(5000)
    now = datetime.utcnow()
    by_week = defaultdict(lambda: {"hours": 0.0, "days": defaultdict(float), "records": []})
    for r in recs:
        d = r["clock_in"].date()
        wk = by_week[L.week_start(d)]
        h = L.record_hours(r, now)
        wk["hours"] += h
        wk["days"][d.isoformat()] += h
        wk["records"].append({"id": str(r["_id"]), "site_name": r.get("site_name"), "clock_in": r["clock_in"],
                              "clock_out": r.get("clock_out"), "hours": round(h, 2), "task_title": r.get("task_title"),
                              "open": r.get("status") == "clocked_in",
                              "auto_clock_out_reason": r.get("auto_clock_out_reason")})
    result = []
    for i in range(weeks):
        ws = L.week_start(today) - timedelta(weeks=i)
        w = by_week.get(ws)
        result.append({"week_start": ws.isoformat(), "week_end": (ws + timedelta(days=6)).isoformat(),
                       "hours": round(w["hours"], 2) if w else 0.0,
                       "days": {k: round(v, 2) for k, v in sorted(w["days"].items())} if w else {},
                       "records": w["records"] if w else []})
    return {"this_week": result[0]["hours"], "weeks": result}


@router.get("/field/dashboard")
async def field_dashboard(current_user: dict = Depends(get_current_user)):
    """Home screen data for foremen and employees."""
    from features.projects import crew_on_site, task_picture
    uid = str(current_user["_id"])
    today = datetime.utcnow().date()
    hours = await my_hours(1, current_user)
    on_today = []
    async for a in db.crew_assignments.find({"user_id": uid}):
        if L.ranges_overlap(L.parse_date(a["start_date"]), L.parse_date(a.get("end_date")), today, today):
            on_today.append({"site_id": a["site_id"], "site_name": a["site_name"]})
    result = {
        "hours_this_week": hours["this_week"],
        "assigned_today": on_today,
        "my_open_tasks": await db.tasks.count_documents({"assigned_to": uid, "status": {"$ne": "complete"}}),
        "pending_forms": await db.form_assignments.count_documents({"user_id": uid, "status": "pending"}),
        "my_safety": await _my_safety(uid),
        "unread_notifications": await db.notifications.count_documents({"user_id": uid, "read": False}),
    }
    if is_foreman(current_user):
        sites = []
        for sid in current_user.get("assigned_sites") or []:
            site = await db.sites.find_one({"_id": oid(sid, "Site")})
            if not site:
                continue
            crew = await crew_on_site(sid)
            tasks = await task_picture(sid)
            sites.append({"id": sid, "name": site["name"], "status": site.get("status", "active"),
                          "shutdown_reason": site.get("shutdown_reason"), "men_on_site": len(crew), "crew": crew,
                          "progress_pct": tasks["progress_pct"], "outstanding_tasks": tasks["outstanding"][:50],
                          "outstanding_count": len(tasks["outstanding"]),
                          "open_rfis": await db.rfis.count_documents({"site_id": sid,
                                                                      "status": {"$in": ["open", "answered"]}})})
        result["sites"] = sites
        result["pending_requests"] = (
            await db.material_requests.count_documents({"requested_by": uid, "status": "pending"})
            + await db.manpower_requests.count_documents({"requested_by": uid, "status": "pending"}))
    return result


@router.get("/field/crew-safety")
async def crew_safety(current_user: dict = Depends(require_roles(ROLE_FOREMAN))):
    """Everyone assigned to the foreman's sites whose safety documents are expired or expire within
    7 days, worst first."""
    my_sites = current_user.get("assigned_sites") or []
    people = await db.users.find({"assigned_sites": {"$in": my_sites}, "_id": {"$ne": current_user["_id"]}}) \
        .to_list(1000)
    rows = []
    for u in people:
        uid = str(u["_id"])
        on_site = await db.clock_records.find_one({"user_id": uid, "status": "clocked_in",
                                                   "site_id": {"$in": my_sites}})
        for d in await _my_safety(uid):
            if d["days_until_expiry"] <= 7:
                rows.append({**d, "user_id": uid, "user_name": u["name"], "on_site_now": bool(on_site)})
    return sorted(rows, key=lambda r: (not r["on_site_now"], r["days_until_expiry"]))
