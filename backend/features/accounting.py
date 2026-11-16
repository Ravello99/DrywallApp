"""Accounting section: weekly labour payouts by job and employee (with overtime), the progress
draw / receivables picture, and bulk Excel downloads of hours for records.

Settings (backend/.env): COMPANY_TIMEZONE (default America/Toronto), PAY_WEEK_START (0 = Monday,
6 = Sunday; default 0), OVERTIME_WEEKLY_HOURS (default 44), OVERTIME_MULTIPLIER (default 1.5)."""
import io
import os
import re
import zipfile
from datetime import date, datetime, time, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

import logic as L
from core import ACCOUNTING_ROLES, db, make_link_token, read_link_token, require_roles

router = APIRouter(prefix="/api/accounting", tags=["accounting"])

LINK_MINUTES = 30
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


# --------------------------------------------------------------------------- settings and dates
def _float_env(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except ValueError:
        return default


def tz():
    try:
        from zoneinfo import ZoneInfo
        return ZoneInfo(os.environ.get("COMPANY_TIMEZONE", "America/Toronto"))
    except Exception:  # noqa: BLE001  (no tz database: fall back to UTC)
        from datetime import timezone
        return timezone.utc


def week_start_day() -> int:
    try:
        return min(6, max(0, int(os.environ.get("PAY_WEEK_START", "0"))))
    except ValueError:
        return 0


def ot_settings():
    return _float_env("OVERTIME_WEEKLY_HOURS", L.OVERTIME_WEEKLY_HOURS), _float_env("OVERTIME_MULTIPLIER",
                                                                                    L.OVERTIME_MULTIPLIER)


def local_today() -> date:
    from datetime import timezone
    return datetime.now(timezone.utc).astimezone(tz()).date()


def week_of(day: date) -> date:
    return day - timedelta(days=(day.weekday() - week_start_day()) % 7)


def utc_bounds(start: date, end_inclusive: date):
    """Local calendar days -> naive UTC datetimes (how clock records are stored)."""
    from datetime import timezone
    z = tz()
    a = datetime.combine(start, time.min, tzinfo=z).astimezone(timezone.utc).replace(tzinfo=None)
    b = datetime.combine(end_inclusive + timedelta(days=1), time.min, tzinfo=z).astimezone(timezone.utc).replace(tzinfo=None)
    return a, b


def to_local(dt: Optional[datetime]) -> Optional[datetime]:
    if not isinstance(dt, datetime):
        return None
    from datetime import timezone
    return dt.replace(tzinfo=timezone.utc).astimezone(tz()).replace(tzinfo=None)


async def records_between(start: date, end_inclusive: date, site_id=None, user_id=None) -> list:
    a, b = utc_bounds(start, end_inclusive)
    q = {"clock_in": {"$gte": a, "$lt": b}}
    if site_id:
        q["site_id"] = site_id
    if user_id:
        q["user_id"] = user_id
    return await db.clock_records.find(q).sort("clock_in", 1).to_list(100000)


async def payroll_entries(start: date, end_inclusive: date, site_id=None, user_id=None) -> list:
    """Records with overtime split per pay week. Overtime is worked out on each person's whole
    week (all jobs), then filtered, so a one-job download still shows the right overtime."""
    threshold, mult = ot_settings()
    first_week = week_of(start)
    records = await records_between(first_week, max(end_inclusive, first_week), user_id=user_id)
    entries = []
    week = first_week
    while week <= end_inclusive:
        a, b = utc_bounds(week, week + timedelta(days=6))
        in_week = [r for r in records if a <= r["clock_in"] < b]
        entries += L.split_overtime(in_week, threshold, mult)
        week += timedelta(days=7)
    a, b = utc_bounds(start, end_inclusive)
    return [e for e in entries if a <= e["clock_in"] < b and (not site_id or e.get("site_id") == site_id)]


def _money(summary: dict) -> dict:
    def conv(t):
        return {**t, "pay": L.to_dollars(t["pay"])}
    return {"totals": conv(summary["totals"]),
            "by_site": [conv(s) for s in summary["by_site"]],
            "by_user": [{**conv(u), "jobs": [conv(j) for j in u["jobs"]]} for u in summary["by_user"]]}


# --------------------------------------------------------------------------- overview
@router.get("/overview")
async def overview(week_start: Optional[str] = Query(None),
                   current_user: dict = Depends(require_roles(*ACCOUNTING_ROLES))):
    start = week_of(L.parse_date(week_start) or local_today())
    end = start + timedelta(days=6)
    entries = await payroll_entries(start, end)
    labour = _money(L.summarize_payroll(entries))
    threshold, mult = ot_settings()
    warnings = []
    for u in labour["by_user"]:
        if u["missing_rate"]:
            warnings.append("%s has hours with no pay rate set" % u["user_name"])
        if u["open_shifts"]:
            warnings.append("%s is still clocked in (%d open shift%s counted up to now)"
                            % (u["user_name"], u["open_shifts"], "" if u["open_shifts"] == 1 else "s"))
    flagged = sum(1 for e in entries if e.get("flagged"))
    if flagged:
        warnings.append("%d clock-in%s flagged for review (outside the site or no GPS)" % (flagged, "" if flagged == 1 else "s"))

    from features.invoices import invoice_out, summary as ar_summary
    today = local_today()
    a, b = start.isoformat(), end.isoformat()
    outstanding, drafts, sent_week, paid_week, holdback_by_site = [], [], [], [], {}
    async for inv in db.invoices.find({}).sort("created_at", -1):
        d = invoice_out(inv)
        if d["status"] == "draft":
            drafts.append(d)
            continue
        hb = holdback_by_site.setdefault(d["site_id"], {"site_id": d["site_id"], "site_name": d["site_name"],
                                                        "holdback": 0.0, "billed": 0.0})
        hb["holdback"] = round(hb["holdback"] + d["holdback"], 2)
        hb["billed"] = round(hb["billed"] + d["gross"], 2)
        if d["balance"] > 0:
            due = L.parse_date(d.get("due_date"))
            d["overdue_days"] = (today - due).days if due and due < today else 0
            outstanding.append(d)
        if a <= (d.get("submitted_at") or "") <= b:
            sent_week.append(d)
        week_pay = [p for p in d["payments"] if a <= (p.get("paid_on") or "") <= b]
        if week_pay:
            paid_week.append({**d, "paid_this_week": round(sum(p["amount"] for p in week_pay), 2)})
    outstanding.sort(key=lambda d: (-(d["overdue_days"] or 0), d.get("due_date") or ""))
    return {
        "week": {"start": a, "end": b, "today": today.isoformat(),
                 "overtime_after_hours": threshold, "overtime_multiplier": mult},
        "labour": {**labour, "warnings": warnings},
        "draws": {
            "summary": await ar_summary(current_user),
            "outstanding": outstanding,
            "overdue_total": round(sum(d["balance"] for d in outstanding if d["overdue_days"]), 2),
            "drafts": drafts,
            "sent_this_week": sent_week,
            "paid_this_week": paid_week,
            "received_this_week": round(sum(d["paid_this_week"] for d in paid_week), 2),
            "holdback_by_site": sorted(holdback_by_site.values(), key=lambda h: -h["holdback"]),
        },
    }


# --------------------------------------------------------------------------- downloads
class ExportIn(BaseModel):
    kind: str = "hours"                 # hours | draws
    start: Optional[str] = None
    end: Optional[str] = None
    site_id: Optional[str] = None       # hours for one job only
    user_id: Optional[str] = None       # hours for one employee only
    format: str = "xlsx"                # xlsx (one workbook, a tab per job and employee) | zip


@router.post("/export-link")
async def export_link(body: ExportIn, current_user: dict = Depends(require_roles(*ACCOUNTING_ROLES))):
    if body.kind not in ("hours", "draws") or body.format not in ("xlsx", "zip"):
        raise HTTPException(status_code=400, detail="Unknown download type")
    start, end = L.parse_date(body.start), L.parse_date(body.end)
    if body.kind == "hours":
        if not start or not end:
            raise HTTPException(status_code=400, detail="Choose a start and end date")
        if end < start:
            raise HTTPException(status_code=400, detail="The end date is before the start date")
        if (end - start).days > 400:
            raise HTTPException(status_code=400, detail="Download at most about a year at a time")
    claims = {k: v for k, v in body.model_dump().items() if v}
    token = make_link_token("accounting_export", claims, LINK_MINUTES)
    return {"url": "/api/accounting/export?token=%s" % token, "expires_minutes": LINK_MINUTES}


@router.get("/export")
async def export(token: str = Query(...)):
    c = read_link_token(token, "accounting_export")
    stamp = local_today().isoformat()
    if c.get("kind") == "draws":
        data = await draws_workbook()
        return _file(data, "vanguard_invoice_register_%s.xlsx" % stamp, XLSX)
    start, end = L.parse_date(c["start"]), L.parse_date(c["end"])
    entries = await payroll_entries(start, end, c.get("site_id"), c.get("user_id"))
    label = "%s_to_%s" % (start.isoformat(), end.isoformat())
    if c.get("format") == "zip":
        return _file(hours_zip(entries, start, end), "vanguard_hours_%s.zip" % label, "application/zip")
    return _file(hours_workbook(entries, start, end, per_tab=True), "vanguard_hours_%s.xlsx" % label, XLSX)


def _file(data: bytes, filename: str, media: str):
    return StreamingResponse(io.BytesIO(data), media_type=media,
                             headers={"Content-Disposition": 'attachment; filename="%s"' % filename,
                                      "Cache-Control": "no-store"})


# --------------------------------------------------------------------------- workbook building
ENTRY_HEADERS = ["Date", "Day", "Employee", "Job", "Task", "Clock in", "Clock out", "Hours", "Regular",
                 "Overtime", "Pay rate", "Pay", "Flagged", "Note"]


def _entry_row(e: dict) -> list:
    cin, cout = to_local(e.get("clock_in")), to_local(e.get("clock_out"))
    return [cin.date() if cin else None, cin.strftime("%a") if cin else "", e.get("user_name"), e.get("site_name"),
            e.get("task_title") or "", cin.strftime("%H:%M") if cin else "", cout.strftime("%H:%M") if cout else "open",
            round(e["hours"], 2), round(e["regular_hours"], 2), round(e["overtime_hours"], 2),
            float(e.get("pay_rate") or 0), L.to_dollars(e["pay"]), "yes" if e.get("flagged") else "",
            e.get("flag_reason") or ("still clocked in" if not e.get("clock_out") else "")]


def _styles():
    from openpyxl.styles import Alignment, Font, PatternFill
    return {"head_font": Font(bold=True, color="FFFFFF"),
            "head_fill": PatternFill(start_color="0B2556", end_color="0B2556", fill_type="solid"),
            "title": Font(bold=True, size=14, color="0B2556"), "bold": Font(bold=True),
            "center": Alignment(horizontal="center")}


def _table(ws, headers, rows, st, total_cols=None, start_row=None):
    """Header row + rows + optional totals row (sums of the named columns). Money/hour formats."""
    r0 = start_row or (ws.max_row + 2 if ws.max_row > 1 else 1)
    for i, h in enumerate(headers, 1):
        c = ws.cell(row=r0, column=i, value=h)
        c.font, c.fill, c.alignment = st["head_font"], st["head_fill"], st["center"]
    for j, row in enumerate(rows, 1):
        for i, v in enumerate(row, 1):
            ws.cell(row=r0 + j, column=i, value=v)
    last = r0 + len(rows)
    if total_cols and rows:
        from openpyxl.utils import get_column_letter
        ws.cell(row=last + 1, column=1, value="Total").font = st["bold"]
        for name in total_cols:
            i = headers.index(name) + 1
            col = get_column_letter(i)
            c = ws.cell(row=last + 1, column=i, value="=SUM(%s%d:%s%d)" % (col, r0 + 1, col, last))
            c.font = st["bold"]
        last += 1
    for i, h in enumerate(headers, 1):
        fmt = '"$"#,##0.00' if h in ("Pay", "Pay rate", "Labour cost") else "0.00" if h in (
            "Hours", "Regular", "Overtime") else "yyyy-mm-dd" if h == "Date" else None
        if fmt:
            for r in range(r0 + 1, last + 1):
                ws.cell(row=r, column=i).number_format = fmt
    ws.freeze_panes = ws.cell(row=r0 + 1, column=1) if r0 == 1 else ws.freeze_panes
    return last


def _widths(ws):
    from openpyxl.utils import get_column_letter
    for col in range(1, ws.max_column + 1):
        longest = max((len(str(ws.cell(row=r, column=col).value or "")) for r in range(1, ws.max_row + 1)), default=8)
        ws.column_dimensions[get_column_letter(col)].width = min(max(10, longest + 2), 42)


def _sheet_name(name: str, used: set) -> str:
    base = re.sub(r"[\[\]\*\?/\\:]", "", name or "Sheet").strip()[:28] or "Sheet"
    candidate, n = base, 2
    while candidate.lower() in used:
        candidate = "%s %d" % (base[:25], n)
        n += 1
    used.add(candidate.lower())
    return candidate


def _title(ws, text, sub, st):
    ws.cell(row=1, column=1, value=text).font = st["title"]
    ws.cell(row=2, column=1, value=sub)
    return 4


def hours_workbook(entries: list, start: date, end: date, per_tab: bool = True, title: Optional[str] = None) -> bytes:
    from openpyxl import Workbook
    st = _styles()
    summary = L.summarize_payroll(entries)
    threshold, mult = ot_settings()
    period = "%s to %s  ·  overtime after %g hours/week at %gx" % (start.isoformat(), end.isoformat(), threshold, mult)
    wb = Workbook()
    used = set()

    ws = wb.active
    ws.title = _sheet_name("Summary by job", used)
    r = _title(ws, title or "Hours and labour by job", period, st)
    _table(ws, ["Job", "Workers", "Shifts", "Hours", "Regular", "Overtime", "Labour cost"],
           [[s["site_name"], s["workers"], s["shifts"], s["hours"], s["regular_hours"], s["overtime_hours"],
             L.to_dollars(s["pay"])] for s in summary["by_site"]], st,
           ["Shifts", "Hours", "Regular", "Overtime", "Labour cost"], start_row=r)
    _widths(ws)

    ws = wb.create_sheet(_sheet_name("Summary by employee", used))
    r = _title(ws, "Hours and pay by employee", period, st)
    rows = []
    for u in summary["by_user"]:
        rows.append([u["user_name"], "All jobs", u["shifts"], u["hours"], u["regular_hours"], u["overtime_hours"],
                     L.to_dollars(u["pay"])])
    _table(ws, ["Employee", "Job", "Shifts", "Hours", "Regular", "Overtime", "Pay"], rows, st,
           ["Shifts", "Hours", "Regular", "Overtime", "Pay"], start_row=r)
    rows = [[u["user_name"], j["site_name"], j["shifts"], j["hours"], j["regular_hours"], j["overtime_hours"],
             L.to_dollars(j["pay"])] for u in summary["by_user"] for j in u["jobs"]]
    ws.cell(row=ws.max_row + 2, column=1, value="By employee and job").font = st["bold"]
    _table(ws, ["Employee", "Job", "Shifts", "Hours", "Regular", "Overtime", "Pay"], rows, st, start_row=ws.max_row + 1)
    _widths(ws)

    ws = wb.create_sheet(_sheet_name("All entries", used))
    _table(ws, ENTRY_HEADERS, [_entry_row(e) for e in _by_time(entries)], st, ["Hours", "Regular", "Overtime", "Pay"],
           start_row=1)
    _widths(ws)

    if per_tab:
        for s in summary["by_site"]:
            ws = wb.create_sheet(_sheet_name("Job - " + (s["site_name"] or "?"), used))
            _table(ws, ENTRY_HEADERS, [_entry_row(e) for e in _by_time(entries) if e.get("site_id") == s["site_id"]],
                   st, ["Hours", "Regular", "Overtime", "Pay"], start_row=1)
            _widths(ws)
        for u in summary["by_user"]:
            ws = wb.create_sheet(_sheet_name(u["user_name"] or "?", used))
            _table(ws, ENTRY_HEADERS, [_entry_row(e) for e in _by_time(entries) if e.get("user_id") == u["user_id"]],
                   st, ["Hours", "Regular", "Overtime", "Pay"], start_row=1)
            _widths(ws)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _by_time(entries):
    return sorted(entries, key=lambda e: (e.get("clock_in") or datetime.min, e.get("user_name") or ""))


def _file_name(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9 ._-]+", "", name or "unnamed").strip().replace(" ", "_")[:60] or "unnamed"


def hours_zip(entries: list, start: date, end: date) -> bytes:
    """A summary workbook plus one workbook per job (Jobs/) and per employee (Employees/)."""
    summary = L.summarize_payroll(entries)
    label = "%s_to_%s" % (start.isoformat(), end.isoformat())
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("Summary_%s.xlsx" % label, hours_workbook(entries, start, end, per_tab=False))
        for s in summary["by_site"]:
            sub = [e for e in entries if e.get("site_id") == s["site_id"]]
            z.writestr("Jobs/%s_%s.xlsx" % (_file_name(s["site_name"]), label),
                       hours_workbook(sub, start, end, per_tab=False, title="Hours and labour: %s" % s["site_name"]))
        for u in summary["by_user"]:
            sub = [e for e in entries if e.get("user_id") == u["user_id"]]
            z.writestr("Employees/%s_%s.xlsx" % (_file_name(u["user_name"]), label),
                       hours_workbook(sub, start, end, per_tab=False, title="Hours and pay: %s" % u["user_name"]))
    return buf.getvalue()


async def draws_workbook() -> bytes:
    """Invoice register: every progress draw with amounts, dates, payments and balance."""
    from openpyxl import Workbook
    from features.invoices import invoice_out
    st = _styles()
    wb = Workbook()
    ws = wb.active
    ws.title = "Invoice register"
    headers = ["Invoice", "Job", "Draw", "Status", "Bill to", "Invoice date", "Due date", "% complete", "Gross",
               "Holdback", "Net", "GST", "Total due", "Paid", "Balance", "Days outstanding"]
    rows = []
    async for inv in db.invoices.find({}).sort([("site_name", 1), ("number", 1)]):
        d = invoice_out(inv)
        rows.append([d["invoice_number"], d["site_name"], d["number"], d["status"].replace("_", " "),
                     (d.get("bill_to") or "").split("\n")[0], d.get("invoice_date") or "", d.get("due_date") or "",
                     d.get("percent_complete"), d["gross"], d["holdback"], d["net"], d["tax"], d["total_due"],
                     d["paid_total"], d["balance"] if d["status"] != "draft" else None, d.get("days_outstanding")])
    last = _table(ws, headers, rows, st, ["Gross", "Holdback", "Net", "GST", "Total due", "Paid", "Balance"], start_row=1)
    for col in range(9, 16):
        for r in range(2, last + 1):
            ws.cell(row=r, column=col).number_format = '"$"#,##0.00'
    _widths(ws)

    ws = wb.create_sheet("Payments")
    prow = []
    async for inv in db.invoices.find({"payments.0": {"$exists": True}}).sort("site_name", 1):
        for p in inv.get("payments", []):
            prow.append([p.get("paid_on"), inv["invoice_number"], inv["site_name"], p.get("reference") or "",
                         L.to_dollars(p.get("amount")), p.get("recorded_by_name") or ""])
    prow.sort(key=lambda r: r[0] or "")
    last = _table(ws, ["Date received", "Invoice", "Job", "Reference", "Amount", "Recorded by"], prow, st, ["Amount"],
                  start_row=1)
    for r in range(2, last + 1):
        ws.cell(row=r, column=5).number_format = '"$"#,##0.00'
    _widths(ws)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
