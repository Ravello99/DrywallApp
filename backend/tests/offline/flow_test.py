"""End-to-end run of the API features against an in-memory database, with no server, MongoDB or
internet needed. The stubs/ folder stands in for FastAPI, Motor, passlib, python-jose and bson;
role checks are run the way FastAPI would run them.

    python3 backend/tests/offline/flow_test.py
"""
import asyncio, os, sys
from datetime import datetime, timedelta
HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = sys.argv[1] if len(sys.argv) > 1 else os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path[:0] = [os.path.join(HERE, "stubs"), BACKEND]
os.environ.update(MONGO_URL="mongodb://x", DB_NAME="t", SECRET_KEY="k", ADMIN_EMAIL="admin@drywall.local",
                  ADMIN_PASSWORD="pw12345678")
import server, core, logic as L
from fastapi import HTTPException
from features import tasks as T, materials as M, manpower as MP, rfis as R, change_orders as CO, \
    invoices as I, bids as B, projects as P, notifications as N, field as F

import inspect
from fastapi import _Dep

async def allowed(fn, user):
    """Run the endpoint's current_user dependency chain for this user (like FastAPI would)."""
    async def resolve(dep):
        if dep is core.get_current_user:
            return user
        kwargs = {}
        for name, prm in inspect.signature(dep).parameters.items():
            if isinstance(prm.default, _Dep):
                kwargs[name] = await resolve(prm.default.dep)
        return await dep(**kwargs)
    prm = inspect.signature(fn).parameters.get("current_user")
    if prm is None or not isinstance(prm.default, _Dep):
        return True
    try:
        await resolve(prm.default.dep)
        return True
    except HTTPException as e:
        if e.status_code == 403:
            return False
        raise

def check(cond, msg):
    print(("  ok   " if cond else "  FAIL ") + msg)
    if not cond: check.failed += 1
check.failed = 0

async def expect_error(coro, status, msg):
    try:
        await coro; check(False, msg + " (no error raised)")
    except HTTPException as e:
        check(e.status_code == status, "%s -> %s %s" % (msg, e.status_code, e.detail))

async def main():
    db = core.db
    N.start_background_jobs = lambda: None
    await server.startup_event()
    admin = await db.users.find_one({"role": "admin"})
    check(admin is not None, "admin created on startup")
    login = await server.login(core.LoginRequest(email=" Admin@Drywall.LOCAL ", password="pw12345678"))
    check(login.user.role == "admin", "login works with .local email, spaces and capitals")

    async def mk(role, name, **kw):
        u = await server.create_user(core.UserCreate(email=name.lower().replace(" ", ".") + "@vanguard.ca",
                                                     name=name, role=role, password="password1", **kw), admin)
        return await db.users.find_one({"email": u.email})
    pm = await mk("project_manager", "Pat PM")
    coord = await mk("project_coordinator", "Cora Coord")
    est = await mk("estimator", "Eli Est")
    fm = await mk("foreman", "Fred Foreman", pay_rate=48)
    e1 = await mk("employee", "Ed Framer", specialties=["steel_framer"], level="journeyman", pay_rate=40)
    e2 = await mk("employee", "Ann Boarder", specialties=["drywaller"], pay_rate=36)
    e3 = await mk("employee", "Tom Taper", specialties=["taper_finisher"], pay_rate=38)

    # site with GPS + budgets
    site = await server.create_site(core.SiteCreate(name="Riverside Tower", address="1 Main St",
        location=core.LocationModel(latitude=49.2827, longitude=-123.1207), contract_value=500000,
        material_budget=120000, labour_budget=180000, project_number="24-017", job_type="multi_family"), admin)
    sid = site.id
    await db.users.update_one({"_id": fm["_id"]}, {"$set": {"assigned_sites": [sid]}})
    fm = await db.users.find_one({"_id": fm["_id"]})

    print("\n-- workflows & tasks")
    res = await T.apply_workflow(sid, T.ApplyWorkflow(scopes=[T.WorkflowScope(scope="steel_framing", budget_hours=100),
                                                            T.WorkflowScope(scope="drywall_boarding", budget_hours=80)]), pm)
    check(res["created"] == 12, "workflow created 12 tasks (%d)" % res["created"])
    tasks = await T.list_tasks(site_id=sid, assigned_to=None, scope=None, status=None, budget=None, current_user=pm)
    studs = next(t for t in tasks if t["title"] == "Wall studs & openings")
    check(studs["budget_hours"] == 35.0, "studs task got 35 pct of 100 h")
    picker = await T.clockable_tasks(sid, fm)
    check(len(picker) == 12, "foreman sees 12 tasks in the clock-in picker")
    await expect_error(T.clockable_tasks(sid, e1), 403, "unassigned employee can't see site tasks")

    print("\n-- manpower request -> approve -> assignment & calendar")
    req = await MP.create_request(MP.ManpowerRequestIn(site_id=sid, specialty="steel_framer", count=1,
                                                       start_date=datetime.utcnow().date().isoformat()), fm)
    avail = await MP.available_crew(specialty="steel_framer", start_date=None, end_date=None, current_user=pm)
    check(avail[0]["name"] == "Ed Framer" and avail[0]["matches_specialty"], "best match listed first: Ed Framer")
    await expect_error(MP.approve(req["id"], MP.Approval(user_ids=[]), pm), 400, "approve needs people picked")
    appr = await MP.approve(req["id"], MP.Approval(user_ids=[str(e1["_id"])]), pm)
    check(appr["status"] == "approved", "manpower approved")
    e1 = await db.users.find_one({"_id": e1["_id"]})
    check(sid in e1["assigned_sites"], "Ed now assigned to the site")
    cal = await MP.my_calendar(start=None, end=None, current_user=e1)
    check(any(d["date"] == datetime.utcnow().date().isoformat() for d in cal["days"]), "Ed's calendar shows today")
    notes = await N.my_notifications(unread_only=False, limit=50, current_user=e1)
    check(any("assigned to Riverside" in n["title"] for n in notes["items"]), "Ed got an assignment notification")

    print("\n-- clock in with task, hour budget & costs")
    loc = core.LocationModel(latitude=49.2830, longitude=-123.1210)
    rec = await server.clock_in(core.ClockInRequest(site_id=sid, location=loc, accuracy_m=8, task_id=studs["id"]), e1)
    check(rec.task_title == "Wall studs & openings", "clock-in recorded the task")
    raw = await db.clock_records.find_one({"user_id": str(e1["_id"])})
    check(raw["pay_rate"] == 40, "pay rate saved on the clock record")
    # pretend Ed worked 33 hours on studs (warning at 90% of 35)
    await db.clock_records.update_one({"_id": raw["_id"]}, {"$set": {"clock_in": datetime.utcnow() - timedelta(hours=33)}})
    tasks = await T.list_tasks(site_id=sid, assigned_to=None, scope=None, status=None, budget="warning", current_user=pm)
    check(len(tasks) == 1 and tasks[0]["budget_status"] == "warning", "studs task flagged near budget")
    check(tasks[0]["labour_cost"] == 1320.0, "labour cost 33 h x $40 = $1320 (%s)" % tasks[0].get("labour_cost"))
    fm_view = await T.list_tasks(site_id=sid, assigned_to=None, scope=None, status=None, budget=None, current_user=fm)
    check("labour_cost" not in fm_view[0], "foreman doesn't see labour cost")
    sent = await N.check_task_budgets()
    check(sent >= 2, "budget warning sent to PM/admin/foreman (%d)" % sent)
    check(await N.check_task_budgets() == 0, "budget warning not repeated")
    await expect_error(T.update_task(studs["id"], T.TaskUpdate(progress_pct=60), e1), 403,
                       "employee can't update a task not assigned to them")
    upd = await T.update_task(studs["id"], T.TaskUpdate(progress_pct=60, budget_hours=999), fm)
    check(upd["progress_pct"] == 60 and upd["budget_hours"] == 35.0 and upd["status"] == "in_progress",
          "foreman updated progress; budget unchanged; status -> in progress")

    print("\n-- materials request -> approve -> release; exposure")
    mreq = await M.create_request(M.MaterialRequestIn(site_id=sid, items=[M.MaterialItem(description='5/8" Type X', quantity=120, unit="sheets")]), fm)
    await M.approve_request(mreq["id"], M.Decision(notes="ok"), pm)
    rel = await M.release_request(mreq["id"], M.ReleaseIn(amount=60000, supplier="CDS", po_number="PO-1"), coord)
    check(rel["amount"] == 60000.0 and "120 sheets" in rel["description"], "release recorded $60,000 with items")
    fin = await P.financials(await db.sites.find_one({"_id": core.oid(sid)}))
    check(fin["percent_materials"] == 50.0 and fin["exposure_alert"], "50 pct materials vs 0 pct billed -> exposure alert")
    check(await N.check_material_exposure() >= 1, "exposure notification sent")

    print("\n-- change order -> approved -> revised contract; progress draw; payment")
    co = await CO.create(CO.ChangeOrderIn(site_id=sid, title="Extra bulkheads L3", amount=25000), pm)
    await CO.submit(co["id"], pm)
    co = await CO.respond(co["id"], CO.ChangeOrderDecision(decision="approved", approved_amount=20000), pm)
    check(co["approved_amount"] == 20000.0 and co["number"] == 1, "CO #1 approved at $20,000")
    await expect_error(CO.update(co["id"], CO.ChangeOrderUpdate(amount=1), pm), 400, "approved CO can't be edited")
    draw = await I.create_draw(I.DrawIn(site_id=sid, mode="percent", percent_complete=40), coord)
    check(draw["gross"] == 208000.0, "40%% of $520,000 revised contract = $208,000 (%s)" % draw["gross"])
    check(draw["holdback"] == 20800.0 and draw["tax"] == 9360.0 and draw["total_due"] == 196560.0,
          "holdback 10%, GST 5% on net, total $196,560")
    await expect_error(I.add_payment(draw["id"], I.PaymentIn(amount=10), coord), 400, "can't pay a draft")
    await I.submit(draw["id"], coord)
    await expect_error(I.create_draw(I.DrawIn(site_id=sid, mode="percent", percent_complete=30), coord), 400,
                       "can't bill a % that's already billed")
    paid = await I.add_payment(draw["id"], I.PaymentIn(amount=100000, reference="CHQ 1001"), coord)
    check(paid["status"] == "partially_paid" and paid["balance"] == 96560.0, "partial payment -> balance $96,560")
    await expect_error(I.add_payment(draw["id"], I.PaymentIn(amount=999999), coord), 400, "overpayment blocked")
    summ = await I.summary(coord)
    check(summ["outstanding"] == 96560.0 and summ["aging"]["0-30"] == 96560.0, "A/R summary + aging")
    fin = await P.financials(await db.sites.find_one({"_id": core.oid(sid)}))
    check(fin["revised_contract"] == 520000.0 and fin["percent_billed"] == 40.0, "job shows revised contract and 40% billed")
    check(fin["exposure_alert"] is False, "exposure cleared once billing caught up (50 vs 40 pct)")

    print("\n-- RFIs")
    rfi = await R.create_rfi(R.RFIIn(site_id=sid, subject="Bulkhead height at corridor C",
                                     question="Drawings show 2400 vs 2700?", drawing_ref="A-301/4"), fm)
    check(rfi["number"] == 1 and rfi["status"] == "open", "RFI #1 opened")
    check(not await allowed(R.respond, fm), "foreman can't answer RFIs")
    ans = await R.respond(rfi["id"], R.RFIResponse(response="Use 2700 per ASI-3", close=False), pm)
    check(ans["status"] == "answered", "PM answered RFI")
    fnotes = await N.my_notifications(unread_only=True, limit=50, current_user=fm)
    check(any("RFI #1 answered" in n["title"] for n in fnotes["items"]), "foreman notified of the answer")

    print("\n-- bids")
    b1 = await B.import_email(B.EmailImport(subject="Fwd: Invitation to Bid - Maple Ridge Elementary School Addition",
        body="Bids are due on Friday, March 13, 2027 at 2:00 PM. Drywall & ACT scope.", sender="Jane <jane@ledcor.com>"), est)
    check(b1["category"] == "institutional" and b1["due_date"] == "2027-03-13" and b1["general_contractor"] == "Ledcor",
          "pasted invite: institutional, due date, GC guessed")
    b2 = await B.create_bid(B.BidIn(project_name="Starbucks storefront fit-out"), est)
    check(b2["category"] == "commercial_fit_out", "manual bid auto-sorted as fit-out")
    sub = await B.submit_bid(b2["id"], B.SubmitIn(bid_amount=48500, follow_up_days=7), est)
    check(sub["status"] == "submitted" and sub["follow_up_date"], "bid submitted with follow-up date")
    await db.bids.update_one({"_id": core.oid(b2["id"])}, {"$set": {"follow_up_date": "2020-01-01"}})
    check(await N.check_bid_follow_ups() >= 1, "follow-up reminder sent")
    stats = await B.stats(weeks=12, current_user=est)
    check(stats["submitted_this_week"] == 1 and stats["followups_due"] == 1 and stats["pipeline_value"] == 48500.0,
          "stats: 1 submitted this week, 1 follow-up due, $48,500 pipeline")
    await B.record_outcome(b2["id"], B.OutcomeIn(outcome="won"), est)
    stats = await B.stats(weeks=12, current_user=est)
    check(stats["win_rate"] == 100.0, "win rate 100 pct after a win")
    proj = await B.create_project_from_bid(b2["id"], pm)
    newsite = await db.sites.find_one({"_id": core.oid(proj["project_id"])})
    check(newsite["contract_value"] == 48500.0 and newsite["job_type"] == "commercial_fit_out", "won bid -> project")
    lst = await B.list_bids(status=None, category=None, q="maple", followups=False, current_user=est)
    check(len(lst) == 1, "bid search by name")

    print("\n-- bid inbox (IMAP parsing with a sample email)")
    import email as _email
    from email.mime.multipart import MIMEMultipart
    from email.mime.text import MIMEText
    from features import bid_inbox as BI
    m = MIMEMultipart("alternative")
    m["Subject"] = "Invitation to Bid: Lions Gate Hospital - Level 2 Renovation"
    m["From"] = "Estimating <bids@pcl.com>"
    m["Message-ID"] = "<abc123@pcl.com>"
    m.attach(MIMEText("<html><body><p>You are invited to bid.</p><p>Bids due <b>April 2, 2027</b>.</p></body></html>", "html"))
    text = BI._text_of(_email.message_from_bytes(m.as_bytes()))
    check("Bids due" in text and "<b>" not in text, "HTML email turned into text")
    os.environ.update(BID_INBOX_HOST="imap.example.com", BID_INBOX_USER="bids@vanguard.ca", BID_INBOX_PASSWORD="x")
    sample = [{"message_id": "<abc123@pcl.com>", "subject": m["Subject"], "sender": m["From"],
               "received_at": datetime(2027, 3, 1), "body": text},
              {"message_id": "<lunch@x>", "subject": "Lunch Friday?", "sender": "a@b.com", "received_at": None,
               "body": "pizza"}]
    BI._fetch = lambda cfg, days: sample
    r1 = await BI.check_inbox()
    r2 = await BI.check_inbox()
    check(r1["imported"] == 1 and r1["not_bids"] == 1 and r2["imported"] == 0, "inbox: 1 invite imported, lunch ignored, no duplicates")
    hb = await db.bids.find_one({"email_message_id": "<abc123@pcl.com>"})
    check(hb["category"] == "institutional" and hb["due_date"] == "2027-04-02" and hb["general_contractor"] == "Pcl",
          "inbox bid: institutional, due 2027-04-02, GC from sender domain")
    status = await B.inbox_status(est)
    check(status["configured"] and status["last_imported"] == 0, "inbox status endpoint")

    print("\n-- dashboards")
    cards = await P.overview(include_completed=False, current_user=admin)
    rc = next(c for c in cards if c["name"] == "Riverside Tower")
    check(rc["men_on_site"] == 1 and rc["crew"][0]["task_title"] == "Wall studs & openings", "office card: 1 man on site, task shown")
    check(rc["financials"]["percent_billed"] == 40.0 and rc["open_rfis"] == 1, "office card has money + RFIs")
    est_cards = await P.overview(include_completed=False, current_user=est)
    check("financials" not in est_cards[0], "estimator doesn't see job money")
    fcards = await P.overview(include_completed=False, current_user=fm)
    check(len(fcards) == 1 and "financials" not in fcards[0] and "labour_hours" not in fcards[0],
          "foreman card: own site only, no money or hours")
    dash = await F.field_dashboard(fm)
    check(dash["sites"][0]["men_on_site"] == 1 and dash["sites"][0]["progress_pct"] is not None, "foreman dashboard")
    hours = await F.my_hours(weeks=4, current_user=e1)
    check(hours["this_week"] >= 33 or hours["weeks"][1]["hours"] >= 33, "employee weekly hours (%s)" % hours["this_week"])

    print("\n-- safety alerts")
    soon = (datetime.utcnow() + timedelta(days=5)).date().isoformat()
    await db.safety_documents.insert_one({"user_id": str(e1["_id"]), "user_name": "Ed Framer", "document_type": "Fall Protection",
                                          "expiry_date": soon, "site_id": sid})
    sent = await N.check_safety_documents()
    check(sent == 2, "5 days left: employee + foreman notified (%d)" % sent)
    cs = await F.crew_safety(fm)
    check(len(cs) == 1 and cs[0]["on_site_now"], "foreman crew-safety list shows Ed (on site)")
    cards = await P.overview(include_completed=False, current_user=fm)
    check(cards[0]["crew_safety_problems"] == 1, "site card flags the crew safety problem")

    print("\n-- shutdown + release")
    await server.shutdown_site(sid, core.ShutdownRequest(reason="Safety stand-down", clock_out_everyone=True), coord)
    check(await db.clock_records.count_documents({"site_id": sid, "status": "clocked_in"}) == 0, "shutdown clocked everyone out")
    await expect_error(server.clock_in(core.ClockInRequest(site_id=sid, location=loc), e1), 423, "clock-in blocked while shut down")
    rel = await MP.create_request(MP.ManpowerRequestIn(site_id=sid, kind="release", user_ids=[str(e1["_id"])]), fm)
    await MP.approve(rel["id"], MP.Approval(), pm)
    e1 = await db.users.find_one({"_id": e1["_id"]})
    check(sid not in e1["assigned_sites"], "release approved: Ed removed from the site")

    print("\n-- permissions (role checks as the server runs them)")
    matrix = [
        (MP.approve, pm, True), (MP.approve, fm, False), (MP.approve, coord, False),
        (M.create_request, fm, True), (M.create_request, e1, False), (M.approve_request, fm, False),
        (M.release_request, coord, True), (M.list_releases, fm, True),
        (R.create_rfi, fm, True), (R.create_rfi, e2, False), (R.respond, coord, True),
        (CO.create, est, False), (CO.create, pm, True), (CO.list_cos, fm, False),
        (I.create_draw, coord, True), (I.create_draw, est, False), (I.list_draws, fm, False),
        (B.list_bids, est, True), (B.list_bids, fm, False), (B.create_project_from_bid, est, False),
        (T.apply_workflow, pm, True), (T.apply_workflow, coord, False), (T.create_task, fm, True),
        (T.create_task, e1, False), (T.delete_task, fm, False),
        (P.overview, fm, True), (P.overview, e1, False), (P.summary, est, True),
        (F.crew_safety, fm, True), (F.crew_safety, e1, False),
        (server.shutdown_site, fm, False), (server.shutdown_site, coord, True), (server.shutdown_site, est, False),
        (server.assign_form, fm, True), (server.assign_form, e1, False), (server.get_users, fm, False),
    ]
    for fn, who, expect in matrix:
        got = await allowed(fn, who)
        check(got == expect, "%-26s %-20s %s" % (fn.__name__, who["role"], "allowed" if got else "blocked"))
    await expect_error(M.list_releases(site_id=None, current_user=fm), 403, "foreman blocked from release costs (in-function check)")

    print("\n-- website estimate requests")
    import fastapi as FA
    from features import public as PUB
    req = PUB.EstimateRequest(name="Gina GC", email="gina@buildco.ca", company="BuildCo", project_name="Lakeview Condos Phase 2",
                              location="Niagara Falls", category="multi_family", due_date="2026-12-04",
                              message="48 units, framing board tape and ACT. Drawings on our portal.")
    before = await db.notifications.count_documents({})
    r = await PUB.estimate_request(req, FA.Request(host="10.0.0.9"))
    bid = await db.bids.find_one({"source": "website"})
    check(r["ok"] and bid is not None, "website request becomes a bid")
    check(bid["status"] == "invited" and bid["category"] == "multi_family" and bid["due_date"] == "2026-12-04",
          "bid has status, type and due date")
    check(bid["general_contractor"] == "BuildCo" and bid["contact_email"] == "gina@buildco.ca", "bid has GC and contact")
    check(await db.notifications.count_documents({}) > before, "estimators/coordinators notified")
    bot = PUB.EstimateRequest(**{**req.model_dump(), "website": "http://spam"})
    n = await db.bids.count_documents({})
    await PUB.estimate_request(bot, FA.Request(host="10.0.0.8"))
    check(await db.bids.count_documents({}) == n, "honeypot submissions are dropped")
    for _ in range(4):
        await PUB.estimate_request(req, FA.Request(host="10.0.0.7"))
    await PUB.estimate_request(req, FA.Request(host="10.0.0.7"))
    await expect_error(PUB.estimate_request(req, FA.Request(host="10.0.0.7")), 429, "6th request in an hour from one IP")
    await expect_error(PUB.estimate_request(PUB.EstimateRequest(**{**req.model_dump(), "email": "nope"}),
                                            FA.Request(host="10.0.0.6")), 400, "bad email rejected")

    print("\n-- checks run together")
    res = await N.run_checks()
    check("error" not in res.values(), "all background checks ran without errors: %s" % res)
    print("\n%s" % ("ALL FLOW CHECKS PASSED" if not check.failed else "%d CHECK(S) FAILED" % check.failed))
    sys.exit(1 if check.failed else 0)

asyncio.run(main())
