"""Unit tests for logic.py. Run:  backend/.venv/bin/python -m pytest backend/tests   (or plain python)."""
import os
import sys
from datetime import date, datetime, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import logic as L  # noqa: E402


def test_money():
    assert L.to_cents(12.345) == 1235
    assert L.to_cents("1999.99") == 199999
    assert L.to_cents(None) == 0
    assert L.to_dollars(199999) == 1999.99
    assert L.pct(25, 200) == 12.5 and L.pct(1, 0) is None


def test_budget_status():
    assert L.budget_status(None, 5) == "no_budget"
    assert L.budget_status(100, 50) == "ok"
    assert L.budget_status(100, 90) == "warning"
    assert L.budget_status(100, 100) == "warning"
    assert L.budget_status(100, 100.5) == "over"


def test_labour_totals_uses_saved_rate_and_open_records():
    now = datetime(2026, 11, 16, 12, 0)
    recs = [{"total_hours": 8, "pay_rate": 40},
            {"clock_in": now - timedelta(hours=2), "pay_rate": 35.5},   # still on site
            {"total_hours": 4, "pay_rate": None}]                       # no rate recorded
    hours, cost = L.labour_totals(recs, now)
    assert hours == 14.0
    assert cost == 8 * 4000 + 2 * 3550


def test_workflow_split_adds_up():
    for scope in L.WORKFLOW_TEMPLATES:
        tasks = L.build_workflow_tasks(scope, 437)
        assert abs(sum(t["budget_hours"] for t in tasks) - 437) < 0.05, scope
        assert [t["sequence"] for t in tasks] == list(range(1, len(tasks) + 1))
        assert abs(sum(s for _, s in L.WORKFLOW_TEMPLATES[scope]) - 1.0) < 1e-9, scope


def test_draw_amounts_and_balance():
    a = L.draw_amounts(10_000_00, 10, 5)
    assert a == {"gross": 1000000, "holdback": 100000, "net": 900000, "tax": 45000, "total_due": 945000}
    inv = {"status": "submitted", "total_due": 945000, "payments": [{"amount": 500000}]}
    assert L.invoice_balance(inv) == 445000 and L.invoice_status(inv) == "partially_paid"
    inv["payments"].append({"amount": 445000})
    assert L.invoice_status(inv) == "paid"
    assert L.invoice_status({"status": "draft", "total_due": 5, "payments": []}) == "draft"
    assert L.invoice_status({"status": "submitted", "total_due": 5, "payments": []}) == "submitted"


def test_job_financials_exposure():
    f = L.job_financials(contract=100_000_00, approved_changes=10_000_00, billed_gross=22_000_00,
                         paid=15_000_00, labour_cost=12_000_00, material_released=18_000_00,
                         material_budget=40_000_00, labour_budget=45_000_00, holdback_held=2_200_00)
    assert f["revised_contract"] == 110_000_00
    assert f["percent_billed"] == 20.0
    assert f["percent_materials"] == 45.0
    assert f["exposure_points"] == 25.0 and f["exposure_alert"] is True
    assert f["cash_exposure"] == 15_000_00
    assert f["outstanding_receivable"] == 22_000_00 - 2_200_00 - 15_000_00
    assert f["projected_margin"] == 22.7
    assert f["margin_to_date"] == -36.4
    g = L.job_financials(contract=0, approved_changes=0, billed_gross=0, paid=0, labour_cost=0,
                         material_released=0)
    assert g["percent_billed"] is None and g["exposure_points"] is None and g["exposure_alert"] is False


def test_bid_detection_and_classification():
    assert L.looks_like_bid_invite("Invitation to Bid - Riverside Hospital Expansion", "")
    assert L.looks_like_bid_invite("New project on BuildingConnected", "You've been invited")
    assert not L.looks_like_bid_invite("Lunch Friday?", "Want to grab lunch")
    assert L.classify_bid("ITB: Maple Ridge Elementary School Addition")[0] == "institutional"
    assert L.classify_bid("Invitation to bid - 6 storey apartment building, 84 units")[0] == "multi_family"
    assert L.classify_bid("RFQ: Starbucks storefront fit-out")[0] == "commercial_fit_out"
    assert L.classify_bid("New data centre phase 2", "Tier III data center")[0] == "institutional"
    assert L.classify_bid("Hello", "nothing relevant")[0] == "other"
    assert L.classify_bid("Invitation to Bid: Lions Gate Hospital - Level 2 Renovation")[0] == "institutional"
    assert L.classify_bid("Office renovation - 3rd floor")[0] == "commercial_fit_out"
    assert L.classify_bid("Prescription", "description of the scope")[0] == "other"   # whole words only


def test_due_date_and_project_name():
    assert L.extract_due_date("", "Bids are due on Friday, March 13, 2026 at 2:00 PM") == date(2026, 3, 13)
    assert L.extract_due_date("", "Closing Date: 2026-04-02") == date(2026, 4, 2)
    assert L.extract_due_date("Bid date: 04/15/2026", "") == date(2026, 4, 15)
    assert L.extract_due_date("", "Tenders close Apr. 3rd, 2026") == date(2026, 4, 3)
    assert L.extract_due_date("", "no dates here") is None
    assert L.clean_project_name("Fwd: Invitation to Bid - Maple Ridge Elementary Reno") == "Maple Ridge Elementary Reno"
    assert L.clean_project_name("RE: RFQ: Starbucks Fit-Out") == "Starbucks Fit-Out"


def test_bid_stats():
    today = date(2026, 11, 18)  # Wednesday
    bids = [
        {"status": "submitted", "category": "institutional", "submitted_at": "2026-11-16", "bid_amount": 250_000_00,
         "follow_up_date": "2026-11-17"},
        {"status": "won", "category": "multi_family", "submitted_at": "2026-10-01", "decided_at": "2026-11-17"},
        {"status": "lost", "category": "multi_family", "submitted_at": "2026-10-05", "decided_at": "2026-10-20"},
        {"status": "lost", "category": "commercial_fit_out", "submitted_at": "2026-11-02"},
        {"status": "invited", "category": "institutional", "due_date": "2026-11-20"},
        {"status": "submitted", "category": "other", "submitted_at": "2025-01-01", "follow_up_date": "2026-12-01"},
    ]
    s = L.bid_stats(bids, today, weeks=12)
    assert s["submitted_this_week"] == 1
    assert s["won"] == 1 and s["lost"] == 2 and s["win_rate"] == 33.3
    assert s["followups_due"] == 1 and s["due_this_week"] == 1
    assert s["pipeline_value"] == 250_000_00
    assert s["by_category"]["multi_family"]["win_rate"] == 50.0
    assert len(s["weekly"]) == 12 and s["weekly"][-1]["week_start"] == "2026-11-16"
    assert s["weekly"][-1]["won"] == 1


def test_ranges_overlap():
    d = date
    assert L.ranges_overlap(d(2026, 1, 1), d(2026, 1, 10), d(2026, 1, 10), None)
    assert not L.ranges_overlap(d(2026, 1, 1), d(2026, 1, 9), d(2026, 1, 10), d(2026, 1, 12))


def test_split_overtime():
    from datetime import datetime, timedelta
    base = datetime(2026, 11, 9, 12)
    recs = []
    for day in range(5):   # 5 x 10 h = 50 h: 44 regular, 6 overtime, all on the last shift
        recs.append({"user_id": "u1", "user_name": "Ed", "site_id": "A" if day < 4 else "B", "site_name": "A",
                     "clock_in": base + timedelta(days=day), "total_hours": 10, "pay_rate": 40, "clock_out": base})
    recs.append({"user_id": "u2", "user_name": "Ann", "site_id": "A", "site_name": "A", "clock_in": base,
                 "total_hours": 8, "pay_rate": None, "clock_out": base})
    out = L.split_overtime(recs)
    ed = [e for e in out if e["user_id"] == "u1"]
    assert sum(e["regular_hours"] for e in ed) == 44 and sum(e["overtime_hours"] for e in ed) == 6
    last = max(ed, key=lambda e: e["clock_in"])
    assert last["site_id"] == "B" and last["regular_hours"] == 4 and last["overtime_hours"] == 6
    assert last["pay"] == 4 * 4000 + 6 * 6000
    s = L.summarize_payroll(out)
    assert s["totals"]["hours"] == 58 and s["totals"]["pay"] == 44 * 4000 + 6 * 6000
    b = [x for x in s["by_site"] if x["site_id"] == "B"][0]
    assert b["overtime_hours"] == 6 and b["pay"] == 52000
    ann = [u for u in s["by_user"] if u["user_id"] == "u2"][0]
    assert ann["missing_rate"] and ann["pay"] == 0


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok ", name)
    print("all logic tests passed")
