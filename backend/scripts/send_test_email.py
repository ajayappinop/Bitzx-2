"""Send a one-off test email (logo header verification)."""
from __future__ import annotations

import asyncio
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env")

from services import email_service, email_templates


async def main() -> int:
    to = (sys.argv[1] if len(sys.argv) > 1 else "").strip()
    if not to or "@" not in to:
        print("Usage: python scripts/send_test_email.py recipient@example.com")
        return 1

    logo = email_templates.email_logo_src()
    print(f"Logo src: {logo}")

    subject, html, text = email_templates.welcome_email("Harshit")
    stamp = datetime.now(timezone.utc).strftime("%H:%M UTC")
    subject = f"[TEST {stamp}] {subject}"

    ok = await email_service.send_email(
        to,
        subject,
        html,
        text,
        log_tag="test_email",
    )
    print("Sent" if ok else "Failed — check SMTP settings and logs")
    return 0 if ok else 2


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
