"""Business rules with no web or database code, so they can be unit-tested on their own
(see tests/test_logic.py). Money is handled in integer cents everywhere."""
from __future__ import annotations

import re
from datetime import date, datetime, timedelta
from typing import Dict, Iterable, List, Optional, Tuple

# --------------------------------------------------------------------------- money


def to_cents(dollars) -> int:
    """12.345 -> 1235. None -> 0. Rounds half up like an invoice would."""
    if dollars is None or dollars == "":
        return 0
    return int((float(dollars) * 100) + (0.5 if float(dollars) >= 0 else -0.5))


def to_dollars(cents) -> float:
    return round((cents or 0) / 100.0, 2)


def pct(part, whole) -> Optional[float]:
    """Percentage rounded to 1 decimal, or None when the whole is zero."""
    if not whole:
        return None
    return round(100.0 * (part or 0) / whole, 1)


# --------------------------------------------------------------------------- dates


def parse_date(value) -> Optional[date]:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = str(value).strip().replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(text).date()
    except ValueError:
        pass
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%d/%m/%Y", "%b %d, %Y", "%B %d, %Y", "%b %d %Y", "%B %d %Y"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    return None


def week_start(d: date) -> date:
    """Monday of the week containing d."""
    return d - timedelta(days=d.weekday())


def ranges_overlap(a_start: date, a_end: Optional[date], b_start: date, b_end: Optional[date]) -> bool:
    """Date ranges inclusive; an open end means 'ongoing'."""
    a_end = a_end or date.max
    b_end = b_end or date.max
    return a_start <= b_end and b_start <= a_end


# --------------------------------------------------------------------------- hours and budgets


def budget_status(budget_hours, actual_hours, warn_at: float = 0.9) -> str:
    """'no_budget' | 'ok' | 'warning' (>= 90% used) | 'over' (more than budget)."""
    if not budget_hours:
        return "no_budget"
    used = (actual_hours or 0) / float(budget_hours)
    if used > 1.0:
        return "over"
    if used >= warn_at:
        return "warning"
    return "ok"


def record_hours(record: dict, now: Optional[datetime] = None) -> float:
    """Hours on a clock record; an open record counts up to now."""
    if record.get("total_hours") is not None:
        return float(record["total_hours"])
    start = record.get("clock_in")
    if isinstance(start, datetime):
        end = record.get("clock_out") or now or datetime.utcnow()
        return max(0.0, (end - start).total_seconds() / 3600.0)
    return 0.0


def labour_totals(records: Iterable[dict], now: Optional[datetime] = None) -> Tuple[float, int]:
    """(hours, cost in cents) for clock records. Cost uses the pay rate saved on each record
    at clock-in, so later raises don't rewrite old job costs."""
    hours = 0.0
    cost = 0
    for r in records:
        h = record_hours(r, now)
        hours += h
        cost += int(round(h * float(r.get("pay_rate") or 0) * 100))
    return round(hours, 2), cost


# --------------------------------------------------------------------------- weekly payroll

OVERTIME_WEEKLY_HOURS = 44.0     # Ontario Employment Standards: overtime after 44 hours in a week
OVERTIME_MULTIPLIER = 1.5


def split_overtime(records: Iterable[dict], threshold: float = OVERTIME_WEEKLY_HOURS,
                   multiplier: float = OVERTIME_MULTIPLIER, now: Optional[datetime] = None) -> List[dict]:
    """One week of clock records -> the same records with hours, regular_hours, overtime_hours and
    pay (cents) added. Overtime goes to whichever shifts come after the threshold, in clock-in order,
    so the job the overtime was worked on carries its cost."""
    so_far = {}
    result = []
    for r in sorted(records, key=lambda x: (x.get("user_id") or "", x.get("clock_in") or datetime.min)):
        hours = round(record_hours(r, now), 4)
        before = so_far.get(r.get("user_id"), 0.0)
        regular = max(0.0, min(hours, threshold - before))
        overtime = hours - regular
        so_far[r.get("user_id")] = before + hours
        rate = float(r.get("pay_rate") or 0)
        pay = int(round((regular * rate + overtime * rate * multiplier) * 100))
        result.append({**r, "hours": hours, "regular_hours": regular, "overtime_hours": overtime, "pay": pay})
    return result


def summarize_payroll(entries: List[dict]) -> dict:
    """Totals by job and by employee (with each employee's jobs) from split_overtime() output."""
    def blank():
        return {"hours": 0.0, "regular_hours": 0.0, "overtime_hours": 0.0, "pay": 0, "shifts": 0}

    def add(t, e):
        for k in ("hours", "regular_hours", "overtime_hours"):
            t[k] += e[k]
        t["pay"] += e["pay"]
        t["shifts"] += 1

    totals, by_site, by_user = blank(), {}, {}
    for e in entries:
        add(totals, e)
        site = by_site.setdefault(e.get("site_id"), {**blank(), "site_id": e.get("site_id"),
                                                      "site_name": e.get("site_name"), "workers": set()})
        add(site, e)
        site["workers"].add(e.get("user_id"))
        user = by_user.setdefault(e.get("user_id"), {**blank(), "user_id": e.get("user_id"),
                                                      "user_name": e.get("user_name"), "jobs": {},
                                                      "missing_rate": False, "open_shifts": 0})
        add(user, e)
        if not e.get("pay_rate"):
            user["missing_rate"] = True
        if not e.get("clock_out"):
            user["open_shifts"] += 1
        job = user["jobs"].setdefault(e.get("site_id"), {**blank(), "site_id": e.get("site_id"),
                                                         "site_name": e.get("site_name")})
        add(job, e)

    def rnd(t):
        for k in ("hours", "regular_hours", "overtime_hours"):
            t[k] = round(t[k], 2)
        return t

    sites = []
    for site in by_site.values():
        site["workers"] = len(site["workers"])
        sites.append(rnd(site))
    users = []
    for user in by_user.values():
        user["jobs"] = sorted((rnd(j) for j in user["jobs"].values()), key=lambda j: -j["hours"])
        users.append(rnd(user))
    return {"totals": rnd(totals), "by_site": sorted(sites, key=lambda x: -x["pay"]),
            "by_user": sorted(users, key=lambda x: (x["user_name"] or "").lower())}


# --------------------------------------------------------------------------- workflows

SCOPES = {
    "steel_framing": "Steel Stud Framing",
    "drywall_boarding": "Drywall Boarding",
    "taping_finishing": "Taping & Finishing",
    "insulation": "Insulation",
    "acoustics": "Acoustic Ceilings",
    "general": "General / Site",
}

# Which trade usually does each scope (used to suggest crew for manpower requests).
SCOPE_SPECIALTY = {
    "steel_framing": "steel_framer",
    "drywall_boarding": "drywaller",
    "taping_finishing": "taper_finisher",
    "insulation": "insulator",
    "acoustics": "acoustic_ceilings",
    "general": "labourer",
}

# Standard task breakdown per scope, with each task's share of the scope's hours.
WORKFLOW_TEMPLATES: Dict[str, List[Tuple[str, float]]] = {
    "steel_framing": [
        ("Layout & chalk lines", 0.08),
        ("Top & bottom track", 0.12),
        ("Wall studs & openings", 0.35),
        ("Bulkheads & soffits", 0.15),
        ("Backing & blocking", 0.10),
        ("Shaft wall / fire-rated assemblies", 0.12),
        ("Framing inspection & deficiencies", 0.08),
    ],
    "drywall_boarding": [
        ("Board walls (one side)", 0.30),
        ("Board walls (second side, after services)", 0.30),
        ("Board ceilings & bulkheads", 0.25),
        ("Corner bead & trims", 0.10),
        ("Board inspection & deficiencies", 0.05),
    ],
    "taping_finishing": [
        ("Tape & first coat", 0.35),
        ("Second coat", 0.25),
        ("Third / skim coat (Level 4-5)", 0.20),
        ("Sanding", 0.15),
        ("Touch-ups & deficiencies", 0.05),
    ],
    "insulation": [
        ("Batt insulation in walls", 0.45),
        ("Sound attenuation (acoustic batts)", 0.30),
        ("Vapour barrier & sealing", 0.15),
        ("Insulation inspection", 0.10),
    ],
    "acoustics": [
        ("Ceiling grid layout & wall angle", 0.20),
        ("Main runners & cross tees", 0.35),
        ("Ceiling tile install", 0.30),
        ("Cut-ins around fixtures & deficiencies", 0.15),
    ],
    "general": [
        ("Mobilization & material handling", 0.40),
        ("Site cleanup & disposal", 0.40),
        ("Demobilization", 0.20),
    ],
}


def build_workflow_tasks(scope: str, total_hours: float) -> List[dict]:
    """Tasks for a scope, with the scope's budget hours split by the template's shares."""
    if scope not in WORKFLOW_TEMPLATES:
        raise ValueError("Unknown scope: %s" % scope)
    tasks = []
    template = WORKFLOW_TEMPLATES[scope]
    remaining = round(float(total_hours or 0), 1)
    for i, (title, share) in enumerate(template):
        hours = round(float(total_hours or 0) * share, 1) if i < len(template) - 1 else round(remaining, 1)
        remaining -= hours
        tasks.append({"title": title, "scope": scope, "budget_hours": max(hours, 0.0), "sequence": i + 1})
    return tasks


# --------------------------------------------------------------------------- progress draws (invoices)


def draw_amounts(gross_cents: int, holdback_pct: float, tax_pct: float) -> dict:
    """Amounts for one progress draw. Holdback (retainage) is kept back from the gross; tax is
    charged on the amount billed now (gross less holdback)."""
    holdback = int(round(gross_cents * (holdback_pct or 0) / 100.0))
    net = gross_cents - holdback
    tax = int(round(net * (tax_pct or 0) / 100.0))
    return {"gross": gross_cents, "holdback": holdback, "net": net, "tax": tax, "total_due": net + tax}


def money_text(cents) -> str:
    """12345 -> '$123.45' (for history notes and messages)."""
    cents = int(cents or 0)
    return "%s$%s" % ("-" if cents < 0 else "", "{:,.2f}".format(abs(cents) / 100.0))


def invoice_balance(invoice: dict) -> int:
    paid = sum(int(p.get("amount", 0)) for p in invoice.get("payments", []))
    return int(invoice.get("total_due", 0)) - paid


def invoice_status(invoice: dict) -> str:
    """draft | submitted | partially_paid | paid (derived from payments once submitted)."""
    if invoice.get("status") == "draft":
        return "draft"
    balance = invoice_balance(invoice)
    paid = sum(int(p.get("amount", 0)) for p in invoice.get("payments", []))
    if balance <= 0 and invoice.get("total_due", 0) > 0:
        return "paid"
    if paid > 0:
        return "partially_paid"
    return "submitted"


# --------------------------------------------------------------------------- job financials

EXPOSURE_ALERT_POINTS = 10.0   # materials % ahead of billed % by more than this -> alert


def job_financials(*, contract: int, approved_changes: int, billed_gross: int, paid: int,
                   labour_cost: int, material_released: int, material_budget: int = 0,
                   labour_budget: int = 0, holdback_held: int = 0) -> dict:
    """Money picture for one job. All inputs in cents.

    * revised_contract  = contract + approved change orders
    * percent_billed    = gross billed / revised contract
    * percent_materials = materials released / material budget
    * exposure_points   = percent_materials - percent_billed; positive means materials are
                          running ahead of billing (we're financing the job)
    * cash_exposure     = costs so far (labour + materials) - payments received
    * margin_to_date    = (billed - costs) / billed
    * projected_margin  = (revised contract - labour budget - material budget) / revised contract
    """
    revised = contract + approved_changes
    costs = labour_cost + material_released
    percent_billed = pct(billed_gross, revised)
    percent_materials = pct(material_released, material_budget)
    exposure = None
    if percent_materials is not None:
        exposure = round(percent_materials - (percent_billed or 0.0), 1)
    budgets = labour_budget + material_budget
    return {
        "contract": contract,
        "approved_changes": approved_changes,
        "revised_contract": revised,
        "billed_gross": billed_gross,
        "paid": paid,
        "outstanding_receivable": max(billed_gross - holdback_held - paid, 0),
        "holdback_held": holdback_held,
        "left_to_bill": max(revised - billed_gross, 0),
        "labour_cost": labour_cost,
        "material_released": material_released,
        "material_budget": material_budget,
        "labour_budget": labour_budget,
        "costs_to_date": costs,
        "percent_billed": percent_billed,
        "percent_materials": percent_materials,
        "exposure_points": exposure,
        "exposure_alert": exposure is not None and exposure > EXPOSURE_ALERT_POINTS,
        "cash_exposure": max(costs - paid, 0),
        "profit_to_date": billed_gross - costs,
        "margin_to_date": pct(billed_gross - costs, billed_gross),
        "projected_profit": (revised - budgets) if budgets else None,
        "projected_margin": pct(revised - budgets, revised) if budgets else None,
    }


# --------------------------------------------------------------------------- bids

BID_CATEGORIES = {
    "multi_family": "Multi-Family Residential",
    "commercial_fit_out": "Small Commercial Fit-Out",
    "institutional": "Institutional",
    "other": "Other",
}

BID_STATUSES = ["invited", "reviewing", "submitted", "won", "lost", "declined"]

_CATEGORY_KEYWORDS = {
    "institutional": [
        "hospital", "health", "medical", "clinic", "school", "elementary", "secondary", "university",
        "college", "campus", "data center", "data centre", "datacenter", "laboratory", "lab ",
        "library", "courthouse", "police", "fire hall", "firehall", "municipal", "government",
        "federal", "provincial", "long-term care", "long term care", "seniors", "care home",
        "airport", "transit", "correctional", "arena", "recreation centre", "community centre",
    ],
    "multi_family": [
        "multi-family", "multifamily", "multi family", "apartment", "apartments", "condo", "condos",
        "condominium", "townhouse", "townhome", "residential tower", "residences", "rental",
        "mixed-use residential", "suites", "units", "housing", "lofts", "student housing",
    ],
    "commercial_fit_out": [
        "fit-out", "fit out", "fitout", "tenant improvement", "ti ", "t.i.", "restaurant", "cafe",
        "coffee", "store", "storefront", "store-front", "retail", "boutique", "salon", "office",
        "bank", "branch", "dental", "gym", "fitness", "showroom", "bar ", "pub", "brewery",
        "renovation", "reno", "commercial unit", "cru",
    ],
}

_INVITE_PATTERNS = [
    r"invitation to (bid|tender|quote)", r"\binvited to bid\b", r"\bbid invit", r"\bitb\b",
    r"request for (quote|quotation|proposal|pricing|tender)", r"\brf[qp]\b", r"\btender\b",
    r"\bbids? (are )?due\b", r"\bbid date\b", r"\bpre-?bid\b", r"\bclosing date\b",
    r"buildingconnected", r"planhub", r"isqft", r"smartbid", r"procore", r"bidnet", r"merx",
    r"\bplans (and|&) specs\b", r"\bdrywall\b.*\bscope\b", r"\bsubmit (your )?(bid|price|pricing)\b",
]


def looks_like_bid_invite(subject: str, body: str) -> bool:
    text = ("%s\n%s" % (subject or "", body or "")).lower()
    return any(re.search(p, text) for p in _INVITE_PATTERNS)


# Generic words that appear on any kind of job count for less than building types.
_WEAK_KEYWORDS = {"renovation", "reno", "office", "units", "suites", "rental", "lab "}


def _keyword_hit(word: str, text: str) -> bool:
    w = word.strip()
    return re.search(r"(?<![a-z0-9])%s(?![a-z0-9])" % re.escape(w), text) is not None


def classify_bid(subject: str, body: str = "") -> Tuple[str, List[str]]:
    """Pick a category from whole-word keyword matches. Subject matches count double and
    building types (hospital, school, apartment, restaurant...) count three times as much as
    generic words (renovation, office...). Returns (category, matched keywords)."""
    subj = (subject or "").lower()
    text = (body or "").lower()
    best, best_score, best_hits = "other", 0, []
    for cat, words in _CATEGORY_KEYWORDS.items():
        score, hits = 0, []
        for w in words:
            in_subj, in_body = _keyword_hit(w, subj), _keyword_hit(w, text)
            if not (in_subj or in_body):
                continue
            weight = 1 if w in _WEAK_KEYWORDS else 3
            score += weight * ((2 if in_subj else 0) + (1 if in_body else 0))
            hits.append(w.strip())
        if score > best_score:
            best, best_score, best_hits = cat, score, hits
    return best, best_hits


_MONTHS = "jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec"
_DUE_PATTERNS = [
    r"(?:bids?|tenders?|quotes?|proposals?|pricing)\s+(?:are\s+)?(?:due|close|closing)\s*(?:date)?\s*(?:on|by|:)?\s*"
    r"(?:\w+day,?\s+)?(?P<d>[^\n;]{6,40})",
    r"(?:due|closing)\s+date\s*[:\-]?\s*(?:\w+day,?\s+)?(?P<d>[^\n;]{6,40})",
    r"bid date\s*[:\-]?\s*(?:\w+day,?\s+)?(?P<d>[^\n;]{6,40})",
]


def _date_from_fragment(fragment: str) -> Optional[date]:
    frag = fragment.strip()
    m = re.search(r"\d{4}-\d{2}-\d{2}", frag)
    if m:
        return parse_date(m.group(0))
    m = re.search(r"\d{1,2}/\d{1,2}/\d{4}", frag)
    if m:
        return parse_date(m.group(0))
    m = re.search(r"(%s)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}" % _MONTHS, frag, re.I)
    if m:
        cleaned = re.sub(r"(\d)(st|nd|rd|th)", r"\1", m.group(0)).replace(".", "").replace(",", "")
        parts = cleaned.split()
        try:
            return datetime.strptime("%s %s %s" % (parts[0][:3].title(), parts[1], parts[2]), "%b %d %Y").date()
        except ValueError:
            return None
    return None


def extract_due_date(subject: str, body: str) -> Optional[date]:
    text = "%s\n%s" % (subject or "", body or "")
    for pattern in _DUE_PATTERNS:
        for m in re.finditer(pattern, text, re.I):
            d = _date_from_fragment(m.group("d"))
            if d:
                return d
    return None


def clean_project_name(subject: str) -> str:
    """'Fwd: Invitation to Bid - Maple Ridge Elementary Reno' -> 'Maple Ridge Elementary Reno'."""
    s = re.sub(r"^\s*((re|fw|fwd)\s*:\s*)+", "", subject or "", flags=re.I)
    s = re.sub(r"^\s*(invitation to (bid|tender|quote)|bid invit\w*|itb|rfq|rfp|tender|request for "
               r"(quote|quotation|proposal|pricing))\s*[:\-–|]*\s*", "", s, flags=re.I)
    s = re.sub(r"^(for|on)\s+", "", s, flags=re.I)
    return s.strip(" -–|:") or (subject or "Untitled bid").strip()


def bid_stats(bids: List[dict], today: date, weeks: int = 12) -> dict:
    """Weekly submitted/won/lost counts, win rate (won / decided), follow-ups due and
    breakdown by category. Each bid dict uses: status, category, submitted_at, decided_at,
    follow_up_date, bid_amount (cents), due_date."""
    first_week = week_start(today) - timedelta(weeks=weeks - 1)
    weekly = {first_week + timedelta(weeks=i): {"submitted": 0, "won": 0, "lost": 0} for i in range(weeks)}
    by_cat = {c: {"submitted": 0, "won": 0, "lost": 0, "open": 0} for c in BID_CATEGORIES}

    def bump(when, key):
        d = parse_date(when)
        if d:
            wk = week_start(d)
            if wk in weekly:
                weekly[wk][key] += 1

    won = lost = 0
    pipeline = 0
    followups = []
    due_soon = []
    for b in bids:
        status = b.get("status")
        cat = b.get("category") if b.get("category") in by_cat else "other"
        if b.get("submitted_at"):
            bump(b["submitted_at"], "submitted")
            by_cat[cat]["submitted"] += 1
        if status == "won":
            won += 1
            by_cat[cat]["won"] += 1
            bump(b.get("decided_at") or b.get("submitted_at"), "won")
        elif status == "lost":
            lost += 1
            by_cat[cat]["lost"] += 1
            bump(b.get("decided_at") or b.get("submitted_at"), "lost")
        elif status == "submitted":
            pipeline += int(b.get("bid_amount") or 0)
        if status in ("invited", "reviewing", "submitted"):
            by_cat[cat]["open"] += 1
        fu = parse_date(b.get("follow_up_date"))
        if status == "submitted" and fu and fu <= today:
            followups.append(b)
        due = parse_date(b.get("due_date"))
        if status in ("invited", "reviewing") and due and today <= due <= today + timedelta(days=7):
            due_soon.append(b)

    for c in by_cat.values():
        c["win_rate"] = pct(c["won"], c["won"] + c["lost"])
    this_week = weekly.get(week_start(today), {"submitted": 0})
    return {
        "weekly": [{"week_start": wk.isoformat(), **v} for wk, v in sorted(weekly.items())],
        "submitted_this_week": this_week["submitted"],
        "won": won,
        "lost": lost,
        "win_rate": pct(won, won + lost),
        "pipeline_value": pipeline,
        "followups_due": len(followups),
        "due_this_week": len(due_soon),
        "by_category": by_cat,
    }


def default_follow_up(submitted: date, days: int = 7) -> date:
    return submitted + timedelta(days=days)
