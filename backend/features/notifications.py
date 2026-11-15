"""In-app notifications and the background checks that create them.

Every hour the server checks for:
  * safety documents: 2-week notice to the employee; 1-week and expired warnings to the
    foremen of every site that employee is on
  * tasks reaching 90% / going over their hour budget (PMs + the site's foremen)
  * materials running more than 10 points ahead of billing on a job (admin, PMs, coordinators)
  * submitted bids due for a follow-up (estimators + coordinators)
  * progress draws unpaid after 30 / 60 / 90 days (coordinators + admin)
Each alert is sent once (deduplicated), so nobody gets the same notice every hour.
The bid inbox is checked on its own schedule (BID_INBOX_POLL_MINUTES)."""
import asyncio
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query

import logic as L
from core import (ROLE_ADMIN, ROLE_COORDINATOR, ROLE_ESTIMATOR, ROLE_PM, calculate_expiry_info, db, foremen_for_site,
                  get_current_user, logger, notify, oid, users_with_roles)

router = APIRouter(prefix="/api/notifications", tags=["notifications"])

CHECK_EVERY_SECONDS = 3600


@router.get("")
async def my_notifications(unread_only: bool = Query(False), limit: int = Query(50, ge=1, le=200),
                           current_user: dict = Depends(get_current_user)):
    q = {"user_id": str(current_user["_id"])}
    if unread_only:
        q["read"] = False
    docs = await db.notifications.find(q).sort("created_at", -1).limit(limit).to_list(limit)
    unread = await db.notifications.count_documents({"user_id": str(current_user["_id"]), "read": False})
    return {"unread": unread, "items": [{"id": str(d["_id"]), "title": d["title"], "body": d.get("body"),
                                         "kind": d.get("kind"), "link": d.get("link"), "read": d.get("read", False),
                                         "created_at": d["created_at"]} for d in docs]}


@router.post("/{notification_id}/read")
async def mark_read(notification_id: str, current_user: dict = Depends(get_current_user)):
    res = await db.notifications.update_one({"_id": oid(notification_id, "Notification"),
                                             "user_id": str(current_user["_id"])}, {"$set": {"read": True}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Notification not found")
    return {"ok": True}


@router.post("/read-all")
async def mark_all_read(current_user: dict = Depends(get_current_user)):
    await db.notifications.update_many({"user_id": str(current_user["_id"]), "read": False}, {"$set": {"read": True}})
    return {"ok": True}


@router.post("/run-checks")
async def run_checks_now(current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != ROLE_ADMIN:
        raise HTTPException(status_code=403, detail="Admin only")
    return await run_checks()


# ---------------------------------------------------------------- checks

async def check_safety_documents() -> int:
    sent = 0
    async for d in db.safety_documents.find({"expiry_date": {"$nin": [None, ""]}}):
        _, _, days = calculate_expiry_info(d.get("expiry_date"))
        if days is None or days > 14:
            continue
        doc_id = str(d["_id"])
        name = d.get("document_type") or d.get("file_name") or "safety document"
        if 0 <= days <= 14:
            sent += await notify([d["user_id"]], "Safety document expiring in %d day(s)" % days,
                                 "%s expires %s. Upload the renewed one." % (name, d["expiry_date"][:10]),
                                 kind="safety", link="/worker/safety", dedupe_key="safety:%s:14" % doc_id)
        if days <= 7:
            user = await db.users.find_one({"_id": oid(d["user_id"], "User")}) if d.get("user_id") else None
            if not user:
                continue
            stage = "expired" if days < 0 else "7"
            for site_id in user.get("assigned_sites") or []:
                foremen = [f["_id"] for f in await foremen_for_site(site_id) if f["_id"] != user["_id"]]
                title = ("%s's %s has EXPIRED" if days < 0 else "%s's %s expires in %d day(s)") % (
                    (user["name"], name) if days < 0 else (user["name"], name, days))
                sent += await notify(foremen, title, "Check before they work on site.", kind="safety",
                                     link="/worker", dedupe_key="safety:%s:%s:%s" % (doc_id, stage, site_id))
    return sent


async def check_task_budgets() -> int:
    from features.tasks import hours_by_task
    sent = 0
    tasks = await db.tasks.find({"budget_hours": {"$gt": 0}, "status": {"$ne": "complete"}}).to_list(20000)
    hours = await hours_by_task([str(t["_id"]) for t in tasks])
    pms = [u["_id"] for u in await users_with_roles((ROLE_PM, ROLE_ADMIN))]
    for t in tasks:
        h, _ = hours.get(str(t["_id"]), (0.0, 0))
        status = L.budget_status(t["budget_hours"], h)
        if status not in ("warning", "over"):
            continue
        foremen = [f["_id"] for f in await foremen_for_site(t["site_id"])]
        title = ("Over budget: %s" if status == "over" else "Near budget (90%%): %s") % t["title"]
        sent += await notify(pms + foremen, title, "%s: %.1f of %.1f hours used" % (t.get("site_name", ""), h,
                                                                                     t["budget_hours"]),
                             kind="budget", link="/manager/projects", dedupe_key="task:%s:%s" % (t["_id"], status))
    return sent


async def check_material_exposure() -> int:
    from features.projects import financials
    sent = 0
    office = [u["_id"] for u in await users_with_roles((ROLE_ADMIN, ROLE_PM, ROLE_COORDINATOR))]
    week = L.week_start(datetime.utcnow().date()).isoformat()
    async for site in db.sites.find({"status": {"$ne": "completed"}, "material_budget": {"$gt": 0}}):
        f = await financials(site)
        if f.get("exposure_alert"):
            sent += await notify(office, "Materials ahead of billing: %s" % site["name"],
                                 "%.0f%% of materials released vs %.0f%% billed. Bill a draw or hold releases."
                                 % (f["percent_materials"] or 0, f["percent_billed"] or 0), kind="exposure",
                                 link="/manager/projects", dedupe_key="exposure:%s:%s" % (site["_id"], week))
    return sent


async def check_bid_follow_ups() -> int:
    sent = 0
    today = datetime.utcnow().date()
    team = [u["_id"] for u in await users_with_roles((ROLE_ESTIMATOR, ROLE_COORDINATOR))]
    async for b in db.bids.find({"status": "submitted", "follow_up_date": {"$nin": [None, ""]}}):
        fu = L.parse_date(b["follow_up_date"])
        if fu and fu <= today:
            targets = team + ([b["estimator_id"]] if b.get("estimator_id") else [])
            sent += await notify(targets, "Follow up on bid: %s" % b["project_name"],
                                 "Submitted %s to %s" % (b.get("submitted_at", ""), b.get("general_contractor") or "GC"),
                                 kind="bid", link="/manager/bids",
                                 dedupe_key="bid:%s:fu:%s" % (b["_id"], b["follow_up_date"]))
    async for b in db.bids.find({"status": {"$in": ["invited", "reviewing"]}, "due_date": {"$nin": [None, ""]}}):
        due = L.parse_date(b["due_date"])
        if due and 0 <= (due - today).days <= 2:
            sent += await notify(team, "Bid due %s: %s" % (due.isoformat(), b["project_name"]), "",
                                 kind="bid", link="/manager/bids", dedupe_key="bid:%s:due" % b["_id"])
    return sent


async def check_overdue_invoices() -> int:
    sent = 0
    today = datetime.utcnow().date()
    office = [u["_id"] for u in await users_with_roles((ROLE_COORDINATOR, ROLE_ADMIN))]
    async for inv in db.invoices.find({"status": {"$in": ["submitted", "partially_paid"]}}):
        sub = L.parse_date(inv.get("submitted_at"))
        if not sub or L.invoice_balance(inv) <= 0:
            continue
        days = (today - sub).days
        bucket = 90 if days > 90 else 60 if days > 60 else 30 if days > 30 else None
        if bucket:
            sent += await notify(office, "Draw unpaid %d+ days: %s" % (bucket, inv.get("site_name")),
                                 "%s: $%.2f outstanding" % (inv.get("invoice_number"),
                                                            L.to_dollars(L.invoice_balance(inv))),
                                 kind="invoice", link="/manager/projects",
                                 dedupe_key="invoice:%s:%d" % (inv["_id"], bucket))
    return sent


async def run_checks() -> dict:
    results = {}
    for name, check in (("safety", check_safety_documents), ("task_budgets", check_task_budgets),
                        ("material_exposure", check_material_exposure), ("bid_follow_ups", check_bid_follow_ups),
                        ("overdue_invoices", check_overdue_invoices)):
        try:
            results[name] = await check()
        except Exception:  # noqa: BLE001  (one failing check must not stop the others)
            logger.exception("Check %s failed", name)
            results[name] = "error"
    await db.app_state.update_one({"_id": "checks"}, {"$set": {"last_run": datetime.utcnow(), "results": results}},
                                  upsert=True)
    return results


_tasks: list = []


async def _loop(every_seconds: int, job, name: str, first_delay: int = 30) -> None:
    await asyncio.sleep(first_delay)
    while True:
        try:
            await job()
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            logger.exception("Background job %s failed", name)
        await asyncio.sleep(every_seconds)


def start_background_jobs() -> None:
    from features.bid_inbox import check_inbox, inbox_config
    _tasks.append(asyncio.create_task(_loop(CHECK_EVERY_SECONDS, run_checks, "alerts")))
    cfg = inbox_config()
    if cfg:
        _tasks.append(asyncio.create_task(_loop(cfg["poll_minutes"] * 60, check_inbox, "bid inbox", first_delay=60)))
        logger.info("Bid inbox: checking %s every %d min", cfg["user"], cfg["poll_minutes"])


def stop_background_jobs() -> None:
    for t in _tasks:
        t.cancel()
    _tasks.clear()

