"""Job sites at a glance and the per-job money picture.

Office sees everything (crew on site, labour hours and cost against budget, billing, materials
exposure, margins, open RFIs, pending requests). Foremen see only crew on site, progress and
outstanding tasks for their own sites."""
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

import logic as L
from core import (OFFICE_ROLES, PAY_RATE_VIEWERS, ROLE_FOREMAN, calculate_expiry_info, db, ensure_site_access,
                  get_site_or_404, is_office, oid, require_roles)

router = APIRouter(prefix="/api/projects", tags=["projects"])


async def crew_on_site(site_id: str) -> list:
    """Who is clocked in right now, with trade, task and safety-document problems."""
    people = []
    async for r in db.clock_records.find({"site_id": site_id, "status": "clocked_in"}).sort("clock_in", 1):
        u = await db.users.find_one({"_id": oid(r["user_id"], "User")}) if r.get("user_id") else None
        expired = soon = 0
        async for d in db.safety_documents.find({"user_id": r["user_id"], "expiry_date": {"$nin": [None, ""]}}):
            _, _, days = calculate_expiry_info(d.get("expiry_date"))
            if days is not None and days < 0:
                expired += 1
            elif days is not None and days <= 7:
                soon += 1
        people.append({"user_id": r["user_id"], "name": r.get("user_name"), "clock_in": r["clock_in"],
                       "task_title": r.get("task_title"), "role": (u or {}).get("role"),
                       "level": (u or {}).get("level"), "specialties": (u or {}).get("specialties") or [],
                       "safety_expired": expired, "safety_expiring_7": soon,
                       "flagged": bool(r.get("flagged"))})
    return people


def progress_pct(tasks: list) -> Optional[float]:
    """Budget-hour-weighted progress; plain average when there are no budgets."""
    if not tasks:
        return None
    weighted = [(t.get("budget_hours") or 0, t.get("progress_pct", 100 if t.get("status") == "complete" else 0))
                for t in tasks]
    total = sum(w for w, _ in weighted)
    if total > 0:
        return round(sum(w * p for w, p in weighted) / total, 1)
    return round(sum(p for _, p in weighted) / len(weighted), 1)


async def task_picture(site_id: str) -> dict:
    from features.tasks import hours_by_task
    tasks = await db.tasks.find({"site_id": site_id}).to_list(5000)
    hours = await hours_by_task([str(t["_id"]) for t in tasks])
    over, warning, outstanding = [], [], []
    by_scope = defaultdict(lambda: {"budget_hours": 0.0, "actual_hours": 0.0, "tasks": 0, "complete": 0})
    for t in tasks:
        h, _ = hours.get(str(t["_id"]), (0.0, 0))
        status = L.budget_status(t.get("budget_hours"), h)
        item = {"id": str(t["_id"]), "title": t["title"], "scope": t.get("scope"),
                "budget_hours": t.get("budget_hours"), "actual_hours": h, "budget_status": status,
                "status": t.get("status"), "progress_pct": t.get("progress_pct", 0),
                "assigned_to_name": t.get("assigned_to_name"), "due_date": t.get("due_date")}
        if status == "over":
            over.append(item)
        elif status == "warning":
            warning.append(item)
        if t.get("status") != "complete":
            outstanding.append(item)
        sc = by_scope[t.get("scope") or "unscoped"]
        sc["budget_hours"] += t.get("budget_hours") or 0
        sc["actual_hours"] += h
        sc["tasks"] += 1
        sc["complete"] += 1 if t.get("status") == "complete" else 0
    scopes = [{"scope": k, "label": L.SCOPES.get(k, "Other tasks"), **{kk: round(vv, 1) if isinstance(vv, float)
                                                                       else vv for kk, vv in v.items()},
               "budget_status": L.budget_status(v["budget_hours"], v["actual_hours"])}
              for k, v in by_scope.items()]
    return {"total": len(tasks), "outstanding": outstanding, "over_budget": over, "near_budget": warning,
            "progress_pct": progress_pct(tasks), "budget_hours": round(sum(t.get("budget_hours") or 0 for t in tasks), 1),
            "scopes": sorted(scopes, key=lambda s: s["label"])}


async def labour_to_date(site_id: str):
    recs = await db.clock_records.find({"site_id": site_id}, {"total_hours": 1, "clock_in": 1, "clock_out": 1,
                                                              "pay_rate": 1}).to_list(100000)
    return L.labour_totals(recs, datetime.utcnow())


async def financials(site: dict) -> dict:
    from features.change_orders import approved_changes_cents
    from features.invoices import site_billing_cents
    from features.materials import material_released_cents
    sid = str(site["_id"])
    hours, labour_cost = await labour_to_date(sid)
    billing = await site_billing_cents(sid)
    f = L.job_financials(contract=L.to_cents(site.get("contract_value")),
                         approved_changes=await approved_changes_cents(sid),
                         billed_gross=billing["billed_gross"], paid=billing["paid"],
                         holdback_held=billing["holdback_held"], labour_cost=labour_cost,
                         material_released=await material_released_cents(sid),
                         material_budget=L.to_cents(site.get("material_budget")),
                         labour_budget=L.to_cents(site.get("labour_budget")))
    money = {k: (L.to_dollars(v) if isinstance(v, int) and not isinstance(v, bool) and k not in
                 ("percent_billed", "percent_materials", "exposure_points", "margin_to_date", "projected_margin")
                 else v) for k, v in f.items()}
    money["labour_hours"] = hours
    return money


async def counts(site_id: str) -> dict:
    return {
        "open_rfis": await db.rfis.count_documents({"site_id": site_id, "status": {"$in": ["open", "answered"]}}),
        "pending_material_requests": await db.material_requests.count_documents({"site_id": site_id,
                                                                                 "status": "pending"}),
        "pending_manpower_requests": await db.manpower_requests.count_documents({"site_id": site_id,
                                                                                 "status": "pending"}),
        "pending_change_orders": await db.change_orders.count_documents({"site_id": site_id,
                                                                         "status": {"$in": ["draft", "submitted"]}}),
        "flagged_clock_records": await db.clock_records.count_documents({"site_id": site_id, "flagged": True,
                                                                         "flag_reviewed": {"$ne": True}}),
    }


async def hours_today(site_id: str) -> float:
    start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(hours=12)
    recs = await db.clock_records.find({"site_id": site_id, "clock_in": {"$gte": start}}).to_list(5000)
    return L.labour_totals(recs, datetime.utcnow())[0]


def _site_basics(site: dict) -> dict:
    return {"id": str(site["_id"]), "name": site["name"], "address": site.get("address"),
            "status": site.get("status", "active"), "shutdown_reason": site.get("shutdown_reason"),
            "project_number": site.get("project_number"), "job_type": site.get("job_type"),
            "general_contractor": site.get("general_contractor"), "has_location": bool(site.get("location"))}


@router.get("/overview")
async def overview(include_completed: bool = Query(False),
                   current_user: dict = Depends(require_roles(*OFFICE_ROLES, ROLE_FOREMAN))):
    """One card per job site for the dashboard."""
    q = {} if include_completed else {"status": {"$ne": "completed"}}
    if not is_office(current_user):
        q["_id"] = {"$in": [oid(s) for s in current_user.get("assigned_sites") or [] if s]}
    sites = await db.sites.find(q).sort("name", 1).to_list(500)
    cards = []
    for site in sites:
        sid = str(site["_id"])
        crew = await crew_on_site(sid)
        tasks = await task_picture(sid)
        card = {**_site_basics(site), "men_on_site": len(crew), "crew": crew,
                "progress_pct": tasks["progress_pct"], "outstanding_tasks": len(tasks["outstanding"]),
                "tasks_over_budget": len(tasks["over_budget"]), "tasks_near_budget": len(tasks["near_budget"]),
                "crew_safety_problems": sum(1 for c in crew if c["safety_expired"] or c["safety_expiring_7"])}
        if is_office(current_user):
            hours, labour_cost = await labour_to_date(sid)
            card.update(await counts(sid))
            card.update({"labour_hours": hours, "budget_hours": tasks["budget_hours"],
                         "hours_today": await hours_today(sid),
                         "labour_budget_status": L.budget_status(tasks["budget_hours"], hours)})
            if current_user.get("role") in PAY_RATE_VIEWERS:
                fin = await financials(site)
                card["financials"] = {k: fin[k] for k in (
                    "revised_contract", "billed_gross", "percent_billed", "percent_materials", "exposure_points",
                    "exposure_alert", "labour_cost", "costs_to_date", "margin_to_date", "projected_margin",
                    "outstanding_receivable", "cash_exposure")}
        cards.append(card)
    return cards


@router.get("/{site_id}/summary")
async def summary(site_id: str, current_user: dict = Depends(require_roles(*OFFICE_ROLES, ROLE_FOREMAN))):
    site = await get_site_or_404(site_id)
    ensure_site_access(current_user, site_id)
    crew = await crew_on_site(site_id)
    tasks = await task_picture(site_id)
    result = {**_site_basics(site), "crew": crew, "men_on_site": len(crew), "tasks": tasks}
    if is_office(current_user):
        result.update(await counts(site_id))
        result["site"] = {k: site.get(k) for k in ("contract_value", "material_budget", "labour_budget",
                                                    "start_date", "end_date", "geofence_radius_m")}
        if current_user.get("role") in PAY_RATE_VIEWERS:
            result["financials"] = await financials(site)
    return result


@router.post("/clock-records/{record_id}/review")
async def review_flagged(record_id: str, current_user: dict = Depends(require_roles(*OFFICE_ROLES))):
    """Mark a flagged clock record (no GPS, offline outside radius...) as checked."""
    rec = await db.clock_records.find_one({"_id": oid(record_id, "Clock record")})
    if not rec:
        raise HTTPException(status_code=404, detail="Clock record not found")
    await db.clock_records.update_one({"_id": rec["_id"]}, {"$set": {
        "flag_reviewed": True, "flag_reviewed_by_name": current_user["name"], "flag_reviewed_at": datetime.utcnow()}})
    return {"message": "Marked as reviewed"}


@router.get("/flagged-clock-records")
async def flagged(current_user: dict = Depends(require_roles(*OFFICE_ROLES))):
    docs = await db.clock_records.find({"flagged": True, "flag_reviewed": {"$ne": True}}) \
        .sort("clock_in", -1).to_list(500)
    return [{"id": str(d["_id"]), "user_name": d.get("user_name"), "site_name": d.get("site_name"),
             "clock_in": d.get("clock_in"), "total_hours": d.get("total_hours"), "flag_reason": d.get("flag_reason"),
             "distance_m": d.get("clock_in_distance_m")} for d in docs]
