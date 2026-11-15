"""Progress draw invoices: bill by % complete or by amount, hold back retainage, add tax,
record payments, and see what's paid and outstanding (with aging)."""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

import logic as L
from core import OFFICE_ROLES, ROLE_ADMIN, ROLE_COORDINATOR, ROLE_PM, db, get_site_or_404, next_number, oid, \
    out, require_roles

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


@router.post("")
async def create_draw(body: DrawIn, current_user: dict = Depends(require_roles(*BILLERS))):
    site = await get_site_or_404(body.site_id)
    computed = await _compute(site, body)
    number = await next_number("invoices", body.site_id)
    doc = {"site_id": body.site_id, "site_name": site["name"], "number": number,
           "invoice_number": body.invoice_number or "%s-D%02d" % (site.get("project_number") or "INV", number),
           "period_end": body.period_end, "description": body.description, "mode": body.mode,
           "holdback_pct": body.holdback_pct, "tax_pct": body.tax_pct, **computed, "status": "draft",
           "payments": [], "created_by": str(current_user["_id"]), "created_by_name": current_user["name"],
           "created_at": datetime.utcnow()}
    res = await db.invoices.insert_one(doc)
    doc["_id"] = res.inserted_id
    return invoice_out(doc)


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
    await db.invoices.update_one({"_id": inv["_id"]}, {"$set": {
        **computed, "period_end": body.period_end, "description": body.description, "mode": body.mode,
        "holdback_pct": body.holdback_pct, "tax_pct": body.tax_pct,
        "invoice_number": body.invoice_number or inv["invoice_number"], "updated_at": datetime.utcnow()}})
    return invoice_out(await db.invoices.find_one({"_id": inv["_id"]}))


@router.post("/{inv_id}/submit")
async def submit(inv_id: str, current_user: dict = Depends(require_roles(*BILLERS))):
    inv = await _get(inv_id)
    if inv["status"] != "draft":
        raise HTTPException(status_code=400, detail="Already submitted")
    await db.invoices.update_one({"_id": inv["_id"]}, {"$set": {
        "status": "submitted", "submitted_at": datetime.utcnow().date().isoformat(),
        "submitted_by_name": current_user["name"]}})
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
    await db.invoices.update_one({"_id": inv["_id"]}, {"$push": {"payments": payment}})
    updated = await db.invoices.find_one({"_id": inv["_id"]})
    await db.invoices.update_one({"_id": inv["_id"]}, {"$set": {"status": L.invoice_status(updated)}})
    return invoice_out(await db.invoices.find_one({"_id": inv["_id"]}))


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
