"""Collection names and listing workflow statuses."""

COL_REQUESTS = "token_listing_requests"
COL_TOKENS = "listed_tokens"

STATUS_PENDING = "pending"
STATUS_APPROVED = "approved"
STATUS_REJECTED = "rejected"
STATUS_SUSPENDED = "suspended"
STATUS_DRAFT = "draft"

REQUEST_STATUSES = (STATUS_PENDING, STATUS_APPROVED, STATUS_REJECTED)
TOKEN_LIVE_STATUSES = (STATUS_APPROVED,)
TOKEN_ADMIN_STATUSES = (STATUS_DRAFT, STATUS_PENDING, STATUS_APPROVED, STATUS_REJECTED, STATUS_SUSPENDED)

# Canonical network labels (must match blockchain_service wallet labels).
KNOWN_NETWORKS = (
    "Bitcoin Network",
    "ERC-20 (Ethereum)",
    "BEP-20 (BNB Chain)",
    "TRC-20 (Tron)",
    "Solana",
)

CHAIN_ID_BY_NETWORK = {
    "Bitcoin Network": "btc",
    "ERC-20 (Ethereum)": "eth",
    "BEP-20 (BNB Chain)": "bsc",
    "TRC-20 (Tron)": "tron",
    "Solana": "solana",
}

MAX_LOGO_BYTES = 2 * 1024 * 1024
LOGO_MIME_EXT = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}

LISTING_SUBMIT_LIMIT_PER_IP_HOUR = 5
LISTING_SUBMIT_LIMIT_PER_EMAIL_DAY = 3
