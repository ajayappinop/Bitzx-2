/**
 * Ibo P2P API client.
 * Wraps all /api/p2p/* endpoints with Bearer auth via authFetch.
 */
import { exchangeApiOrigin } from '@/lib/apiBase';
import { authFetch, getStoredExchangeToken } from '@/context/AuthContext';

const BACKEND = exchangeApiOrigin(import.meta.env.VITE_BACKEND_URL);
const API = `${BACKEND}/api/p2p`;

/** Resolve a relative /uploads/... path to a full URL served by the backend. */
export function p2pMediaUrl(path) {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  return `${BACKEND}${path.startsWith('/') ? '' : '/'}${path}`;
}

async function jsonOrThrow(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data?.detail || data?.message || res.statusText || 'Request failed';
    const err = new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
    err.status = res.status;
    err.detail = detail;
    throw err;
  }
  return data;
}

function qs(params = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') p.append(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

// ── Payment Methods ──────────────────────────────────────────────────────────
export const p2pApi = {
  // Payment Methods
  listPaymentMethods: () =>
    authFetch(`${API}/payment-methods`).then(jsonOrThrow),
  createPaymentMethod: (body) =>
    authFetch(`${API}/payment-methods`, { method: 'POST', body }).then(jsonOrThrow),
  updatePaymentMethod: (pmId, body) =>
    authFetch(`${API}/payment-methods/${pmId}`, { method: 'PATCH', body }).then(jsonOrThrow),
  deletePaymentMethod: (pmId) =>
    authFetch(`${API}/payment-methods/${pmId}`, { method: 'DELETE' }).then(jsonOrThrow),

  // Ads
  listAds: (params = {}) =>
    fetch(`${API}/ads${qs(params)}`).then(jsonOrThrow),
  adDetail: (adId) =>
    fetch(`${API}/ads/${adId}`).then(jsonOrThrow),
  listMyAds: () =>
    authFetch(`${API}/ads/mine`).then(jsonOrThrow),
  createAd: (body) =>
    authFetch(`${API}/ads`, { method: 'POST', body }).then(jsonOrThrow),
  updateAd: (adId, body) =>
    authFetch(`${API}/ads/${adId}`, { method: 'PATCH', body }).then(jsonOrThrow),
  pauseAd: (adId) =>
    authFetch(`${API}/ads/${adId}/pause`, { method: 'POST', body: {} }).then(jsonOrThrow),
  resumeAd: (adId) =>
    authFetch(`${API}/ads/${adId}/resume`, { method: 'POST', body: {} }).then(jsonOrThrow),
  cancelAd: (adId) =>
    authFetch(`${API}/ads/${adId}/cancel`, { method: 'POST', body: {} }).then(jsonOrThrow),

  // Orders
  openOrder: (body) =>
    authFetch(`${API}/orders`, { method: 'POST', body }).then(jsonOrThrow),
  listOrders: (params = {}) =>
    authFetch(`${API}/orders${qs(params)}`).then(jsonOrThrow),
  orderDetail: (orderId) =>
    authFetch(`${API}/orders/${orderId}`).then(jsonOrThrow),
  markPaid: (orderId, body) =>
    authFetch(`${API}/orders/${orderId}/mark-paid`, { method: 'POST', body }).then(jsonOrThrow),
  releaseCrypto: (orderId, body) =>
    authFetch(`${API}/orders/${orderId}/release`, { method: 'POST', body }).then(jsonOrThrow),
  cancelOrder: (orderId, body) =>
    authFetch(`${API}/orders/${orderId}/cancel`, { method: 'POST', body }).then(jsonOrThrow),
  rateOrder: (orderId, body) =>
    authFetch(`${API}/orders/${orderId}/rate`, { method: 'POST', body }).then(jsonOrThrow),

  // Order chat
  listMessages: (orderId, params = {}) =>
    authFetch(`${API}/orders/${orderId}/messages${qs(params)}`).then(jsonOrThrow),
  postMessage: (orderId, body) =>
    authFetch(`${API}/orders/${orderId}/messages`, { method: 'POST', body }).then(jsonOrThrow),

  // Disputes
  openDispute: (orderId, body) =>
    authFetch(`${API}/orders/${orderId}/dispute`, { method: 'POST', body }).then(jsonOrThrow),
  addDisputeEvidence: (disputeId, body) =>
    authFetch(`${API}/disputes/${disputeId}/evidence`, { method: 'POST', body }).then(jsonOrThrow),
  listMyDisputes: () =>
    authFetch(`${API}/disputes/mine`).then(jsonOrThrow),
  disputeDetail: (disputeId) =>
    authFetch(`${API}/disputes/${disputeId}`).then(jsonOrThrow),
  orderAppealBundle: (orderId) =>
    authFetch(`${API}/orders/${orderId}/appeal`).then(jsonOrThrow),
  receiptOcr: (orderId) =>
    authFetch(`${API}/orders/${orderId}/receipt-ocr`, { method: 'POST', body: {} }).then(jsonOrThrow),

  // User profile
  myStats: () =>
    authFetch(`${API}/me/stats`).then(jsonOrThrow),
  counterpartyProfile: (userId) =>
    authFetch(`${API}/users/${userId}/profile`).then(jsonOrThrow),

  // Merchant
  applyMerchant: (body) =>
    authFetch(`${API}/merchants/apply`, { method: 'POST', body }).then(jsonOrThrow),
  myMerchantStatus: () =>
    authFetch(`${API}/merchants/me`).then(jsonOrThrow),
  merchantStatus: () =>
    authFetch(`${API}/merchants/me`).then(jsonOrThrow),

  // Aliases used by page components
  orderChat: (orderId, params = {}) =>
    authFetch(`${API}/orders/${orderId}/messages${qs(params)}`).then(jsonOrThrow),
  sendMessage: (orderId, body) =>
    authFetch(`${API}/orders/${orderId}/messages`, { method: 'POST', body }).then(jsonOrThrow),
  uploadChatImage: (orderId, formData) =>
    authFetch(`${API}/orders/${orderId}/upload-image`, { method: 'POST', body: formData }).then(jsonOrThrow),
};

// ── WebSocket helper ─────────────────────────────────────────────────────────

/** Returns a raw WebSocket connected to the P2P order channel. */
export function p2pWs(orderId, token) {
  const wsBase = (import.meta.env.VITE_WS_URL || String(BACKEND).replace(/^http/, 'ws')).replace(/\/$/, '');
  const url = `${wsBase}/api/ws/p2p/order/${orderId}${token ? `?token=${encodeURIComponent(token)}` : ''}`;
  return new WebSocket(url);
}

export function openP2POrderWs(orderId, onEvent) {
  const token = getStoredExchangeToken();
  const ws = p2pWs(orderId, token);

  let pingInterval = null;
  let dead = false;

  ws.onopen = () => {
    pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send('ping');
    }, 30000);
  };
  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type !== 'ping') onEvent(msg);
    } catch {}
  };
  ws.onclose = () => {
    clearInterval(pingInterval);
    dead = true;
  };
  ws.onerror = () => { ws.close(); };

  return {
    close: () => { dead = true; ws.close(); },
    isDead: () => dead,
  };
}
