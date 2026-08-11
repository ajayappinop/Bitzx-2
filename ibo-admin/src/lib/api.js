const BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000';

const store = {
  getToken: () => localStorage.getItem('ibo_admin_token'),
  setToken: (t) => localStorage.setItem('ibo_admin_token', t),
  clear: () => localStorage.removeItem('ibo_admin_token'),
};

export function getStoredToken() {
  return store.getToken();
}

export function clearAdminToken() {
  store.clear();
}

/** Build ws:// or wss:// URL from VITE_BACKEND_URL (http/https). */
export function adminWsPath(pathWithQuery) {
  const base = (BACKEND || 'http://localhost:8000').replace(/^http/, 'ws');
  return `${base}${pathWithQuery.startsWith('/') ? '' : '/'}${pathWithQuery}`;
}

/** Append `token` query param for admin WebSocket auth (JWT or empty if logged out). */
export function adminWebSocketUrl(pathWithQuery) {
  const token = getStoredToken() || '';
  const sep = pathWithQuery.includes('?') ? '&' : '?';
  return adminWsPath(`${pathWithQuery}${sep}token=${encodeURIComponent(token)}`);
}

export async function adminFetch(path, options = {}) {
  const token = store.getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BACKEND}${path}`, { ...options, headers });
  return res;
}

export async function publicGet(path) {
  return fetch(`${BACKEND}${path}`);
}

export async function adminLogin(email, password) {
  const res = await fetch(`${BACKEND}/api/admin/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || res.statusText || 'Login failed');
  store.setToken(data.access_token);
  return data;
}

export async function adminUpload(path, formData, { method = 'POST' } = {}) {
  const token = store.getToken();
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(`${BACKEND}${path}`, { method, headers, body: formData });
}

export const api = {
  me: () => adminFetch('/api/admin/auth/me'),
  adminUsers: (params) => {
    const u = new URLSearchParams(params);
    return adminFetch(`/api/admin/admin-users?${u}`);
  },
  createAdminUser: (body) =>
    adminFetch('/api/admin/admin-users', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  patchAdminUser: (aid, body) =>
    adminFetch(`/api/admin/admin-users/${encodeURIComponent(aid)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  supportTickets: (params = {}) => {
    const u = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v).trim() !== '') u.set(k, String(v).trim());
    });
    const qs = u.toString();
    return adminFetch(`/api/admin/support/tickets${qs ? `?${qs}` : ''}`);
  },
  supportTicket: (id) =>
    adminFetch(`/api/admin/support/tickets/${encodeURIComponent(id)}`),
  patchSupportTicket: (id, body = {}) =>
    adminFetch(`/api/admin/support/tickets/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(body || {}),
    }),
  supportTicketMessage: (id, body = {}) =>
    adminFetch(`/api/admin/support/tickets/${encodeURIComponent(id)}/messages`, {
      method: 'POST',
      body: JSON.stringify(body || {}),
    }),
  rpcUsage: (hours = 2) => adminFetch(`/api/admin/rpc-usage?hours=${encodeURIComponent(String(hours))}`),
  platformControls: () => adminFetch('/api/admin/platform-controls'),
  patchPlatformControls: (body) =>
    adminFetch('/api/admin/platform-controls', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  mobileAppReleases: () => adminFetch('/api/admin/mobile-app/releases'),
  patchMobileRelease: (id, body) =>
    adminFetch(`/api/admin/mobile-app/releases/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deleteMobileRelease: (id) =>
    adminFetch(`/api/admin/mobile-app/releases/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  patchMobileDistribution: (body) =>
    adminFetch('/api/admin/mobile-app/distribution', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  landingPromo: () => adminFetch('/api/admin/landing-promo'),
  patchLandingPromo: (body) =>
    adminFetch('/api/admin/landing-promo', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  appHomeBanners: () => adminFetch('/api/admin/app-home-banners'),
  patchAppHomeBannerSettings: (body) =>
    adminFetch('/api/admin/app-home-banners/settings', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  createAppHomeBanner: (body) =>
    adminFetch('/api/admin/app-home-banners', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  patchAppHomeBanner: (id, body) =>
    adminFetch(`/api/admin/app-home-banners/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deleteAppHomeBanner: (id) =>
    adminFetch(`/api/admin/app-home-banners/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  stats: () => adminFetch('/api/admin/stats/overview'),
  statsFlows: (params) => {
    const u = new URLSearchParams(params);
    return adminFetch(`/api/admin/stats/flows?${u}`);
  },
  statsFees: () => adminFetch('/api/admin/stats/fees'),
  financeOverview: (params = {}) => {
    const u = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v).trim() !== '') u.set(k, String(v).trim());
    });
    return adminFetch(`/api/admin/finance/overview?${u.toString()}`);
  },
  financeOverviewExport: (params = {}) => {
    const u = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v).trim() !== '') u.set(k, String(v).trim());
    });
    return adminFetch(`/api/admin/finance/overview/export?${u.toString()}`);
  },
  financeRevenueReport: (params = {}) => {
    const u = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v).trim() !== '') u.set(k, String(v).trim());
    });
    return adminFetch(`/api/admin/finance/revenue-report?${u.toString()}`);
  },
  financeRevenueReportExport: (params = {}) => {
    const u = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v).trim() !== '') u.set(k, String(v).trim());
    });
    return adminFetch(`/api/admin/finance/revenue-report/export?${u.toString()}`);
  },
  createFinanceExportJob: (body = {}) =>
    adminFetch('/api/admin/finance/overview/export-jobs', {
      method: 'POST',
      body: JSON.stringify(body || {}),
    }),
  financeExportJob: (jobId) =>
    adminFetch(`/api/admin/finance/overview/export-jobs/${encodeURIComponent(jobId)}`),
  financeExportJobDownload: (jobId) =>
    adminFetch(`/api/admin/finance/overview/export-jobs/${encodeURIComponent(jobId)}/download`),
  searchUsers: (q) => adminFetch(`/api/admin/search/users?q=${encodeURIComponent(q)}`),
  kycPending: (params) => {
    const u = new URLSearchParams(params);
    return adminFetch(`/api/admin/kyc/pending?${u}`);
  },
  users: (params) => {
    const u = new URLSearchParams(params);
    return adminFetch(`/api/admin/users?${u}`);
  },
  user: (uid) => adminFetch(`/api/admin/users/${encodeURIComponent(uid)}`),
  userReferrals: (uid) => adminFetch(`/api/admin/users/${encodeURIComponent(uid)}/referrals`),
  referralTreeSearch: (q) => adminFetch(`/api/admin/referrals/tree?q=${encodeURIComponent(q)}`),
  userTradingAnalytics: (uid) =>
    adminFetch(`/api/admin/users/${encodeURIComponent(uid)}/trading-analytics`),
  userOrders: (uid, params) => {
    const u = new URLSearchParams(params);
    return adminFetch(`/api/admin/users/${encodeURIComponent(uid)}/orders?${u}`);
  },
  orders: (params = {}) => {
    const u = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v).trim() !== '') u.set(k, String(v).trim());
    });
    return adminFetch(`/api/admin/orders?${u.toString()}`);
  },
  cancelOrderAdmin: (orderId) =>
    adminFetch(`/api/admin/orders/${encodeURIComponent(orderId)}/cancel`, { method: 'POST' }),
  bulkCancelOrdersAdmin: (params = {}) => {
    const u = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v).trim() !== '') u.set(k, String(v).trim());
    });
    return adminFetch(`/api/admin/orders/bulk-cancel?${u.toString()}`, { method: 'POST' });
  },
  userTrades: (uid, params) => {
    const u = new URLSearchParams(params);
    return adminFetch(`/api/admin/users/${encodeURIComponent(uid)}/trades?${u}`);
  },
  userLivePositions: (uid) =>
    adminFetch(`/api/admin/users/${encodeURIComponent(uid)}/positions/live`),
  livePositions: (params) => {
    const u = new URLSearchParams(params);
    return adminFetch(`/api/admin/positions/live?${u}`);
  },
  adminPlaceUserOrder: (uid, body) =>
    adminFetch(`/api/admin/users/${encodeURIComponent(uid)}/orders`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  adminCloseUserPosition: (uid, body) =>
    adminFetch(`/api/admin/users/${encodeURIComponent(uid)}/close-position`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  recentTrades: (params) => {
    const u = new URLSearchParams(params);
    return adminFetch(`/api/admin/trades/recent?${u}`);
  },
  tradesSurveillance: (params = {}) => {
    const u = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v).trim() !== '') u.set(k, String(v).trim());
    });
    return adminFetch(`/api/admin/trades/surveillance?${u}`);
  },
  patchUser: (uid, body) =>
    adminFetch(`/api/admin/users/${encodeURIComponent(uid)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  adjustUserWallet: (uid, body) =>
    adminFetch(`/api/admin/users/${encodeURIComponent(uid)}/wallet-adjustments`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  walletAdjustments: (params) => {
    const u = new URLSearchParams(params);
    return adminFetch(`/api/admin/wallet-adjustments?${u}`);
  },
  // Phase 4 — manual deposit/withdrawal admin endpoints were removed
  // from the backend. The blockchain pipeline is now the only source of
  // deposit truth, surfaced as "deposit events" via the new endpoint below.
  depositEvents: (params = {}) => {
    const u = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v).trim() !== '') u.set(k, String(v).trim());
    });
    const qs = u.toString();
    return adminFetch(`/api/admin/deposit-events${qs ? `?${qs}` : ''}`);
  },
  creditDepositEvent: (eventId, body = {}) =>
    adminFetch(`/api/admin/deposit-events/${encodeURIComponent(eventId)}/credit`, {
      method: 'POST',
      body: JSON.stringify(body || {}),
    }),
  depositAddresses: (params = {}) => {
    const u = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v).trim() !== '') u.set(k, String(v).trim());
    });
    const qs = u.toString();
    return adminFetch(`/api/admin/deposit-addresses${qs ? `?${qs}` : ''}`);
  },
  userDepositAddresses: (uid, params = {}) => {
    const u = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v).trim() !== '') u.set(k, String(v).trim());
    });
    const qs = u.toString();
    return adminFetch(
      `/api/admin/deposit-addresses/by-user/${encodeURIComponent(uid)}${qs ? `?${qs}` : ''}`,
    );
  },
  approveKyc: (uid) =>
    adminFetch(`/api/admin/kyc/${encodeURIComponent(uid)}/approve`, { method: 'POST' }),
  rejectKyc: (uid, reason) =>
    adminFetch(`/api/admin/kyc/${encodeURIComponent(uid)}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason: reason || 'Rejected' }),
    }),
  patchKycRisk: (uid, body = {}) =>
    adminFetch(`/api/admin/kyc/${encodeURIComponent(uid)}/risk`, {
      method: 'PATCH',
      body: JSON.stringify(body || {}),
    }),
  rerequestKyc: (uid, body = {}) =>
    adminFetch(`/api/admin/kyc/${encodeURIComponent(uid)}/re-request`, {
      method: 'POST',
      body: JSON.stringify(body || {}),
    }),
  impersonate: (uid) =>
    adminFetch(`/api/admin/impersonate/${encodeURIComponent(uid)}`, { method: 'POST' }),
  auditLogs: (params) => {
    const u = new URLSearchParams(params);
    return adminFetch(`/api/admin/audit-logs?${u}`);
  },
  tradingMarkets: () => publicGet('/api/trading/markets'),
  adminMarketPairs: () => adminFetch('/api/admin/markets/pairs'),
  createMarketPair: (body) =>
    adminFetch('/api/admin/markets/pairs', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  patchMarketPair: (symbol, body) =>
    adminFetch(`/api/admin/markets/pairs/${encodeURIComponent(symbol)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  tradingKlines: (symbol, params) => {
    const u = new URLSearchParams(params);
    return publicGet(`/api/trading/klines/${encodeURIComponent(symbol)}?${u}`);
  },
  tradingOrderbook: (symbol, params = {}) => {
    const u = new URLSearchParams(params);
    return publicGet(`/api/trading/orderbook/${encodeURIComponent(symbol)}?${u}`);
  },
  analytics: (params) => {
    const u = new URLSearchParams(params);
    return adminFetch(`/api/admin/stats/analytics?${u}`);
  },
  statsLeaderboard: (params) => {
    const u = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') u.set(k, String(v));
    });
    return adminFetch(`/api/admin/stats/leaderboard?${u}`);
  },
  walletTxns: (params = {}) => {
    const u = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v).trim() !== '') {
        u.set(k, String(v).trim());
      }
    });
    const qs = u.toString();
    return adminFetch(`/api/admin/wallet-txns${qs ? `?${qs}` : ''}`);
  },
  walletTxnsExport: (params = {}) => {
    const u = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v).trim() !== '') {
        u.set(k, String(v).trim());
      }
    });
    const qs = u.toString();
    return adminFetch(`/api/admin/wallet-txns/export${qs ? `?${qs}` : ''}`);
  },
  userWalletTxns: (uid, params = {}) => {
    const u = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v).trim() !== '') u.set(k, String(v).trim());
    });
    const qs = u.toString();
    return adminFetch(
      `/api/admin/users/${encodeURIComponent(uid)}/wallet-txns${qs ? `?${qs}` : ''}`,
    );
  },
  userSessions: (uid) =>
    adminFetch(`/api/admin/users/${encodeURIComponent(uid)}/sessions`),
  userForceLogout: (uid) =>
    adminFetch(`/api/admin/users/${encodeURIComponent(uid)}/force-logout`, { method: 'POST' }),
  userReset2fa: (uid) =>
    adminFetch(`/api/admin/users/${encodeURIComponent(uid)}/2fa/reset`, { method: 'POST' }),
  userPasswordResetRequest: (uid, body = {}) =>
    adminFetch(`/api/admin/users/${encodeURIComponent(uid)}/password-reset-request`, {
      method: 'POST',
      body: JSON.stringify(body || {}),
    }),
  // Phase 6 — on-chain withdrawals. ``withdrawals`` lists everything;
  // ``approveWithdrawal`` / ``rejectWithdrawal`` drive the manual review
  // queue for amounts over the auto-approve threshold.
  withdrawals: (params = {}) => {
    const u = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v).trim() !== '') u.set(k, String(v).trim());
    });
    const qs = u.toString();
    return adminFetch(`/api/admin/withdrawals${qs ? `?${qs}` : ''}`);
  },
  approveWithdrawal: (id, body = {}) =>
    adminFetch(`/api/admin/withdrawals/${encodeURIComponent(id)}/approve`, {
      method: 'POST',
      body: JSON.stringify(body || {}),
    }),
  rejectWithdrawal: (id, reason) =>
    adminFetch(`/api/admin/withdrawals/${encodeURIComponent(id)}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason: reason || 'Rejected' }),
    }),
  holdWithdrawal: (id, body = {}) =>
    adminFetch(`/api/admin/withdrawals/${encodeURIComponent(id)}/hold`, {
      method: 'POST',
      body: JSON.stringify(body || {}),
    }),
  // Phase 8 — read-only treasury / risk overview. Backed by GET
  // /api/admin/treasury; mutations still go through patchPlatformControls.
  treasury: () => adminFetch('/api/admin/treasury'),

  treasuryDepositSummary: (params = {}) => {
    const u = new URLSearchParams();
    if (params.uid) u.set('uid', params.uid);
    if (params.asset) u.set('asset', params.asset);
    const qs = u.toString();
    return adminFetch(`/api/admin/treasury/deposit-summary${qs ? `?${qs}` : ''}`);
  },

  treasurySyncCustody: () =>
    adminFetch('/api/admin/treasury/sync-custody', { method: 'POST' }),
  /** Phase 1 — omnibus hot/cold watch addresses (BTC + ETH/USDT ERC-20). */
  treasuryOmnibusWallets: (params = {}) => {
    const u = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v).trim() !== '') u.set(k, String(v).trim());
    });
    const qs = u.toString();
    return adminFetch(`/api/admin/treasury/omnibus-wallets${qs ? `?${qs}` : ''}`);
  },
  createTreasuryOmnibusWallet: (body) =>
    adminFetch('/api/admin/treasury/omnibus-wallets', { method: 'POST', body: JSON.stringify(body || {}) }),
  patchTreasuryOmnibusWallet: (walletId, body) =>
    adminFetch(`/api/admin/treasury/omnibus-wallets/${encodeURIComponent(walletId)}`, {
      method: 'PATCH',
      body: JSON.stringify(body || {}),
    }),
  treasuryOmnibusWalletAudit: (walletId, params = {}) => {
    const u = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v).trim() !== '') u.set(k, String(v).trim());
    });
    const qs = u.toString();
    return adminFetch(
      `/api/admin/treasury/omnibus-wallets/${encodeURIComponent(walletId)}/audit${qs ? `?${qs}` : ''}`,
    );
  },
  /** Phase 3 — deposit address → hot sweep plan (POST, query params). view_treasury. */
  treasuryDepositSweepsPreview: (params = {}) => {
    const u = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v).trim() !== '') u.set(k, String(v).trim());
    });
    const qs = u.toString();
    return adminFetch(
      `/api/admin/treasury/deposit-sweeps/preview${qs ? `?${qs}` : ''}`,
      { method: 'POST' },
    );
  },
  /** Phase 3 — record a sweep run (dry-run default). manage_treasury. */
  treasuryDepositSweepsRun: (body) =>
    adminFetch('/api/admin/treasury/deposit-sweeps/run', {
      method: 'POST',
      body: JSON.stringify(body || {}),
    }),
  /** Returns env-flag + admin-panel-flag + effective live-sweep status. */
  depositSweepLiveStatus: () =>
    adminFetch('/api/admin/treasury/deposit-sweeps/live-status'),
  /** Toggle admin-panel live sweep flag via platform-controls PATCH. */
  setDepositSweepLiveEnabled: (enabled) =>
    adminFetch('/api/admin/platform-controls', {
      method: 'PATCH',
      body: JSON.stringify({ deposit_sweep_live_enabled: Boolean(enabled) }),
    }),
  /** Sweep run history (no items detail, just summary per run). */
  depositSweepHistory: (params = {}) => {
    const u = new URLSearchParams();
    if (params.limit) u.set('limit', String(params.limit));
    if (params.offset) u.set('offset', String(params.offset));
    return adminFetch(`/api/admin/treasury/deposit-sweeps/history?${u.toString()}`);
  },
  /** Full detail for one sweep run (includes items array). */
  depositSweepRunDetail: (runId) =>
    adminFetch(`/api/admin/treasury/deposit-sweeps/runs/${runId}`),
  /** BSC treasury hot/cold admin wallet — KPIs, balances, chart. */
  adminWallet: () => adminFetch('/api/admin/treasury/admin-wallet'),
  adminWalletTransactions: (params = {}) => {
    const u = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v).trim() !== '') u.set(k, String(v).trim());
    });
    const qs = u.toString();
    return adminFetch(`/api/admin/treasury/admin-wallet/transactions${qs ? `?${qs}` : ''}`);
  },
  adminWalletPatchAddresses: (body) =>
    adminFetch('/api/admin/treasury/admin-wallet/addresses', {
      method: 'PATCH',
      body: JSON.stringify(body || {}),
    }),

  // ── Treasury Transfers ──────────────────────────────────────────────────────
  treasuryTransferKnownAddresses: () =>
    adminFetch('/api/admin/treasury/transfers/known-addresses'),
  treasuryTransferStats: () =>
    adminFetch('/api/admin/treasury/transfers/stats'),
  treasuryTransfers: (params = {}) => {
    const u = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v).trim() !== '') u.set(k, String(v).trim());
    });
    const qs = u.toString();
    return adminFetch(`/api/admin/treasury/transfers${qs ? `?${qs}` : ''}`);
  },
  createTreasuryTransfer: (body) =>
    adminFetch('/api/admin/treasury/transfers', {
      method: 'POST',
      body: JSON.stringify(body || {}),
    }),
  patchTreasuryTransfer: (id, body) =>
    adminFetch(`/api/admin/treasury/transfers/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(body || {}),
    }),
  // Phase 8d — Binance hedger admin API. ``hedger()`` returns the live
  // dashboard payload (per-symbol config + suggestion + recent trades).
  // Per-symbol config / manual execution are dedicated endpoints so we
  // can audit them independently of the generic platform_controls PATCH.
  hedger: () => adminFetch('/api/admin/hedger'),
  hedgerTrades: (params = {}) => {
    const u = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v).trim() !== '') u.set(k, String(v).trim());
    });
    const qs = u.toString();
    return adminFetch(`/api/admin/hedger/trades${qs ? `?${qs}` : ''}`);
  },
  patchHedgerSymbol: (symbol, body) =>
    adminFetch(`/api/admin/hedger/symbol/${encodeURIComponent(symbol)}`, {
      method: 'PATCH',
      body: JSON.stringify(body || {}),
    }),
  executeHedge: (symbol, body) =>
    adminFetch(`/api/admin/hedger/symbol/${encodeURIComponent(symbol)}/execute`, {
      method: 'POST',
      body: JSON.stringify(body || {}),
    }),
  // Phase 9a — reconciliation. ``reconcile()`` is a live read (Binance
  // balances + internal state). Snapshot/accept are superadmin-only.
  hedgerReconcile: () => adminFetch('/api/admin/hedger/reconcile'),
  hedgerReconcileSnapshot: (body = {}) =>
    adminFetch('/api/admin/hedger/reconcile/snapshot', {
      method: 'POST',
      body: JSON.stringify(body || {}),
    }),
  hedgerReconcileAccept: (body) =>
    adminFetch('/api/admin/hedger/reconcile/accept', {
      method: 'POST',
      body: JSON.stringify(body || {}),
    }),
  // Phase 9b — hedger PnL. ``window`` is one of 24h | 7d | 30d | all.
  hedgerPnl: (window = '7d') =>
    adminFetch(`/api/admin/hedger/pnl?window=${encodeURIComponent(window)}`),
  liquidityRetryQueue: (params = {}) => {
    const u = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v).trim() !== '') u.set(k, String(v).trim());
    });
    const qs = u.toString();
    return adminFetch(`/api/admin/liquidity/retry-queue${qs ? `?${qs}` : ''}`);
  },
  retryLiquidityQueueItem: (queueId) =>
    adminFetch(`/api/admin/liquidity/retry-queue/${encodeURIComponent(queueId)}/retry`, { method: 'POST' }),
  liquidityDeadLetters: (params = {}) => {
    const u = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v).trim() !== '') u.set(k, String(v).trim());
    });
    const qs = u.toString();
    return adminFetch(`/api/admin/liquidity/dead-letters${qs ? `?${qs}` : ''}`);
  },
  liquidityExecutionDetail: (executionKey) =>
    adminFetch(`/api/admin/liquidity/execution/${encodeURIComponent(executionKey)}`),
  liquidityHealth: () => adminFetch('/api/admin/liquidity/health'),
  retryLiquidityDeadLetter: (deadId) =>
    adminFetch(`/api/admin/liquidity/dead-letters/${encodeURIComponent(deadId)}/retry`, { method: 'POST' }),

  // Phase 9c — alerts. ``params`` supports status/severity/source/type/search/page/limit.
  alertsList: (params = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === '') continue;
      qs.set(k, String(v));
    }
    const q = qs.toString();
    return adminFetch(`/api/admin/alerts${q ? `?${q}` : ''}`);
  },
  alertsStats: () => adminFetch('/api/admin/alerts/stats'),
  alertResolve: (id, body = {}) =>
    adminFetch(`/api/admin/alerts/${encodeURIComponent(id)}/resolve`, {
      method: 'POST',
      body: JSON.stringify(body || {}),
    }),
  alertMute: (id, body = {}) =>
    adminFetch(`/api/admin/alerts/${encodeURIComponent(id)}/mute`, {
      method: 'POST',
      body: JSON.stringify(body || {}),
    }),
  alertTest: (body = {}) =>
    adminFetch('/api/admin/alerts/test', {
      method: 'POST',
      body: JSON.stringify(body || {}),
    }),
  securityDashboard: () => adminFetch('/api/admin/security/dashboard'),
  securityBlocks: (params = {}) => {
    const u = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v).trim() !== '') u.set(k, String(v).trim());
    });
    const qs = u.toString();
    return adminFetch(`/api/admin/security/blocks${qs ? `?${qs}` : ''}`);
  },
  createSecurityBlock: (body) =>
    adminFetch('/api/admin/security/blocks', {
      method: 'POST',
      body: JSON.stringify(body || {}),
    }),
  patchSecurityBlock: (id, body) =>
    adminFetch(`/api/admin/security/blocks/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(body || {}),
    }),
  systemLogs: (params = {}) => {
    const u = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v).trim() !== '') u.set(k, String(v).trim());
    });
    const qs = u.toString();
    return adminFetch(`/api/admin/system-logs${qs ? `?${qs}` : ''}`);
  },
  complianceDashboard: () => adminFetch('/api/admin/compliance/dashboard'),
  complianceCases: (params = {}) => {
    const u = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v).trim() !== '') u.set(k, String(v).trim());
    });
    const qs = u.toString();
    return adminFetch(`/api/admin/compliance/cases${qs ? `?${qs}` : ''}`);
  },
  createComplianceCase: (body = {}) =>
    adminFetch('/api/admin/compliance/cases', {
      method: 'POST',
      body: JSON.stringify(body || {}),
    }),
  patchComplianceCase: (id, body = {}) =>
    adminFetch(`/api/admin/compliance/cases/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(body || {}),
    }),
  addComplianceAttachment: (id, body = {}) =>
    adminFetch(`/api/admin/compliance/cases/${encodeURIComponent(id)}/attachments`, {
      method: 'POST',
      body: JSON.stringify(body || {}),
    }),
  complianceScreeningConfig: () => adminFetch('/api/admin/compliance/screening-config'),
  patchComplianceScreeningConfig: (body = {}) =>
    adminFetch('/api/admin/compliance/screening-config', {
      method: 'PATCH',
      body: JSON.stringify(body || {}),
    }),
  complianceWalletBlacklist: (params = {}) => {
    const u = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v).trim() !== '') u.set(k, String(v).trim());
    });
    const qs = u.toString();
    return adminFetch(`/api/admin/compliance/wallet-blacklist${qs ? `?${qs}` : ''}`);
  },
  createComplianceWalletBlacklist: (body = {}) =>
    adminFetch('/api/admin/compliance/wallet-blacklist', {
      method: 'POST',
      body: JSON.stringify(body || {}),
    }),
  patchComplianceWalletBlacklist: (id, body = {}) =>
    adminFetch(`/api/admin/compliance/wallet-blacklist/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(body || {}),
    }),
  complianceSanctions: (params = {}) => {
    const u = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v).trim() !== '') u.set(k, String(v).trim());
    });
    const qs = u.toString();
    return adminFetch(`/api/admin/compliance/sanctions${qs ? `?${qs}` : ''}`);
  },
  createComplianceSanction: (body = {}) =>
    adminFetch('/api/admin/compliance/sanctions', {
      method: 'POST',
      body: JSON.stringify(body || {}),
    }),
  patchComplianceSanction: (id, body = {}) =>
    adminFetch(`/api/admin/compliance/sanctions/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(body || {}),
    }),
  syncComplianceSanctions: () =>
    adminFetch('/api/admin/compliance/sanctions/sync', { method: 'POST' }),
  complianceSanctionsSyncStatus: () =>
    adminFetch('/api/admin/compliance/sanctions/sync-status'),
  complianceTransactionMonitoring: (params = {}) => {
    const u = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v).trim() !== '') u.set(k, String(v).trim());
    });
    const qs = u.toString();
    return adminFetch(`/api/admin/compliance/transaction-monitoring${qs ? `?${qs}` : ''}`);
  },
  runComplianceTransactionMonitoring: (body = {}) =>
    adminFetch('/api/admin/compliance/transaction-monitoring/run', {
      method: 'POST',
      body: JSON.stringify(body || {}),
    }),
  complianceReports: (params = {}) => {
    const u = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v).trim() !== '') u.set(k, String(v).trim());
    });
    const qs = u.toString();
    return adminFetch(`/api/admin/compliance/reports${qs ? `?${qs}` : ''}`);
  },
  generateComplianceReport: (body = {}) =>
    adminFetch('/api/admin/compliance/reports', {
      method: 'POST',
      body: JSON.stringify(body || {}),
    }),
  downloadComplianceReport: (id) =>
    adminFetch(`/api/admin/compliance/reports/${encodeURIComponent(id)}/download`),
  submitComplianceReportFIU: (id) =>
    adminFetch(`/api/admin/compliance/reports/${encodeURIComponent(id)}/fiu-submit`, {
      method: 'POST',
    }),
  complianceRules: () => adminFetch('/api/admin/compliance/rules'),
  patchComplianceRule: (id, body = {}) =>
    adminFetch(`/api/admin/compliance/rules/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(body || {}),
    }),
  accountFreeze: (uid, body = {}) =>
    adminFetch(`/api/admin/users/${encodeURIComponent(uid)}/account-freeze`, {
      method: 'POST',
      body: JSON.stringify(body || {}),
    }),
  accountUnfreeze: (uid) =>
    adminFetch(`/api/admin/users/${encodeURIComponent(uid)}/account-unfreeze`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  patchKycTier: (uid, body = {}) =>
    adminFetch(`/api/admin/kyc/${encodeURIComponent(uid)}/tier`, {
      method: 'PATCH',
      body: JSON.stringify(body || {}),
    }),

  // ── Futures admin module ─────────────────────────────────────────────────
  // All endpoints sit under /api/admin/futures and require an admin JWT.
  // Permission gating happens server-side; the UI just hides the link.
  futures: {
    overview: () => adminFetch('/api/admin/futures/overview'),
    getControls: () => adminFetch('/api/admin/futures/controls'),
    patchControls: (body) =>
      adminFetch('/api/admin/futures/controls', {
        method: 'PATCH',
        body: JSON.stringify(body || {}),
      }),
    listSymbols: () => adminFetch('/api/admin/futures/symbols'),
    getSymbol: (symbol) =>
      adminFetch(`/api/admin/futures/symbols/${encodeURIComponent(symbol)}`),
    patchSymbol: (symbol, body) =>
      adminFetch(`/api/admin/futures/symbols/${encodeURIComponent(symbol)}`, {
        method: 'PATCH',
        body: JSON.stringify(body || {}),
      }),
    listPositions: (params = {}) => {
      const u = new URLSearchParams();
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && String(v).trim() !== '') u.set(k, String(v).trim());
      });
      return adminFetch(`/api/admin/futures/positions?${u}`);
    },
    forceClosePosition: (id, body = {}) =>
      adminFetch(`/api/admin/futures/positions/${encodeURIComponent(id)}/force-close`, {
        method: 'POST',
        body: JSON.stringify(body || {}),
      }),
    listOrders: (params = {}) => {
      const u = new URLSearchParams();
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && String(v).trim() !== '') u.set(k, String(v).trim());
      });
      return adminFetch(`/api/admin/futures/orders?${u}`);
    },
    cancelOrder: (id) =>
      adminFetch(`/api/admin/futures/orders/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    listTrades: (params = {}) => {
      const u = new URLSearchParams();
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && String(v).trim() !== '') u.set(k, String(v).trim());
      });
      return adminFetch(`/api/admin/futures/trades?${u}`);
    },
    listLiquidations: (params = {}) => {
      const u = new URLSearchParams();
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && String(v).trim() !== '') u.set(k, String(v).trim());
      });
      return adminFetch(`/api/admin/futures/liquidations?${u}`);
    },
    listFundingRates: (params = {}) => {
      const u = new URLSearchParams();
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && String(v).trim() !== '') u.set(k, String(v).trim());
      });
      return adminFetch(`/api/admin/futures/funding/rates?${u}`);
    },
    listFundingPayments: (params = {}) => {
      const u = new URLSearchParams();
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && String(v).trim() !== '') u.set(k, String(v).trim());
      });
      return adminFetch(`/api/admin/futures/funding/payments?${u}`);
    },
    settleFunding: (symbol) =>
      adminFetch('/api/admin/futures/funding/settle', {
        method: 'POST',
        body: JSON.stringify({ symbol }),
      }),
    listWallets: (params = {}) => {
      const u = new URLSearchParams();
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && String(v).trim() !== '') u.set(k, String(v).trim());
      });
      return adminFetch(`/api/admin/futures/wallets?${u}`);
    },
    walletSnapshot: (uid) =>
      adminFetch(`/api/admin/futures/wallets/${encodeURIComponent(uid)}/snapshot`),
    walletTxns: (uid, params = {}) => {
      const u = new URLSearchParams();
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && String(v).trim() !== '') u.set(k, String(v).trim());
      });
      return adminFetch(`/api/admin/futures/wallets/${encodeURIComponent(uid)}/txns?${u}`);
    },
    adjustWallet: (body) =>
      adminFetch('/api/admin/futures/wallets/adjust', {
        method: 'POST',
        body: JSON.stringify(body || {}),
      }),
    listMarks: () => adminFetch('/api/admin/futures/mark-prices'),
  },

  options: {
    seedDemoData: (body = {}) =>
      adminFetch('/api/admin/options/seed-demo-data', {
        method: 'POST',
        body: JSON.stringify(body && typeof body === 'object' ? body : {}),
      }),
    overview: () => adminFetch('/api/admin/options/overview'),
    feeSinkWallet: () => adminFetch('/api/admin/options/fee-sink-wallet'),
    getControls: () => adminFetch('/api/admin/options/controls'),
    patchControls: (body) =>
      adminFetch('/api/admin/options/controls', {
        method: 'PATCH',
        body: JSON.stringify(body || {}),
      }),
    listUnderlyings: (params = {}) => {
      const u = new URLSearchParams();
      if (params.listed_only != null) u.set('listed_only', String(params.listed_only));
      const q = u.toString();
      return adminFetch(q ? `/api/admin/options/underlyings?${q}` : '/api/admin/options/underlyings');
    },
    createUnderlying: (body) =>
      adminFetch('/api/admin/options/underlyings', {
        method: 'POST',
        body: JSON.stringify(body || {}),
      }),
    patchUnderlying: (id, body) =>
      adminFetch(`/api/admin/options/underlyings/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(body || {}),
      }),
    listContracts: (params = {}) => {
      const u = new URLSearchParams();
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && String(v).trim() !== '') u.set(k, String(v).trim());
      });
      const q = u.toString();
      return adminFetch(q ? `/api/admin/options/contracts?${q}` : '/api/admin/options/contracts');
    },
    createContract: (body) =>
      adminFetch('/api/admin/options/contracts', {
        method: 'POST',
        body: JSON.stringify(body || {}),
      }),
    patchContract: (id, body) =>
      adminFetch(`/api/admin/options/contracts/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(body || {}),
      }),
    settleContract: (id, params = {}) => {
      const u = new URLSearchParams();
      if (params.dry_run) u.set('dry_run', 'true');
      const q = u.toString();
      const path = `/api/admin/options/contracts/${encodeURIComponent(id)}/settle${q ? `?${q}` : ''}`;
      return adminFetch(path, {
        method: 'POST',
        body: JSON.stringify({
          force: !!params.force,
          settlement_index: params.settlement_index,
        }),
      });
    },
  },

  // ── P2P admin module ─────────────────────────────────────────────────────
  p2p: {
    kpis: () => adminFetch('/api/admin/p2p/kpis'),
    listAds: (params = {}) => {
      const u = new URLSearchParams();
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && String(v).trim() !== '') u.set(k, String(v).trim());
      });
      const q = u.toString();
      return adminFetch(q ? `/api/admin/p2p/ads?${q}` : '/api/admin/p2p/ads');
    },
    suspendAd: (adId, body = {}) =>
      adminFetch(`/api/admin/p2p/ads/${encodeURIComponent(adId)}/suspend`, {
        method: 'POST', body: JSON.stringify(body),
      }),
    listOrders: (params = {}) => {
      const u = new URLSearchParams();
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && String(v).trim() !== '') u.set(k, String(v).trim());
      });
      const q = u.toString();
      return adminFetch(q ? `/api/admin/p2p/orders?${q}` : '/api/admin/p2p/orders');
    },
    orderDetail: (orderId) => adminFetch(`/api/admin/p2p/orders/${encodeURIComponent(orderId)}`),
    listDisputes: (params = {}) => {
      const u = new URLSearchParams();
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && String(v).trim() !== '') u.set(k, String(v).trim());
      });
      const q = u.toString();
      return adminFetch(q ? `/api/admin/p2p/disputes?${q}` : '/api/admin/p2p/disputes');
    },
    disputeDetail: (disputeId) => adminFetch(`/api/admin/p2p/disputes/${encodeURIComponent(disputeId)}`),
    resolveDispute: (disputeId, body) =>
      adminFetch(`/api/admin/p2p/disputes/${encodeURIComponent(disputeId)}/resolve`, {
        method: 'POST', body: JSON.stringify(body),
      }),
    banUser: (uid, body = {}) =>
      adminFetch(`/api/admin/p2p/users/${encodeURIComponent(uid)}/ban`, {
        method: 'POST', body: JSON.stringify(body),
      }),
    unbanUser: (uid) =>
      adminFetch(`/api/admin/p2p/users/${encodeURIComponent(uid)}/unban`, {
        method: 'POST', body: JSON.stringify({}),
      }),
    listMerchantApps: (params = {}) => {
      const u = new URLSearchParams();
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && String(v).trim() !== '') u.set(k, String(v).trim());
      });
      const q = u.toString();
      return adminFetch(q ? `/api/admin/p2p/merchants?${q}` : '/api/admin/p2p/merchants');
    },
    reviewMerchant: (applicationId, body) =>
      adminFetch(`/api/admin/p2p/merchants/${encodeURIComponent(applicationId)}/review`, {
        method: 'POST', body: JSON.stringify(body),
      }),
    fraudIntel: (params = {}) => {
      const u = new URLSearchParams();
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && String(v).trim() !== '') u.set(k, String(v).trim());
      });
      const q = u.toString();
      return adminFetch(q ? `/api/admin/p2p/fraud-intel?${q}` : '/api/admin/p2p/fraud-intel');
    },
  },

  // ── Delta Trading Ecosystem ──────────────────────────────────────────────────
  ibo: {
    dashboard: () => adminFetch('/api/admin/ibo/dashboard'),

    getPrice: () => adminFetch('/api/admin/ibo/price'),
    updatePrice: (body) => adminFetch('/api/admin/ibo/price', {
      method: 'PATCH', body: JSON.stringify(body),
    }),
    clearPriceOverride: () => adminFetch('/api/admin/ibo/price/override', { method: 'DELETE' }),

    getLiquidity: () => adminFetch('/api/admin/ibo/liquidity'),
    updateLiquidity: (body) => adminFetch('/api/admin/ibo/liquidity', {
      method: 'PATCH', body: JSON.stringify(body),
    }),

    getPairs: () => adminFetch('/api/admin/ibo/pairs'),
    updatePair: (symbol, body) => adminFetch(`/api/admin/ibo/pairs/${encodeURIComponent(symbol)}`, {
      method: 'PATCH', body: JSON.stringify(body),
    }),

    getWalletSupply: () => adminFetch('/api/admin/ibo/wallet-supply'),

    getDepositsWithdrawals: (params = {}) => {
      const u = new URLSearchParams();
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && String(v).trim() !== '') u.set(k, String(v).trim());
      });
      const q = u.toString();
      return adminFetch(q ? `/api/admin/ibo/deposits-withdrawals?${q}` : '/api/admin/ibo/deposits-withdrawals');
    },

    getUserHoldings: (params = {}) => {
      const u = new URLSearchParams();
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && String(v).trim() !== '') u.set(k, String(v).trim());
      });
      const q = u.toString();
      return adminFetch(q ? `/api/admin/ibo/user-holdings?${q}` : '/api/admin/ibo/user-holdings');
    },

    getAnalytics: (params = {}) => {
      const u = new URLSearchParams();
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && String(v).trim() !== '') u.set(k, String(v).trim());
      });
      const q = u.toString();
      return adminFetch(q ? `/api/admin/ibo/analytics?${q}` : '/api/admin/ibo/analytics');
    },

    getLogs: (params = {}) => {
      const u = new URLSearchParams();
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && String(v).trim() !== '') u.set(k, String(v).trim());
      });
      const q = u.toString();
      return adminFetch(q ? `/api/admin/ibo/logs?${q}` : '/api/admin/ibo/logs');
    },
  },

  listings: {
    stats: () => adminFetch('/api/admin/listings/stats'),
    platformToken: () => adminFetch('/api/admin/listings/platform-token'),
    reseedPlatformToken: () => adminFetch('/api/admin/listings/platform-token/reseed', { method: 'POST' }),
    listRequests: (params = {}) => {
      const u = new URLSearchParams();
      Object.entries(params).forEach(([k, v]) => {
        if (v != null && String(v).trim() !== '') u.set(k, String(v).trim());
      });
      const q = u.toString();
      return adminFetch(q ? `/api/admin/listings/requests?${q}` : '/api/admin/listings/requests');
    },
    listTokens: (params = {}) => {
      const u = new URLSearchParams();
      Object.entries(params).forEach(([k, v]) => {
        if (v != null && String(v).trim() !== '') u.set(k, String(v).trim());
      });
      const q = u.toString();
      return adminFetch(q ? `/api/admin/listings/tokens?${q}` : '/api/admin/listings/tokens');
    },
    getToken: (id) => adminFetch(`/api/admin/listings/tokens/${encodeURIComponent(id)}`),
    createToken: (body) => adminFetch('/api/admin/listings/tokens', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    patchToken: (id, body) => adminFetch(`/api/admin/listings/tokens/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
    patchTokenDirect: (id, formData) =>
      adminUpload(`/api/admin/listings/tokens/${encodeURIComponent(id)}/direct`, formData, { method: 'PATCH' }),
    reviewRequest: (id, body) => adminFetch(`/api/admin/listings/requests/${encodeURIComponent(id)}/review`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    createTokenDirect: (formData) => adminUpload('/api/admin/listings/tokens/direct', formData),
    marketCatalog: () => adminFetch('/api/admin/listings/market-catalog'),
    patchMarketCatalog: (body) => adminFetch('/api/admin/listings/market-catalog', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
    bscDirectory: (params = {}) => {
      const q = new URLSearchParams();
      Object.entries(params).forEach(([k, v]) => {
        if (v != null && v !== '') q.set(k, String(v));
      });
      const qs = q.toString();
      return adminFetch(`/api/admin/listings/bsc-directory${qs ? `?${qs}` : ''}`);
    },
  },
  inrStats: () => adminFetch('/api/admin/inr/stats'),
  inrRate: () => adminFetch('/api/admin/inr/rate'),
  inrGatewayProviders: () => adminFetch('/api/admin/inr/gateway-providers'),
  inrGatewayConfig: () => adminFetch('/api/admin/inr/gateway-config'),
  inrUpdateGatewayConfig: (body) =>
    adminFetch('/api/admin/inr/gateway-config', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  inrDepositPreview: (depositId) =>
    adminFetch(`/api/admin/inr/deposits/${encodeURIComponent(depositId)}/preview`),
  inrPaymentMethods: () => adminFetch('/api/admin/inr/payment-methods'),
  inrCreatePaymentMethod: (body) =>
    adminFetch('/api/admin/inr/payment-methods', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  inrCreateQrPaymentMethod: (formData) =>
    adminUpload('/api/admin/inr/payment-methods/with-qr', formData),
  inrUpdatePaymentMethod: (id, body) =>
    adminFetch(`/api/admin/inr/payment-methods/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  inrDeletePaymentMethod: (id) =>
    adminFetch(`/api/admin/inr/payment-methods/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  inrDeposits: (params = {}) => {
    const u = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v).trim() !== '') u.set(k, String(v).trim());
    });
    const qs = u.toString();
    return adminFetch(`/api/admin/inr/deposits${qs ? `?${qs}` : ''}`);
  },
  inrApproveDeposit: (id, body = {}) =>
    adminFetch(`/api/admin/inr/deposits/${encodeURIComponent(id)}/approve`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  inrRejectDeposit: (id, body) =>
    adminFetch(`/api/admin/inr/deposits/${encodeURIComponent(id)}/reject`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  inrWithdrawals: (params = {}) => {
    const u = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v).trim() !== '') u.set(k, String(v).trim());
    });
    const qs = u.toString();
    return adminFetch(`/api/admin/inr/withdrawals${qs ? `?${qs}` : ''}`);
  },
  inrApproveWithdrawal: (id, body = {}) =>
    adminFetch(`/api/admin/inr/withdrawals/${encodeURIComponent(id)}/approve`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  inrRejectWithdrawal: (id, body) =>
    adminFetch(`/api/admin/inr/withdrawals/${encodeURIComponent(id)}/reject`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};
