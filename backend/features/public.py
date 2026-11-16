"""Public endpoints for the company website (no login).

POST /api/public/estimate-request turns the website's estimate form into a bid (source
"website") in the Bids tab and notifies estimators and coordinators. Basic abuse protection:
a hidden honeypot field, length limits, and at most 5 requests per IP address per hour."""
import time
from collections import defaultdict, deque
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

import logic as L
from core import ROLE_COORDINATOR, ROLE_ESTIMATOR, ROLE_ADMIN, _normalize_email, db, logger, notify, users_with_roles

router = APIRouter(prefix="/api/public", tags=["public"])

_recent = defaultdict(deque)   # ip -> timestamps of recent requests
LIMIT, WINDOW = 5, 3600


class EstimateRequest(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    email: str = Field(max_length=160)
    company: Optional[str] = Field(default=None, max_length=160)
    phone: Optional[str] = Field(default=None, max_length=40)
    project_name: str = Field(min_length=2, max_length=200)
    location: Optional[str] = Field(default=None, max_length=200)
    category: Optional[str] = Field(default=None, max_length=40)
    due_date: Optional[str] = Field(default=None, max_length=20)
    message: str = Field(min_length=5, max_length=4000)
    website: Optional[str] = None   # honeypot: real visitors leave it empty


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    return fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else "unknown")


def _rate_limited(ip: str) -> bool:
    now = time.time()
    q = _recent[ip]
    while q and now - q[0] > WINDOW:
        q.popleft()
    if len(q) >= LIMIT:
        return True
    q.append(now)
    return False


@router.post("/estimate-request")
async def estimate_request(body: EstimateRequest, request: Request):
    if body.website:   # a bot filled the hidden field: pretend it worked
        return {"ok": True}
    try:
        email = _normalize_email(body.email)
    except ValueError:
        raise HTTPException(status_code=400, detail="Please enter a valid email address.")
    if _rate_limited(_client_ip(request)):
        raise HTTPException(status_code=429, detail="Too many requests from this connection. Please call us instead.")
    category = body.category if body.category in L.BID_CATEGORIES else L.classify_bid(body.project_name, body.message)[0]
    due = L.parse_date(body.due_date)
    contact = " · ".join(x for x in [body.name, body.company, email, body.phone] if x)
    doc = {
        "project_name": body.project_name.strip(),
        "general_contractor": (body.company or "").strip() or None,
        "contact_name": body.name.strip(),
        "contact_email": email,
        "contact_phone": (body.phone or "").strip() or None,
        "category": category,
        "location": (body.location or "").strip() or None,
        "due_date": due.isoformat() if due else None,
        "notes": "Website estimate request from %s\n\n%s" % (contact, body.message.strip()),
        "status": "invited",
        "source": "website",
        "received_at": datetime.utcnow(),
        "created_at": datetime.utcnow(),
        "activity": [{"at": datetime.utcnow(), "text": "Estimate request from the website"}],
    }
    await db.bids.insert_one(doc)
    team = await users_with_roles((ROLE_ESTIMATOR, ROLE_COORDINATOR, ROLE_ADMIN))
    await notify([u["_id"] for u in team], "Website estimate request: " + doc["project_name"],
                 "%s (%s)" % (contact, L.BID_CATEGORIES[category]), kind="bid", link="/manager/bids")
    logger.info("Website estimate request: %s", doc["project_name"])
    return {"ok": True}
