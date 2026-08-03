"""INR fiat deposit flow — collection names and upload limits."""

from __future__ import annotations

COL_PAYMENT_METHODS = "inr_payment_methods"
COL_DEPOSITS = "inr_deposits"
COL_WITHDRAWALS = "inr_withdrawals"
COL_PAYOUT_PROFILES = "inr_payout_profiles"

MIN_WITHDRAWAL_INR = 100.0
DEFAULT_MIN_DEPOSIT_INR = 0.0  # 0 = no minimum until admin sets inr_min_deposit_inr

METHOD_BANK = "bank"
METHOD_UPI = "upi"
METHOD_QR = "qr"
METHOD_TYPES = (METHOD_BANK, METHOD_UPI, METHOD_QR)

STATUS_PENDING = "pending"
STATUS_APPROVING = "approving"
STATUS_APPROVED = "approved"
STATUS_REJECTED = "rejected"
TERMINAL_STATUSES = (STATUS_APPROVED, STATUS_REJECTED)

MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024  # 5 MB
MAX_QR_BYTES = 2 * 1024 * 1024
SCREENSHOT_MIME_EXT = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}

DEFAULT_INR_PER_USDT = 84.0
DEFAULT_IBO_USDT = 0.4523

# Deposit flow: manual (UTR + admin) | gateway (hosted checkout) | hybrid (both)
DEPOSIT_MODE_MANUAL = "manual"
DEPOSIT_MODE_GATEWAY = "gateway"
DEPOSIT_MODE_HYBRID = "hybrid"
DEPOSIT_MODES = (DEPOSIT_MODE_MANUAL, DEPOSIT_MODE_GATEWAY, DEPOSIT_MODE_HYBRID)
DEFAULT_DEPOSIT_MODE = DEPOSIT_MODE_MANUAL

GATEWAY_NONE = "none"
KNOWN_GATEWAY_PROVIDERS = (
    GATEWAY_NONE,
    "razorpay",
    "cashfree",
    "payu",
    "phonepe",
)

# Gateway order lifecycle (on deposit row)
GW_STATUS_CREATED = "created"
GW_STATUS_PAID = "paid"
GW_STATUS_FAILED = "failed"

COL_GATEWAY_EVENTS = "inr_gateway_events"
