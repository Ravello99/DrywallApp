"""Progress draw invoices: bill by % complete or by amount, hold back retainage, add tax,
record payments, and see what's paid and outstanding (with aging).

Every draw is a real invoice: it keeps a snapshot of the bill-to, project and contract figures
(refreshed while it's a draft, frozen when it's sent), a history of every change and payment,
and a printable invoice page (GET /api/invoices/{id}/document, opened through a short-lived link)."""
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import HTMLResponse
from jose import JWTError, jwt
from pydantic import BaseModel, Field

import logic as L
from core import ALGORITHM, OFFICE_ROLES, ROLE_ADMIN, ROLE_COORDINATOR, ROLE_PM, SECRET_KEY, db, get_site_or_404, \
    next_number, oid, out, require_roles
from features import invoice_doc

router = APIRouter(prefix="/api/invoices", tags=["progress draws"])

BILLERS = (ROLE_ADMIN, ROLE_COORDINATOR, ROLE_PM)
MONEY = ("gross", "holdback", "net", "tax", "total_due", "previous_billed", "balance", "paid_total")
DEFAULT_HOLDBACK_PCT = 10.0
DEFAULT_TAX_PCT = 5.0


class DrawIn(BaseModel):
    site_id: str
    period_end: Optional[str] = None
    mode: str = Field(default="percent", pattern="^(percent|amount)$")
    percent_complete: Optional[float] = Field(default=None, ge=0, le=100)   # cumulative % of revised contract
    amount: Optional[float] = Field(default=None, ge=0)                     # gross this period, dollars
    holdback_pct: float = Field(default=DEFAULT_HOLDBACK_PCT, ge=0, le=50)
    tax_pct: float = Field(default=DEFAULT_TAX_PCT, ge=0, le=30)
    description: Optional[str] = None
    invoice_number: Optional[str] = None
    bill_to: Optional[str] = Field(default=None, max_length=500)   # GC name and billing address


class PaymentIn(BaseModel):
    amount: float = Field(gt=0)
    paid_on: Optional[str] = None
    reference: Optional[str] = None        # cheque # / EFT ref


def invoice_out(inv: dict) -> dict:
    payments = inv.get("payments", [])
    d = out({**inv, "balance": L.invoice_balance(inv),
             "paid_total": sum(int(p.get("amount", 0)) for p in payments),
             "status": L.invoice_status(inv)}, MONEY)
    d["payments"] = [{**p, "amount": L.to_dollars(p.get("amount"))} for p in payments]
    snap = inv.get("snapshot") or {}
    d["snapshot"] = {**snap, "contract": {k: L.to_dollars(v) for k, v in (snap.get("contract") or {}).items()}}
    d["bill_to"] = snap.get("bill_to")
    d["history"] = inv.get("history", [])
    submitted = L.parse_date(inv.get("submitted_at"))
    d["days_outstanding"] = (datetime.utcnow().date() - submitted).days \
        if submitted and d["status"] in ("submitted", "partially_paid") else None
    return d


async def billed_to_date(site_id: str, exclude_id=None) -> int:
    total = 0
    async for inv in db.invoices.find({"site_id": site_id}, {"gross": 1}):
        if exclude_id is None or inv["_id"] != exclude_id:
            total += int(inv.get("gross") or 0)
    return total


async def revised_contract_cents(site: dict) -> int:
    from features.change_orders import approved_changes_cents
    return L.to_cents(site.get("contract_value")) + await approved_changes_cents(str(site["_id"]))


async def _compute(site: dict, body: DrawIn, exclude_id=None) -> dict:
    previous = await billed_to_date(str(site["_id"]), exclude_id)
    revised = await revised_contract_cents(site)
    if body.mode == "percent":
        if body.percent_complete is None:
            raise HTTPException(status_code=400, detail="Enter the % complete")
        if not revised:
            raise HTTPException(status_code=400, detail="Set the project's contract value first")
        gross = int(round(revised * body.percent_complete / 100.0)) - previous
        if gross <= 0:
            raise HTTPException(status_code=400, detail="That percentage is already billed (%.1f%% billed so far)"
                                % (100.0 * previous / revised))
    else:
        if body.amount is None:
            raise HTTPException(status_code=400, detail="Enter the amount for this draw")
        gross = L.to_cents(body.amount)
    if revised and previous + gross > revised:
        raise HTTPException(status_code=400, detail="This draw would bill more than the revised contract "
                                                    "($%.2f). Add a change order first." % L.to_dollars(revised))
    amounts = L.draw_amounts(gross, body.holdback_pct, body.tax_pct)
    return {**amounts, "previous_billed": previous,
            "percent_complete": round(100.0 * (previous + gross) / revised, 1) if revised else None}


def _event(user: dict, text: str) -> dict:
    return {"at": datetime.utcnow(), "by": user["name"], "text": text}


async def _snapshot(site: dict, bill_to: Optional[str], computed: dict, exclude_id=None) -> dict:
    """What the printed invoice shows besides the draw amounts. Money in cents."""
    from features.change_orders import approved_changes_cents
    original = L.to_cents(site.get("contract_value"))
    changes = await approved_changes_cents(str(site["_id"]))
    revised = original + changes
    held = computed.get("holdback", 0)
    async for other in db.invoices.find({"site_id": str(site["_id"]), "status": {"$ne": "draft"}}, {"holdback": 1}):
        if other["_id"] != exclude_id:
            held += int(other.get("holdback") or 0)
    return {
        "company": invoice_doc.company(),
        "bill_to": (bill_to or "").strip() or site.get("billing_to") or site.get("general_contractor") or "",
        "project_number": site.get("project_number"),
        "project_address": site.get("address"),
        "contract": {"original": original, "approved_changes": changes, "revised": revised,
                     "remaining_after": max(revised - computed["previous_billed"] - computed["gross"], 0) if revised else None,
                     "holdback_to_date": held},
    }


async def _remember_bill_to(site: dict, bill_to: Optional[str]) -> None:
    if bill_to and bill_to.strip() and bill_to.strip() != site.get("billing_to"):
        await db.sites.update_one({"_id": site["_id"]}, {"$set": {"billing_to": bill_to.strip()}})


@router.post("")
async def create_draw(body: DrawIn, current_user: dict = Depends(require_roles(*BILLERS))):
    site = await get_site_or_404(body.site_id)
    computed = await _compute(site, body)
    number = await next_number("invoices", body.site_id)
    invoice_number = body.invoice_number or "%s-D%02d" % (site.get("project_number") or "INV", number)
    if await db.invoices.find_one({"invoice_number": invoice_number}):
        raise HTTPException(status_code=400, detail="Invoice number %s is already used" % invoice_number)
    doc = {"site_id": body.site_id, "site_name": site["name"], "number": number,
           "invoice_number": invoice_number,
           "period_end": body.period_end, "description": body.description, "mode": body.mode,
           "holdback_pct": body.holdback_pct, "tax_pct": body.tax_pct, **computed, "status": "draft",
           "snapshot": await _snapshot(site, body.bill_to, computed),
           "history": [_event(current_user, "Draft created for %s" % L.money_text(computed["total_due"]))],
           "payments": [], "created_by": str(current_user["_id"]), "created_by_name": current_user["name"],
           "created_at": datetime.utcnow()}
    res = await db.invoices.insert_one(doc)
    doc["_id"] = res.inserted_id
    await _remember_bill_to(site, body.bill_to)
    return invoice_out(doc)


@router.get("/defaults")
async def draw_defaults(site_id: str = Query(...), current_user: dict = Depends(require_roles(*BILLERS))):
    """Starting values for the New draw form: bill-to and the rates used on the last draw."""
    site = await get_site_or_404(site_id)
    last = await db.invoices.find({"site_id": site_id}).sort("number", -1).limit(1).to_list(1)
    last = last[0] if last else {}
    return {"bill_to": site.get("billing_to") or site.get("general_contractor") or "",
            "holdback_pct": last.get("holdback_pct", DEFAULT_HOLDBACK_PCT),
            "tax_pct": last.get("tax_pct", DEFAULT_TAX_PCT),
            "payment_terms_days": invoice_doc.payment_terms_days()}


@router.get("")
async def list_draws(site_id: Optional[str] = Query(None), status: Optional[str] = Query(None),
                     current_user: dict = Depends(require_roles(*OFFICE_ROLES))):
    q = {"site_id": site_id} if site_id else {}
    docs = await db.invoices.find(q).sort([("site_name", 1), ("number", -1)]).to_list(5000)
    result = [invoice_out(d) for d in docs]
    if status:
        wanted = set(status.split(","))
        result = [r for r in result if r["status"] in wanted]
    return result


@router.get("/summary")
async def summary(current_user: dict = Depends(require_roles(*OFFICE_ROLES))):
    """Totals across all jobs: billed, paid, outstanding, holdback held, aging buckets."""
    totals = {"billed_gross": 0, "billed_total": 0, "paid": 0, "outstanding": 0, "holdback_held": 0}
    aging = {"0-30": 0, "31-60": 0, "61-90": 0, "90+": 0}
    today = datetime.utcnow().date()
    async for inv in db.invoices.find({"status": {"$ne": "draft"}}):
        bal = L.invoice_balance(inv)
        totals["billed_gross"] += inv.get("gross", 0)
        totals["billed_total"] += inv.get("total_due", 0)
        totals["paid"] += inv.get("total_due", 0) - bal
        totals["outstanding"] += max(bal, 0)
        totals["holdback_held"] += inv.get("holdback", 0)
        if bal > 0:
            sub = L.parse_date(inv.get("submitted_at")) or today
            days = (today - sub).days
            key = "0-30" if days <= 30 else "31-60" if days <= 60 else "61-90" if days <= 90 else "90+"
            aging[key] += bal
    return {**{k: L.to_dollars(v) for k, v in totals.items()}, "aging": {k: L.to_dollars(v) for k, v in aging.items()}}


async def _get(inv_id: str) -> dict:
    inv = await db.invoices.find_one({"_id": oid(inv_id, "Invoice")})
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    return inv


@router.put("/{inv_id}")
async def update_draft(inv_id: str, body: DrawIn, current_user: dict = Depends(require_roles(*BILLERS))):
    inv = await _get(inv_id)
    if inv["status"] != "draft":
        raise HTTPException(status_code=400, detail="Only drafts can be changed")
    site = await get_site_or_404(inv["site_id"])
    computed = await _compute(site, body, exclude_id=inv["_id"])
    number = body.invoice_number or inv["invoice_number"]
    if number != inv["invoice_number"] and await db.invoices.find_one({"invoice_number": number}):
        raise HTTPException(status_code=400, detail="Invoice number %s is already used" % number)
    await db.invoices.update_one({"_id": inv["_id"]}, {"$set": {
        **computed, "period_end": body.period_end, "description": body.description, "mode": body.mode,
        "holdback_pct": body.holdback_pct, "tax_pct": body.tax_pct,
        "snapshot": await _snapshot(site, body.bill_to or (inv.get("snapshot") or {}).get("bill_to"), computed,
                                    exclude_id=inv["_id"]),
        "invoice_number": number, "updated_at": datetime.utcnow()},
        "$push": {"history": _event(current_user, "Draft edited: total %s" % L.money_text(computed["total_due"]))}})
    await _remember_bill_to(site, body.bill_to)
    return invoice_out(await db.invoices.find_one({"_id": inv["_id"]}))


@router.post("/{inv_id}/submit")
async def submit(inv_id: str, current_user: dict = Depends(require_roles(*BILLERS))):
    inv = await _get(inv_id)
    if inv["status"] != "draft":
        raise HTTPException(status_code=400, detail="Already submitted")
    site = await get_site_or_404(inv["site_id"])
    snap = await _snapshot(site, (inv.get("snapshot") or {}).get("bill_to"), inv, exclude_id=inv["_id"])
    if not snap["bill_to"]:
        raise HTTPException(status_code=400, detail="Add who the invoice is billed to (edit the draft) before sending it")
    today = datetime.utcnow().date()
    # The invoice is frozen from here: snapshot, dates and amounts no longer change.
    await db.invoices.update_one({"_id": inv["_id"]}, {"$set": {
        "status": "submitted", "submitted_at": today.isoformat(), "invoice_date": today.isoformat(),
        "due_date": (today + timedelta(days=invoice_doc.payment_terms_days())).isoformat(),
        "snapshot": snap, "submitted_by_name": current_user["name"]},
        "$push": {"history": _event(current_user, "Sent to %s" % snap["bill_to"].splitlines()[0])}})
    return invoice_out(await db.invoices.find_one({"_id": inv["_id"]}))


@router.post("/{inv_id}/payments")
async def add_payment(inv_id: str, body: PaymentIn, current_user: dict = Depends(require_roles(*BILLERS))):
    inv = await _get(inv_id)
    if inv["status"] == "draft":
        raise HTTPException(status_code=400, detail="Submit the draw before recording payments")
    cents = L.to_cents(body.amount)
    if cents > L.invoice_balance(inv):
        raise HTTPException(status_code=400, detail="That's more than the balance owing ($%.2f)"
                                                    % L.to_dollars(L.invoice_balance(inv)))
    payment = {"amount": cents, "paid_on": (L.parse_date(body.paid_on) or datetime.utcnow().date()).isoformat(),
               "reference": body.reference, "recorded_by_name": current_user["name"],
               "recorded_at": datetime.utcnow()}
    await db.invoices.update_one({"_id": inv["_id"]}, {"$push": {
        "payments": payment,
        "history": _event(current_user, "Payment of %s recorded%s" % (
            L.money_text(cents), " (%s)" % body.reference if body.reference else ""))}})
    updated = await db.invoices.find_one({"_id": inv["_id"]})
    await db.invoices.update_one({"_id": inv["_id"]}, {"$set": {"status": L.invoice_status(updated)}})
    return invoice_out(await db.invoices.find_one({"_id": inv["_id"]}))


DOC_TOKEN_MINUTES = 30


@router.post("/{inv_id}/link")
async def document_link(inv_id: str, current_user: dict = Depends(require_roles(*OFFICE_ROLES))):
    """A link to the printable invoice that works for 30 minutes without signing in, so it can be
    opened in a browser tab (or the phone's browser) and printed / saved as PDF."""
    inv = await _get(inv_id)
    token = jwt.encode({"inv": str(inv["_id"]), "purpose": "invoice_doc",
                        "exp": datetime.utcnow() + timedelta(minutes=DOC_TOKEN_MINUTES)}, SECRET_KEY, algorithm=ALGORITHM)
    return {"url": "/api/invoices/%s/document?token=%s" % (inv["_id"], token), "expires_minutes": DOC_TOKEN_MINUTES}


@router.get("/{inv_id}/document", response_class=HTMLResponse)
async def document(inv_id: str, token: str = Query(...)):
    try:
        claims = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=401, detail="This invoice link has expired. Open it again from the app.")
    if claims.get("purpose") != "invoice_doc" or claims.get("inv") != inv_id:
        raise HTTPException(status_code=401, detail="This invoice link isn't valid.")
    inv = await _get(inv_id)
    return HTMLResponse(invoice_doc.render(inv), headers={"Cache-Control": "no-store", "X-Robots-Tag": "noindex"})


@router.delete("/{inv_id}")
async def delete_draft(inv_id: str, current_user: dict = Depends(require_roles(*BILLERS))):
    inv = await _get(inv_id)
    if inv["status"] != "draft":
        raise HTTPException(status_code=400, detail="Only drafts can be deleted")
    await db.invoices.delete_one({"_id": inv["_id"]})
    return {"message": "Draft deleted"}


async def site_billing_cents(site_id: str) -> dict:
    """{'billed_gross', 'paid', 'holdback_held'} for submitted draws on one site, all before tax
    (payments are scaled down by each draw's tax so they compare with what was billed)."""
    billed = paid = holdback = 0
    async for inv in db.invoices.find({"site_id": site_id, "status": {"$ne": "draft"}}):
        billed += inv.get("gross", 0)
        holdback += inv.get("holdback", 0)
        received = inv.get("total_due", 0) - L.invoice_balance(inv)
        if inv.get("total_due"):
            paid += int(round(received * inv.get("net", 0) / inv["total_due"]))
    return {"billed_gross": billed, "paid": paid, "holdback_held": holdback}
