const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:8000';

const handleResponse = async (response) => {
  if (!response.ok) {
    throw new Error(`API Error: ${response.status} ${response.statusText}`);
  }
  return response.json();
};

const fetchWithTimeout = (url, options = {}, timeout = 8000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  return fetch(url, { ...options, signal: controller.signal }).finally(() =>
    clearTimeout(timer)
  );
};

export const api = {
  /**
   * Basic health check — confirms the API is reachable.
   */
  async health() {
    const response = await fetchWithTimeout(`${BACKEND_URL}/api/`);
    return handleResponse(response);
  },

  /**
   * Detailed health check — includes DB status.
   */
  async healthDetailed() {
    const response = await fetchWithTimeout(`${BACKEND_URL}/api/health`);
    return handleResponse(response);
  },

  /**
   * Fetch static + live IBO token statistics.
   */
  async getTokenStats() {
    const response = await fetchWithTimeout(`${BACKEND_URL}/api/token-stats`);
    return handleResponse(response);
  },

  /**
   * Record a status check (used for analytics / health monitoring).
   * @param {string} clientName - Identifier for the calling client
   */
  async createStatus(clientName) {
    const response = await fetchWithTimeout(`${BACKEND_URL}/api/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_name: clientName }),
    });
    return handleResponse(response);
  },

  /**
   * Retrieve all recorded status checks.
   */
  async getStatusChecks() {
    const response = await fetchWithTimeout(`${BACKEND_URL}/api/status`);
    return handleResponse(response);
  },
};

// ── Trading API (all market data via backend — Binance proxied server-side) ───

export const tradingApi = {
  /** Full market snapshot: internal IBO + live Binance 24h for listed pairs */
  async getMarkets() {
    const res = await fetchWithTimeout(`${BACKEND_URL}/api/trading/markets`);
    return handleResponse(res);
  },

  async getTicker(symbol) {
    const sym = encodeURIComponent(symbol.toUpperCase());
    const res = await fetchWithTimeout(`${BACKEND_URL}/api/trading/ticker/${sym}`);
    return handleResponse(res);
  },

  async getKlines(symbol, interval = '1h', limit = 200) {
    const sym = encodeURIComponent(symbol.toUpperCase());
    const res = await fetchWithTimeout(
      `${BACKEND_URL}/api/trading/klines/${sym}?interval=${encodeURIComponent(interval)}&limit=${limit}`,
    );
    return handleResponse(res);
  },

  async getOrderBook(symbol, limit = 20) {
    const sym = encodeURIComponent(symbol.toUpperCase());
    const res = await fetchWithTimeout(
      `${BACKEND_URL}/api/trading/orderbook/${sym}?limit=${limit}`,
    );
    return handleResponse(res);
  },

  async getRecentTrades(symbol, limit = 50) {
    const sym = encodeURIComponent(symbol.toUpperCase());
    const res = await fetchWithTimeout(
      `${BACKEND_URL}/api/trading/trades/${sym}?limit=${limit}`,
    );
    return handleResponse(res);
  },
};

export default api;
