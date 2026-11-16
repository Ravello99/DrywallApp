"""The printable progress-draw invoice (HTML, print or "Save as PDF" from any browser).

Company details come from backend/.env so they can change without code changes:
COMPANY_NAME, COMPANY_ADDRESS, COMPANY_PHONE, COMPANY_EMAIL, COMPANY_GST_NUMBER,
PAYMENT_TERMS_DAYS (default 30)."""
import base64
import html
import os
from pathlib import Path

import logic as L

ROOT = Path(__file__).resolve().parent.parent.parent


def company() -> dict:
    return {
        "name": os.environ.get("COMPANY_NAME", "VanGuard Drywall & Acoustics"),
        "address": os.environ.get("COMPANY_ADDRESS", "3 - 55 Oakdale Ave\nSt. Catharines, ON").replace("\\n", "\n"),
        "phone": os.environ.get("COMPANY_PHONE", "289-866-7222"),
        "email": os.environ.get("COMPANY_EMAIL", "info@AltraDrywall.ca"),
        "gst_number": os.environ.get("COMPANY_GST_NUMBER", ""),
    }


def payment_terms_days() -> int:
    try:
        return max(0, int(os.environ.get("PAYMENT_TERMS_DAYS", "30")))
    except ValueError:
        return 30


_logo_cache = {}


def _logo_data_uri() -> str:
    if "uri" not in _logo_cache:
        uri = ""
        for p in (ROOT / "website" / "assets" / "vanguard-logo.png",
                  ROOT / "frontend" / "assets" / "images" / "vanguard-logo.png"):
            if p.is_file():
                uri = "data:image/png;base64," + base64.b64encode(p.read_bytes()).decode()
                break
        _logo_cache["uri"] = uri
    return _logo_cache["uri"]


def _e(v) -> str:
    return html.escape("" if v is None else str(v))


def _lines(v) -> str:
    return "<br>".join(_e(x) for x in str(v or "").splitlines() if x.strip())


def _m(cents) -> str:
    cents = int(cents or 0)
    sign = "-" if cents < 0 else ""
    return "%s$%s" % (sign, "{:,.2f}".format(abs(cents) / 100.0))


def _d(iso) -> str:
    d = L.parse_date(iso)
    return d.strftime("%b %d, %Y").replace(" 0", " ") if d else ""


def render(inv: dict) -> str:
    snap = inv.get("snapshot") or {}
    co = snap.get("company") or company()
    contract = snap.get("contract") or {}
    status = L.invoice_status(inv)
    payments = inv.get("payments", [])
    paid = sum(int(p.get("amount", 0)) for p in payments)
    balance = L.invoice_balance(inv)
    draft = status == "draft"
    logo = _logo_data_uri()
    rows_contract = [
        ("Original contract", contract.get("original")),
        ("Approved change orders", contract.get("approved_changes")),
        ("Revised contract", contract.get("revised")),
        ("Billed before this draw", inv.get("previous_billed")),
        ("Billed to date including this draw", (inv.get("previous_billed") or 0) + (inv.get("gross") or 0)),
        ("Remaining to bill", contract.get("remaining_after")),
    ]
    pct = inv.get("percent_complete")
    gst_label = "GST (%s%%)" % ("%g" % inv.get("tax_pct", 0))
    holdback_label = "Less holdback (%s%%)" % ("%g" % inv.get("holdback_pct", 0))
    pay_rows = "".join(
        "<tr><td>%s</td><td>%s</td><td class='num'>%s</td></tr>" % (_d(p.get("paid_on")), _e(p.get("reference") or ""),
                                                                   _m(p.get("amount")))
        for p in payments)
    return """<!DOCTYPE html>
<html lang="en-CA"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Invoice %(number)s - %(project)s</title>
<style>
  :root { --navy:#0B2556; --gold:#B4973A; --ink:#202732; --muted:#5B6E7C; --line:#DDE1DD; }
  * { box-sizing:border-box; }
  body { margin:0; background:#E9ECE9; font:14px/1.5 -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color:var(--ink); }
  .bar { max-width:850px; margin:16px auto 0; display:flex; gap:8px; justify-content:flex-end; padding:0 12px; }
  .bar button { font:inherit; font-weight:700; padding:9px 16px; border-radius:4px; border:0; cursor:pointer; background:var(--navy); color:#fff; }
  .page { position:relative; max-width:850px; margin:12px auto 32px; background:#fff; padding:44px 48px; box-shadow:0 1px 3px rgba(0,0,0,.08); overflow:hidden; }
  .draft { position:absolute; top:38%%; left:0; right:0; text-align:center; transform:rotate(-24deg); font-size:120px; font-weight:800; color:rgba(180,151,58,.16); pointer-events:none; letter-spacing:.08em; }
  header { display:flex; justify-content:space-between; gap:24px; border-bottom:4px solid var(--navy); padding-bottom:18px; }
  header img { height:54px; }
  .co { text-align:right; color:var(--muted); font-size:13px; }
  .co strong { color:var(--navy); font-size:15px; }
  h1 { margin:26px 0 4px; color:var(--navy); font-size:28px; letter-spacing:.01em; }
  .sub { color:var(--muted); margin:0 0 22px; }
  .meta { display:grid; grid-template-columns:1fr 1fr 1fr; gap:20px; margin-bottom:26px; }
  .meta h3 { margin:0 0 4px; font-size:12px; color:var(--muted); font-weight:600; }
  .meta p { margin:0; }
  table { width:100%%; border-collapse:collapse; margin-bottom:22px; }
  th { text-align:left; font-size:12px; color:var(--muted); font-weight:600; border-bottom:2px solid var(--navy); padding:6px 8px; }
  td { padding:7px 8px; border-bottom:1px solid var(--line); vertical-align:top; }
  .num { text-align:right; white-space:nowrap; font-variant-numeric:tabular-nums; }
  .totals { margin-left:auto; width:min(380px,100%%); }
  .totals td { border:0; padding:5px 8px; }
  .totals tr.due td { border-top:2px solid var(--navy); font-weight:800; font-size:17px; color:var(--navy); padding-top:9px; }
  .totals tr.bal td { font-weight:700; }
  .two { display:grid; grid-template-columns:1.2fr 1fr; gap:28px; align-items:start; }
  .note { color:var(--muted); font-size:13px; border-top:1px solid var(--line); padding-top:14px; margin-top:10px; }
  .status { display:inline-block; padding:2px 10px; border-radius:999px; background:#EEF1F6; color:var(--navy); font-weight:700; font-size:12px; }
  .status.paid { background:#E3F1E6; color:#2E6B3A; }
  @media (max-width:640px) { .page { padding:24px 18px; } .meta, .two { grid-template-columns:1fr; } header { flex-direction:column; } .co { text-align:left; } }
  @media print { body { background:#fff; } .bar { display:none; } .page { box-shadow:none; margin:0; max-width:none; padding:0; } @page { margin:16mm; } }
</style></head>
<body>
<div class="bar"><button onclick="window.print()">Print or save as PDF</button></div>
<div class="page">
  %(draft_mark)s
  <header>
    <div>%(logo)s</div>
    <div class="co"><strong>%(co_name)s</strong><br>%(co_address)s<br>%(co_phone)s<br>%(co_email)s%(gst)s</div>
  </header>
  <h1>Invoice %(number)s</h1>
  <p class="sub">Progress draw %(draw)s%(pct)s &nbsp; <span class="status %(status_cls)s">%(status)s</span></p>
  <div class="meta">
    <div><h3>Bill to</h3><p>%(bill_to)s</p></div>
    <div><h3>Project</h3><p><strong>%(project)s</strong>%(project_no)s<br>%(project_addr)s</p></div>
    <div><h3>Dates</h3><p>Invoice date: %(inv_date)s<br>%(period)sDue: %(due)s</p></div>
  </div>
  <table>
    <thead><tr><th>Description</th><th class="num">Amount</th></tr></thead>
    <tbody><tr><td>%(desc)s</td><td class="num">%(gross)s</td></tr></tbody>
  </table>
  <div class="two">
    <table>
      <thead><tr><th>Contract summary</th><th class="num"></th></tr></thead>
      <tbody>%(contract_rows)s</tbody>
    </table>
    <table class="totals"><tbody>
      <tr><td>Work this period</td><td class="num">%(gross)s</td></tr>
      <tr><td>%(holdback_label)s</td><td class="num">-%(holdback)s</td></tr>
      <tr><td>Subtotal</td><td class="num">%(net)s</td></tr>
      <tr><td>%(gst_label)s</td><td class="num">%(tax)s</td></tr>
      <tr class="due"><td>Total due</td><td class="num">%(total)s</td></tr>
      %(paid_rows)s
    </tbody></table>
  </div>
  %(payments)s
  <p class="note">Holdback of %(holdback)s on this draw (%(holdback_total)s held to date) is payable under the Construction Act once the holdback period ends.
  Please quote invoice %(number)s with your payment. %(terms)s</p>
</div>
</body></html>""" % {
        "number": _e(inv.get("invoice_number")),
        "project": _e(inv.get("site_name")),
        "draft_mark": '<div class="draft">DRAFT</div>' if draft else "",
        "logo": '<img src="%s" alt="%s">' % (logo, _e(co.get("name"))) if logo else "<strong>%s</strong>" % _e(co.get("name")),
        "co_name": _e(co.get("name")), "co_address": _lines(co.get("address")), "co_phone": _e(co.get("phone")),
        "co_email": _e(co.get("email")),
        "gst": "<br>GST/HST # %s" % _e(co["gst_number"]) if co.get("gst_number") else "",
        "draw": _e(inv.get("number")),
        "pct": " &middot; %s%% complete to date" % ("%g" % pct) if pct is not None else "",
        "status": _e({"draft": "Draft", "submitted": "Sent", "partially_paid": "Partly paid", "paid": "Paid"}.get(status, status)),
        "status_cls": "paid" if status == "paid" else "",
        "bill_to": _lines(snap.get("bill_to")) or "&nbsp;",
        "project_no": " (#%s)" % _e(snap.get("project_number")) if snap.get("project_number") else "",
        "project_addr": _e(snap.get("project_address")),
        "inv_date": _d(inv.get("invoice_date")) or "Not sent yet",
        "period": "Period ending: %s<br>" % _d(inv.get("period_end")) if inv.get("period_end") else "",
        "due": _d(inv.get("due_date")) or "%d days from invoice date" % payment_terms_days(),
        "desc": _e(inv.get("description") or "Drywall and acoustics work completed to date per contract"),
        "gross": _m(inv.get("gross")), "holdback": _m(inv.get("holdback")), "net": _m(inv.get("net")),
        "tax": _m(inv.get("tax")), "total": _m(inv.get("total_due")),
        "holdback_label": _e(holdback_label), "gst_label": _e(gst_label),
        "contract_rows": "".join("<tr><td>%s</td><td class='num'>%s</td></tr>" % (_e(k), _m(v))
                                 for k, v in rows_contract if v is not None),
        "paid_rows": ("<tr><td>Paid</td><td class='num'>-%s</td></tr><tr class='bal'><td>Balance owing</td>"
                      "<td class='num'>%s</td></tr>" % (_m(paid), _m(balance))) if paid else "",
        "payments": ("<table><thead><tr><th>Payment received</th><th>Reference</th><th class='num'>Amount</th></tr>"
                     "</thead><tbody>%s</tbody></table>" % pay_rows) if pay_rows else "",
        "holdback_total": _m(contract.get("holdback_to_date")),
        "terms": ("Payment due within %d days." % payment_terms_days()) if payment_terms_days() else "",
    }
