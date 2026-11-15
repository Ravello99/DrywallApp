"""Reads the bid-invite mailbox over IMAP and turns bid invites into bids.

Works with Gmail / Google Workspace (IMAP on, with an App Password) and with any mailbox that
allows IMAP. Microsoft 365 usually blocks password IMAP; forward invites to a Gmail box, or paste
them in the app instead. Settings go in backend/.env:

    BID_INBOX_HOST=imap.gmail.com
    BID_INBOX_USER=bids@yourcompany.com
    BID_INBOX_PASSWORD=app-password-here
    BID_INBOX_FOLDER=INBOX            (optional)
    BID_INBOX_POLL_MINUTES=10         (optional)

Messages are read with BODY.PEEK, so they stay unread in the mailbox. Each message is only
imported once (tracked by Message-ID)."""
import asyncio
import email
import imaplib
import os
import re
from datetime import datetime, timedelta
from email.header import decode_header, make_header
from email.utils import parsedate_to_datetime
from html import unescape
from typing import List, Optional

import logic as L
from core import db, logger


def inbox_config() -> Optional[dict]:
    host, user, password = (os.environ.get("BID_INBOX_HOST"), os.environ.get("BID_INBOX_USER"),
                            os.environ.get("BID_INBOX_PASSWORD"))
    if not (host and user and password):
        return None
    return {"host": host, "user": user, "password": password,
            "port": int(os.environ.get("BID_INBOX_PORT", "993")),
            "folder": os.environ.get("BID_INBOX_FOLDER", "INBOX"),
            "poll_minutes": max(2, int(os.environ.get("BID_INBOX_POLL_MINUTES", "10")))}


def _decode(value: Optional[str]) -> str:
    if not value:
        return ""
    try:
        return str(make_header(decode_header(value)))
    except Exception:  # noqa: BLE001
        return value


def _text_of(msg: email.message.Message) -> str:
    """Plain text of an email (falls back to stripped HTML)."""
    plain, html = [], []
    for part in msg.walk() if msg.is_multipart() else [msg]:
        if part.get_content_maintype() == "multipart" or part.get("Content-Disposition", "").startswith("attachment"):
            continue
        try:
            payload = part.get_payload(decode=True) or b""
            text = payload.decode(part.get_content_charset() or "utf-8", errors="replace")
        except Exception:  # noqa: BLE001
            continue
        if part.get_content_type() == "text/plain":
            plain.append(text)
        elif part.get_content_type() == "text/html":
            html.append(text)
    if plain:
        return "\n".join(plain)
    joined = "\n".join(html)
    joined = re.sub(r"(?is)<(script|style).*?</\1>", " ", joined)
    joined = re.sub(r"(?i)<br\s*/?>|</p>|</div>|</tr>", "\n", joined)
    return unescape(re.sub(r"<[^>]+>", " ", joined))


def _fetch(cfg: dict, days: int) -> List[dict]:
    """Blocking IMAP fetch (run in a thread). Returns parsed messages from the last `days` days."""
    since = (datetime.utcnow() - timedelta(days=days)).strftime("%d-%b-%Y")
    conn = imaplib.IMAP4_SSL(cfg["host"], cfg["port"], timeout=30)
    try:
        conn.login(cfg["user"], cfg["password"])
        conn.select(cfg["folder"], readonly=True)
        typ, data = conn.search(None, "SINCE", since)
        if typ != "OK":
            return []
        ids = data[0].split()[-300:]    # newest 300 at most per check
        messages = []
        for mid in ids:
            typ, parts = conn.fetch(mid, "(BODY.PEEK[])")
            if typ != "OK" or not parts or not isinstance(parts[0], tuple):
                continue
            msg = email.message_from_bytes(parts[0][1])
            try:
                received = parsedate_to_datetime(msg.get("Date")).replace(tzinfo=None) if msg.get("Date") else None
            except Exception:  # noqa: BLE001
                received = None
            messages.append({"message_id": (msg.get("Message-ID") or "").strip() or None,
                             "subject": _decode(msg.get("Subject")), "sender": _decode(msg.get("From")),
                             "received_at": received, "body": _text_of(msg)})
        return messages
    finally:
        try:
            conn.logout()
        except Exception:  # noqa: BLE001
            pass


async def check_inbox(days: int = 3) -> dict:
    """Import new bid invites. Safe to call any time (duplicates are skipped)."""
    from features.bids import create_bid_from_email
    cfg = inbox_config()
    if not cfg:
        return {"configured": False, "imported": 0,
                "message": "Bid inbox isn't set up. Add BID_INBOX_HOST/USER/PASSWORD to backend/.env."}
    try:
        messages = await asyncio.get_event_loop().run_in_executor(None, _fetch, cfg, days)
    except Exception as e:  # noqa: BLE001
        msg = str(e)
        if "AUTHENTICATIONFAILED" in msg.upper() or "invalid credentials" in msg.lower():
            msg = ("The mailbox rejected the login. For Gmail, turn on IMAP and use an App Password "
                   "(not your normal password).")
        await db.app_state.update_one({"_id": "bid_inbox"}, {"$set": {"last_check": datetime.utcnow(),
                                                                      "last_error": msg}}, upsert=True)
        logger.warning("Bid inbox check failed: %s", e)
        return {"configured": True, "imported": 0, "error": msg}
    imported, skipped = 0, 0
    for m in messages:
        seen_key = m["message_id"] or "%s|%s" % (m["subject"], m["received_at"])
        if await db.bid_emails.find_one({"_id": seen_key}):
            continue
        is_invite = L.looks_like_bid_invite(m["subject"], m["body"])
        await db.bid_emails.insert_one({"_id": seen_key, "subject": m["subject"], "sender": m["sender"],
                                        "is_invite": is_invite, "seen_at": datetime.utcnow()})
        if not is_invite:
            skipped += 1
            continue
        if await create_bid_from_email(m["subject"], m["body"], m["sender"], m["received_at"], m["message_id"],
                                       "email"):
            imported += 1
    total = (await db.app_state.find_one({"_id": "bid_inbox"}) or {}).get("last_imported_total", 0) + imported
    await db.app_state.update_one({"_id": "bid_inbox"}, {"$set": {
        "last_check": datetime.utcnow(), "last_error": None, "last_imported": imported,
        "last_imported_total": total}}, upsert=True)
    if imported:
        logger.info("Bid inbox: imported %d bid invite(s)", imported)
    return {"configured": True, "imported": imported, "not_bids": skipped, "checked": len(messages)}
