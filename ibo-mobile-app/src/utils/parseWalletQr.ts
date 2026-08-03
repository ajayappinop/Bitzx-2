/**
 * Strict wallet-address validation for QR scan results.
 * Rejects URLs, payment links, UPI, and other non-address payloads.
 */

const ETH_RE = /^0x[a-fA-F0-9]{40}$/;
const HEX_ONLY_RE = /^[a-fA-F0-9]{40}$/;
const TRON_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
const BTC_BECH32_RE = /^(bc1|tb1)[0-9ac-hj-np-z]{6,}$/i;
const BTC_LEGACY_RE = /^[13mn2][1-9A-HJ-NP-Za-km-z]{25,39}$/;
const SOL_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const CRYPTO_URI_RE =
  /^(?:ethereum|bitcoin|bnb|bsc|binance|solana|tron|ripple|xrp|matic|polygon|avax|arbitrum|optimism):([^?@/]+)/i;

const LINK_HINT_RE =
  /^(?:https?:\/\/|www\.|ftp:\/\/|mailto:|tel:|sms:|geo:|upi:|intent:|wc:)/i;

const DOMAIN_HINT_RE = /\.(com|org|net|io|app|link|me|co|in|xyz|dev|info)\b/i;

const PAYMENT_HINT_RE = /\b(paytm|phonepe|gpay|googlepay|bharatpe|bhim|upi|tez)\b/i;

const LABELED_ADDR_RE = /^(?:address|wallet|destination|to)\s*[:=]\s*(.+)$/i;

export const INVALID_WALLET_QR_MESSAGE = 'Invalid QR. Try again.';

function normalizeCandidate(value: string): string {
  let s = value.replace(/^\uFEFF/, '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
  if (!s) return '';

  const firstLine = s.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  if (firstLine) s = firstLine;

  const labeled = s.match(LABELED_ADDR_RE);
  if (labeled?.[1]) s = labeled[1].trim();

  if (HEX_ONLY_RE.test(s)) return `0x${s}`;

  return s;
}

export function isWalletAddress(value: string): boolean {
  const addr = normalizeCandidate(value);
  if (!addr || addr.length < 26 || addr.length > 128) return false;
  return (
    ETH_RE.test(addr) ||
    TRON_RE.test(addr) ||
    BTC_BECH32_RE.test(addr) ||
    BTC_LEGACY_RE.test(addr) ||
    SOL_RE.test(addr)
  );
}

function isRejectedQrPayload(raw: string): boolean {
  const s = normalizeCandidate(raw);
  if (!s) return true;
  if (/\s/.test(s)) return true;
  if (LINK_HINT_RE.test(s)) return true;
  if (PAYMENT_HINT_RE.test(s)) return true;
  if ((s.includes('/') || s.includes('?') || s.includes('&') || s.includes('#')) && !CRYPTO_URI_RE.test(s)) {
    return true;
  }
  if (DOMAIN_HINT_RE.test(s) && !isWalletAddress(s)) return true;
  if (/@/.test(s) && !CRYPTO_URI_RE.test(s)) return true;
  return false;
}

function acceptCandidate(candidate: string): string | null {
  const normalized = normalizeCandidate(candidate);
  return isWalletAddress(normalized) ? normalized : null;
}

/**
 * Extract a wallet address from QR payload text, or null if invalid / not an address.
 */
export function parseWalletAddressFromQr(raw: string): string | null {
  const s = normalizeCandidate(raw);
  if (!s || isRejectedQrPayload(raw)) return null;

  const uriMatch = s.match(CRYPTO_URI_RE);
  if (uriMatch?.[1]) {
    return acceptCandidate(uriMatch[1]);
  }

  try {
    const parsed = JSON.parse(s) as Record<string, unknown>;
    if (typeof parsed.address === 'string') {
      return acceptCandidate(parsed.address);
    }
    return null;
  } catch {
    // not JSON
  }

  return acceptCandidate(s);
}
