// REST + WebSocket helpers for the futures module.
import { exchangeApiOrigin } from '@/lib/apiBase';
import { authFetch, getStoredExchangeToken } from '@/context/AuthContext';

const BACKEND = exchangeApiOrigin(import.meta.env.VITE_BACKEND_URL);
const WS_ORIGIN = (import.meta.env.VITE_WS_URL || String(BACKEND).replace(/^http/, 'ws')).replace(/\/$/, '');

const API = `${BACKEND}/api/futures`;

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

// ── Public market data ──────────────────────────────────────────────────────
export const futuresApi = {
  listSymbols: () => fetch(`${API}/symbols`).then(jsonOrThrow),
  markPrice:  (symbol) => fetch(`${API}/mark-price?symbol=${encodeURIComponent(symbol)}`).then(jsonOrThrow),
  orderbook:  (symbol, depth = 25) =>
    fetch(`${API}/orderbook?symbol=${encodeURIComponent(symbol)}&depth=${depth}`).then(jsonOrThrow),
  marketTrades: (symbol, limit = 50) =>
    fetch(`${API}/trades?symbol=${encodeURIComponent(symbol)}&limit=${limit}`).then(jsonOrThrow),
  fundingRate: (symbol) =>
    fetch(`${API}/funding-rate?symbol=${encodeURIComponent(symbol)}`).then(jsonOrThrow),

  // ── Authenticated ────────────────────────────────────────────────────────
  wallet:        ()        => authFetch(`${API}/wallet`).then(jsonOrThrow),
  walletTxns:    (q = {})  => authFetch(`${API}/wallet/txns?limit=${q.limit ?? 50}&skip=${q.skip ?? 0}`).then(jsonOrThrow),
  transfer:      (body)    => authFetch(`${API}/wallet/transfer`, { method: 'POST', body }).then(jsonOrThrow),
  syncLocked:    ()        => authFetch(`${API}/wallet/sync-locked`, { method: 'POST' }).then(jsonOrThrow),
  settings:      (symbol)  => authFetch(`${API}/settings?symbol=${encodeURIComponent(symbol)}`).then(jsonOrThrow),
  setLeverage:   (body)    => authFetch(`${API}/leverage`,    { method: 'POST', body }).then(jsonOrThrow),
  setMarginMode: (body)    => authFetch(`${API}/margin-mode`, { method: 'POST', body }).then(jsonOrThrow),

  placeOrder:   (body)     => authFetch(`${API}/orders`, { method: 'POST', body }).then(jsonOrThrow),
  cancelOrder:  (orderId)  => authFetch(`${API}/orders/${encodeURIComponent(orderId)}`, { method: 'DELETE' }).then(jsonOrThrow),
  openOrders:   (symbol)   => authFetch(`${API}/orders/open${symbol ? `?symbol=${encodeURIComponent(symbol)}` : ''}`).then(jsonOrThrow),
  orderHistory: (q = {})   => authFetch(`${API}/orders/history?limit=${q.limit ?? 50}${q.symbol ? `&symbol=${encodeURIComponent(q.symbol)}` : ''}`).then(jsonOrThrow),
  myTrades:     (q = {})   => authFetch(`${API}/trades/me?limit=${q.limit ?? 50}${q.symbol ? `&symbol=${encodeURIComponent(q.symbol)}` : ''}`).then(jsonOrThrow),

  positions:        ()      => authFetch(`${API}/positions`).then(jsonOrThrow),
  positionsHistory: (q={}) => authFetch(`${API}/positions/history?limit=${q.limit ?? 50}`).then(jsonOrThrow),
  closePosition:    (body) => authFetch(`${API}/positions/close`, { method: 'POST', body }).then(jsonOrThrow),
};

// ── WebSockets ──────────────────────────────────────────────────────────────
export function futuresWsUrl(path) {
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${WS_ORIGIN}${p}`;
}

export function openMarketsWs(onMessage) {
  const ws = new WebSocket(futuresWsUrl('/ws/futures/markets'));
  ws.addEventListener('message', (e) => {
    try { onMessage?.(JSON.parse(e.data)); } catch { /* ignore */ }
  });
  return ws;
}

export function openOrderbookWs(symbol, onMessage) {
  const ws = new WebSocket(futuresWsUrl(`/ws/futures/orderbook?symbol=${encodeURIComponent(symbol)}`));
  ws.addEventListener('message', (e) => {
    try { onMessage?.(JSON.parse(e.data)); } catch { /* ignore */ }
  });
  return ws;
}

export function openAccountWs(onMessage) {
  const t = getStoredExchangeToken();
  if (!t) return null;
  const ws = new WebSocket(futuresWsUrl(`/ws/futures/account?token=${encodeURIComponent(t)}`));
  ws.addEventListener('message', (e) => {
    try { onMessage?.(JSON.parse(e.data)); } catch { /* ignore */ }
  });
  return ws;
}
