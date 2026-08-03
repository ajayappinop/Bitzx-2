// REST helpers for the options module (USDT-margined European-style v1).
// Authenticated calls use dynamic import() to avoid a static import cycle with AuthContext.
import { exchangeApiOrigin } from '@/lib/apiBase';
import { getStoredExchangeToken } from '@/context/AuthContext';

const BACKEND = exchangeApiOrigin(import.meta.env.VITE_BACKEND_URL);
const WS_ORIGIN = (import.meta.env.VITE_WS_URL || String(BACKEND).replace(/^http/, 'ws')).replace(/\/$/, '');
const API = `${BACKEND}/api/options`;

async function jsonOrThrow(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data?.detail || data?.message || res.statusText || 'request failed';
    const err = new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
    err.status = res.status;
    err.detail = detail;
    throw err;
  }
  return data;
}

function qs(params) {
  const u = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && String(v).trim() !== '') u.set(k, String(v));
  });
  const q = u.toString();
  return q ? `?${q}` : '';
}

async function authFetch(url, options = {}) {
  const { authFetch: af } = await import('@/context/AuthContext');
  return af(url, options);
}

export const optionsApi = {
  listUnderlyings: (params = {}) =>
    fetch(`${API}/underlyings${qs({ listed_only: params.listed_only ?? true })}`).then(jsonOrThrow),

  /** Resolved taker/maker fee fractions on premium notional (public). */
  feeRates: () => fetch(`${API}/fee-rates`).then(jsonOrThrow),

  listContracts: (params = {}) =>
    fetch(`${API}/contracts${qs(params)}`).then(jsonOrThrow),

  getContract: (contractId) =>
    fetch(`${API}/contracts/${encodeURIComponent(contractId)}`).then(jsonOrThrow),

  /** Public resting depth (aggregate limits) for a contract. */
  depth: (contractId, q = {}) =>
    fetch(
      `${API}/contracts/${encodeURIComponent(contractId)}/depth${qs({ levels: q.levels ?? 20 })}`,
    ).then(jsonOrThrow),

  /** Public recent fills (tape) for a contract. */
  contractTrades: (contractId, q = {}) =>
    fetch(
      `${API}/contracts/${encodeURIComponent(contractId)}/trades${qs({ limit: q.limit ?? 30 })}`,
    ).then(jsonOrThrow),

  getChain: (underlyingSymbol, listedOnly = true, includeMarket = true) =>
    fetch(
      `${API}/chain${qs({
        underlying_symbol: underlyingSymbol,
        listed_only: listedOnly,
        include_market: includeMarket,
      })}`,
    ).then(jsonOrThrow),

  /** Synthetic strikes from live Binance spot when DB has no contracts (preview / dev). */
  demoChain: (underlyingSymbol) =>
    fetch(`${API}/demo-chain${qs({ underlying_symbol: underlyingSymbol })}`).then(jsonOrThrow),

  wallet: () => authFetch(`${API}/wallet`).then(jsonOrThrow),
  walletTxns: (q = {}) => authFetch(`${API}/wallet/txns${qs({ limit: q.limit ?? 50, skip: q.skip ?? 0 })}`).then(jsonOrThrow),
  transfer: (body) => authFetch(`${API}/wallet/transfer`, { method: 'POST', body }).then(jsonOrThrow),

  placeOrder: (body) => authFetch(`${API}/orders`, { method: 'POST', body }).then(jsonOrThrow),
  cancelOrder: (orderId) =>
    authFetch(`${API}/orders/${encodeURIComponent(orderId)}`, { method: 'DELETE' }).then(jsonOrThrow),
  openOrders: (contractId) =>
    authFetch(`${API}/orders/open${contractId ? qs({ contract_id: contractId }) : ''}`).then(jsonOrThrow),
  orderHistory: (q = {}) =>
    authFetch(`${API}/orders/history${qs({ limit: q.limit ?? 50, ...(q.contract_id ? { contract_id: q.contract_id } : {}) })}`).then(
      jsonOrThrow,
    ),
  myTrades: (q = {}) =>
    authFetch(`${API}/trades/me${qs({ limit: q.limit ?? 50, ...(q.contract_id ? { contract_id: q.contract_id } : {}) })}`).then(
      jsonOrThrow,
    ),

  positions: () => authFetch(`${API}/positions`).then(jsonOrThrow),

  /** Cached Binance spot price used as the chain reference index. */
  indexPrice: (symbol) =>
    fetch(`${API}/index-price?symbol=${encodeURIComponent(symbol)}`).then(jsonOrThrow),
};

export function optionsWsUrl(path) {
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${WS_ORIGIN}${p}`;
}

/**
 * Create a WebSocket with automatic exponential-backoff reconnection.
 * Returns an object with `close()` to permanently stop reconnects.
 */
function makeReconnectingWs(urlFn, onMessage, { baseDelay = 1000, maxDelay = 30000 } = {}) {
  let ws = null;
  let stopped = false;
  let delay = baseDelay;
  let reconnectTimer = null;

  function connect() {
    if (stopped) return;
    try {
      ws = new WebSocket(urlFn());
    } catch {
      scheduleReconnect();
      return;
    }
    ws.addEventListener('open', () => { delay = baseDelay; });
    ws.addEventListener('message', (e) => {
      try { onMessage?.(JSON.parse(e.data)); } catch { /* ignore */ }
    });
    ws.addEventListener('close', () => { if (!stopped) scheduleReconnect(); });
    ws.addEventListener('error', () => { try { ws?.close(); } catch { /* ignore */ } });
  }

  function scheduleReconnect() {
    if (stopped) return;
    reconnectTimer = setTimeout(() => {
      delay = Math.min(delay * 1.5, maxDelay);
      connect();
    }, delay);
  }

  connect();
  return {
    close() {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      try { ws?.close(); } catch { /* ignore */ }
    },
  };
}

/**
 * ~2s real-time chain: bid/ask/OI/IV/delta/gamma/theta/vega for ALL contracts of an underlying.
 * Automatically reconnects on disconnect.
 * Returns { close() } to stop.
 */
export function openOptionsChainWs(underlyingSymbol, onMessage) {
  const q = new URLSearchParams({ underlying_symbol: String(underlyingSymbol) });
  return makeReconnectingWs(
    () => optionsWsUrl(`/ws/options/chain?${q}`),
    onMessage,
  );
}

/** ~1s snapshots: wallet, positions, open orders, history, trades (same shape as REST). Auto-reconnects. */
export function openOptionsAccountWs(onMessage) {
  const t = getStoredExchangeToken();
  if (!t) return null;
  return makeReconnectingWs(
    () => optionsWsUrl(`/ws/options/account?token=${encodeURIComponent(getStoredExchangeToken() || t)}`),
    onMessage,
  );
}

/** Public ~1s depth snapshots for a contract (no auth). Auto-reconnects. */
export function openOptionsDepthWs(contractId, levels = 20, onMessage) {
  const q = new URLSearchParams({
    contract_id: String(contractId),
    levels: String(levels ?? 20),
  });
  return makeReconnectingWs(
    () => optionsWsUrl(`/ws/options/depth?${q}`),
    onMessage,
  );
}
