"""Sending email (password resets). Configure in backend/.env, e.g. a HostPapa mailbox:

    SMTP_HOST=mail.vanguarddrywall.ca
    SMTP_PORT=465                 # 465 = SSL, 587 = STARTTLS
    SMTP_USER=noreply@vanguarddrywall.ca
    SMTP_PASSWORD=...
    SMTP_FROM=VanGuard Drywall <noreply@vanguarddrywall.ca>

Without these, nothing is emailed and password resets go through a manager instead."""
import asyncio
import os
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr, parseaddr

from core import logger


def configured() -> bool:
    return bool(os.environ.get("SMTP_HOST") and os.environ.get("SMTP_USER") and os.environ.get("SMTP_PASSWORD"))


def _send(to: str, subject: str, text: str, html: str = None) -> None:
    host = os.environ["SMTP_HOST"]
    port = int(os.environ.get("SMTP_PORT", "465"))
    user, password = os.environ["SMTP_USER"], os.environ["SMTP_PASSWORD"]
    name, addr = parseaddr(os.environ.get("SMTP_FROM") or user)
    msg = EmailMessage()
    msg["From"] = formataddr((name or os.environ.get("COMPANY_NAME", "VanGuard Drywall & Acoustics"), addr or user))
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(text)
    if html:
        msg.add_alternative(html, subtype="html")
    context = ssl.create_default_context()
    if port == 465:
        with smtplib.SMTP_SSL(host, port, context=context, timeout=20) as s:
            s.login(user, password)
            s.send_message(msg)
    else:
        with smtplib.SMTP(host, port, timeout=20) as s:
            s.starttls(context=context)
            s.login(user, password)
            s.send_message(msg)


async def send(to: str, subject: str, text: str, html: str = None) -> bool:
    """True if the email was handed to the mail server."""
    if not configured():
        return False
    try:
        await asyncio.to_thread(_send, to, subject, text, html)
        return True
    except Exception:  # noqa: BLE001
        logger.exception("Couldn't send email to %s", to)
        return False
