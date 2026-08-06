import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { exchangeWsPath } from '@/services/marketApi';
import {
  formatApiDetail,
  parseFastApi422FieldErrors,
  AuthRequestError,
  authFormBannerMessage,
  normalizeSignupMobileDigits,
} from '@/lib/authValidation';
import { exchangeApiOrigin } from '@/lib/apiBase';
import { getStoredReferralCode } from '@/lib/referral';

const AuthContext = createContext(null);

const API = exchangeApiOrigin(import.meta.env.VITE_BACKEND_URL);

// ── Storage helpers ───────────────────────────────────────────────────────────

const store = {
  getUser:  () => { try { return JSON.parse(localStorage.getItem('ibo_ex_user') || 'null'); } catch { return null; } },
  getToken: () => localStorage.getItem('ibo_ex_token') || null,
  // Phase 7b — refresh token (rotated on every /auth/refresh). Optional
  // on disk: if it's missing we simply fall back to the Phase-1 single
  // access token behaviour and the user re-logs in when it expires.
  getRefresh: () => localStorage.getItem('ibo_ex_refresh') || null,
  setUser:  (u) => localStorage.setItem('ibo_ex_user', JSON.stringify(u)),
  setToken: (t) => localStorage.setItem('ibo_ex_token', t),
  setRefresh: (t) => {
    if (t) localStorage.setItem('ibo_ex_refresh', t);
    else   localStorage.removeItem('ibo_ex_refresh');
  },
  clear:    () => {
    localStorage.removeItem('ibo_ex_token');
    localStorage.removeItem('ibo_ex_refresh');
    localStorage.removeItem('ibo_ex_user');
  },
};

// ── Authenticated fetch utility (exported for use in pages/components) ────────

export function getStoredExchangeToken() {
  return store.getToken();
}

async function readJsonSafe(res) {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

function throwAuthFailure(res, data, fallbackMessage) {
  const fe422 = res.status === 422 ? parseFastApi422FieldErrors(data?.detail) : {};
  const hasFields = Object.keys(fe422).length > 0;
  const hint = data?.hint && typeof data.hint === 'string' ? ` ${data.hint.trim()}` : '';
  const detailMsg = (formatApiDetail(data?.detail) || fallbackMessage) + hint;
  const banner = authFormBannerMessage(hasFields ? fe422 : {}, detailMsg);
  throw new AuthRequestError(banner, {
    fieldErrors: hasFields ? fe422 : null,
    status: res.status,
  });
}

function bodyShouldBeJsonStringified(body) {
  if (body == null || typeof body !== 'object') return false;
  if (typeof FormData !== 'undefined' && body instanceof FormData) return false;
  if (typeof Blob !== 'undefined' && body instanceof Blob) return false;
  if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) return false;
  if (typeof ArrayBuffer !== 'undefined' && body instanceof ArrayBuffer) return false;
  const proto = Object.getPrototypeOf(body);
  return proto === Object.prototype || proto === null;
}

function buildAuthRequest(url, options) {
  const token = store.getToken();
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const headers = { ...(options.headers || {}) };
  let body = options.body;
  if (!isFormData && bodyShouldBeJsonStringified(body)) {
    body = JSON.stringify(body);
  }
  if (!isFormData && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) headers.Authorization = `Bearer ${token}`;
  return { url, init: { ...options, headers, body } };
}

// Phase 7b — in-flight refresh promise shared across concurrent 401s so
// we only hit /auth/refresh once per rotation window. Resolves to true
// on successful rotation, false otherwise.
let _refreshInFlight = null;

function clearAuthStorage() {
  store.clear();
}

async function attemptRefresh() {
  if (!_refreshInFlight) {
    _refreshInFlight = (async () => {
      const rt = store.getRefresh();
      if (!rt) return false;
      try {
        const res = await fetch(`${API}/api/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: rt }),
        });
        if (!res.ok) return false;
        const data = await res.json().catch(() => ({}));
        if (!data.access_token) return false;
        store.setToken(data.access_token);
        if (data.refresh_token) store.setRefresh(data.refresh_token);
        return true;
      } catch {
        return false;
      } finally {
        // small delay lets any sibling 401 finish its second attempt
        setTimeout(() => { _refreshInFlight = null; }, 0);
      }
    })();
  }
  return _refreshInFlight;
}

export function authFetch(url, options = {}) {
  const { url: finalUrl, init } = buildAuthRequest(url, options);
  return fetch(finalUrl, init).catch((err) => {
    const msg = String(err?.message || err || '');
    if (/failed to fetch|networkerror|load failed|network request failed/i.test(msg)) {
      throw new Error(
        `Cannot reach the API at ${API}. Is the backend running on port 8000?`,
      );
    }
    throw err;
  }).then(async (res) => {
    // Only retry on 401 for endpoints that look like protected API calls.
    // /auth/refresh and /auth/login must NEVER recurse.
    if (res.status !== 401) return res;
    if (!store.getToken() || !store.getRefresh()) return res;
    if (typeof finalUrl === 'string'
        && (finalUrl.includes('/api/auth/refresh')
            || finalUrl.includes('/api/auth/login')
            || finalUrl.includes('/api/auth/register'))) {
      return res;
    }
    const ok = await attemptRefresh();
    if (!ok) return res;
    // Retry once with the rotated access token.
    const retry = buildAuthRequest(url, options);
    return fetch(retry.url, retry.init);
  });
}

// ── Wallet transform helper ───────────────────────────────────────────────────

function transformWallet(walletAssets) {
  const balance = {};
  const lockedBalance = {};
  for (const w of walletAssets) {
    balance[w.asset]       = w.available;
    lockedBalance[w.asset] = w.locked;
  }
  return { balance, lockedBalance };
}

// ── Provider ──────────────────────────────────────────────────────────────────

export function AuthProvider({ children }) {
  const [user,          setUser]          = useState(store.getUser);
  const [walletAssets,  setWalletAssets]  = useState([]);
  const [balance,       setBalance]       = useState({});     // available only — for TradeForm backward compat
  const [lockedBalance, setLockedBalance] = useState({});
  const [walletLoading, setWalletLoading] = useState(false);

  // Orders (fetched from API — no more client-side simulation)
  const [openOrders,    setOpenOrders]    = useState([]);
  const [orderHistory,  setOrderHistory]  = useState([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [userTrades,    setUserTrades]    = useState([]);
  const [userTradesLoading, setUserTradesLoading] = useState(false);
  /** Spot P&L rows from `/api/portfolio/positions`; `null` until first REST or account WS message. */
  const [liveSpotPositions, setLiveSpotPositions] = useState(null);

  const [authLoading, setAuthLoading] = useState(true);

  // KYC status
  const [kyc, setKyc] = useState(null);

  const [impersonationActive, setImpersonationActive] = useState(false);
  const [impersonatorAdminId, setImpersonatorAdminId] = useState(null);
  const [userFeaturesPaused, setUserFeaturesPaused] = useState(false);
  const [userTradingPaused, setUserTradingPaused] = useState(false);
  const [userWithdrawalsPaused, setUserWithdrawalsPaused] = useState(false);
  const [userPauseNote, setUserPauseNote] = useState(null);

  const refreshSession = useCallback(async () => {
    const token = store.getToken();
    if (!token) {
      setImpersonationActive(false);
      setImpersonatorAdminId(null);
      setUserFeaturesPaused(false);
      setUserTradingPaused(false);
      setUserWithdrawalsPaused(false);
      setUserPauseNote(null);
      return;
    }
    try {
      const res = await authFetch(`${API}/api/auth/session`);
      if (!res.ok) return;
      const s = await res.json();
      setImpersonationActive(!!s.impersonation_active);
      setImpersonatorAdminId(s.impersonator_admin_id ?? null);
      setUserFeaturesPaused(!!s.user_features_paused);
      setUserTradingPaused(!!s.user_trading_paused);
      setUserWithdrawalsPaused(!!s.user_withdrawals_paused);
      setUserPauseNote(s.user_pause_note ?? null);
    } catch {
      /* ignore */
    }
  }, []);

  // ── Fetch KYC status ──────────────────────────────────────────────────────
  const fetchKyc = useCallback(async () => {
    try {
      const res = await authFetch(`${API}/api/kyc/status`);
      if (res.ok) setKyc(await res.json());
    } catch { /* silent */ }
  }, []);

  // ── Fetch wallet ──────────────────────────────────────────────────────────
  const fetchWallet = useCallback(async () => {
    setWalletLoading(true);
    try {
      const res  = await authFetch(`${API}/api/wallet/balances`);
      if (!res.ok) return;
      const data = await res.json();
      setWalletAssets(data);
      const { balance: b, lockedBalance: lb } = transformWallet(data);
      setBalance(b);
      setLockedBalance(lb);
    } catch { /* silent */ }
    finally { setWalletLoading(false); }
  }, []);

  // ── Fetch orders ──────────────────────────────────────────────────────────
  const fetchOrders = useCallback(async () => {
    setOrdersLoading(true);
    try {
      const [openRes, histRes] = await Promise.all([
        authFetch(`${API}/api/orders`),
        authFetch(`${API}/api/orders/history`),
      ]);
      if (openRes.ok)  setOpenOrders(await openRes.json());
      if (histRes.ok)  setOrderHistory(await histRes.json());
    } catch { /* silent */ }
    finally { setOrdersLoading(false); }
  }, []);

  /** Merge one resting order from POST /orders so the list updates before the next WS tick. */
  const upsertOpenOrder = useCallback((order) => {
    if (!order?.id) return;
    const st = String(order.status || '').toLowerCase();
    if (st !== 'open' && st !== 'partially_filled') return;
    setOpenOrders((prev) => {
      const i = prev.findIndex((o) => o.id === order.id);
      if (i >= 0) {
        const next = [...prev];
        next[i] = order;
        return next;
      }
      return [order, ...prev];
    });
  }, []);

  const fetchUserTrades = useCallback(async () => {
    setUserTradesLoading(true);
    try {
      const res = await authFetch(`${API}/api/orders/trades`);
      if (res.ok) setUserTrades(await res.json());
    } catch { /* silent */ }
    finally { setUserTradesLoading(false); }
  }, []);

  const fetchLiveSpotPositions = useCallback(async () => {
    try {
      const res = await authFetch(`${API}/api/portfolio/positions`);
      if (res.ok) setLiveSpotPositions(await res.json());
    } catch { /* silent */ }
  }, []);

  /**
   * Phase 2 — fetch the authenticated user's wallet ledger
   * (`GET /api/wallet/transactions`). Pure data plumbing — no UI redesign;
   * pages can consume this to show per-asset / per-order ledger history.
   *
   * Supported filters (all optional): `asset`, `type`, `ref_id`,
   * `date_from`, `date_to`, `skip`, `limit`. The endpoint returns
   * `{ items, total, skip, limit }` newest-first.
   */
  const fetchWalletTransactions = useCallback(async (filters = {}) => {
    const params = new URLSearchParams();
    Object.entries(filters || {}).forEach(([k, v]) => {
      if (v === undefined || v === null) return;
      const s = String(v).trim();
      if (s !== '') params.set(k, s);
    });
    const qs = params.toString();
    const res = await authFetch(`${API}/api/wallet/transactions${qs ? `?${qs}` : ''}`);
    if (!res.ok) {
      const err = await readJsonSafe(res);
      throw new Error(err?.detail || `Could not load wallet transactions (HTTP ${res.status})`);
    }
    return res.json();
  }, []);

  // ── Live account stream (wallet + orders + fills + spot positions); auto-reconnect like market WS ─
  useEffect(() => {
    if (!user) return undefined;
    if (!store.getToken()) return undefined;
    let closed = false;
    let reconnectTimer = null;
    let ws = null;

    const applyAccountMessage = (msg) => {
      if (msg.type !== 'exchange_account') return;
      if (Array.isArray(msg.wallet)) {
        setWalletAssets(msg.wallet);
        const { balance: b, lockedBalance: lb } = transformWallet(msg.wallet);
        setBalance(b);
        setLockedBalance(lb);
      }
      if (Array.isArray(msg.open_orders)) setOpenOrders(msg.open_orders);
      if (Array.isArray(msg.order_history)) setOrderHistory(msg.order_history);
      if (Array.isArray(msg.user_trades)) setUserTrades(msg.user_trades);
      if (Array.isArray(msg.positions)) setLiveSpotPositions(msg.positions);
    };

    const connect = () => {
      if (closed) return;
      const liveToken = store.getToken();
      if (!liveToken) return;
      const url = exchangeWsPath(`/api/ws/exchange/account?token=${encodeURIComponent(liveToken)}`);
      try {
        ws = new WebSocket(url);
      } catch {
        if (!closed) reconnectTimer = window.setTimeout(connect, 3000);
        return;
      }
      ws.onmessage = (ev) => {
        if (closed) return;
        try {
          applyAccountMessage(JSON.parse(ev.data));
        } catch { /* ignore */ }
      };
      ws.onclose = () => {
        ws = null;
        if (!closed && store.getToken()) reconnectTimer = window.setTimeout(connect, 3000);
      };
    };

    connect();
    return () => {
      closed = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (ws) {
        try {
          ws.close();
        } catch { /* ignore */ }
      }
    };
  }, [user?.uid]);

  // ── On mount: validate stored token, then load wallet + orders ────────────
  useEffect(() => {
    const token = store.getToken();
    if (!token) { setAuthLoading(false); return; }

    authFetch(`${API}/api/auth/me`)
      .then(res => { if (!res.ok) throw new Error('Token invalid'); return res.json(); })
      .then(userData => {
        setUser(userData);
        store.setUser(userData);
        return Promise.all([
          fetchWallet(),
          fetchOrders(),
          fetchUserTrades(),
          fetchLiveSpotPositions(),
          fetchKyc(),
          refreshSession(),
        ]);
      })
      .catch(() => { store.clear(); setUser(null); })
      .finally(() => setAuthLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Login ─────────────────────────────────────────────────────────────────
  const login = useCallback(async (email, password) => {
    const res  = await authFetch(`${API}/api/auth/login`, {
      method: 'POST', body: JSON.stringify({ email, password }),
    });
    const data = await readJsonSafe(res);
    if (!res.ok) throwAuthFailure(res, data, 'Login failed');
    store.setToken(data.access_token);
    if (data.refresh_token) store.setRefresh(data.refresh_token);
    store.setUser(data.user);
    setUser(data.user);
    await Promise.all([
      fetchWallet(),
      fetchOrders(),
      fetchUserTrades(),
      fetchLiveSpotPositions(),
      fetchKyc(),
      refreshSession(),
    ]);
    return data.user;
  }, [fetchWallet, fetchOrders, fetchUserTrades, fetchLiveSpotPositions, fetchKyc, refreshSession]);

  // ── Register (one-step) ─────────────────────────────────────────────────────
  const applyTokenResponse = useCallback(async (data) => {
    store.setToken(data.access_token);
    if (data.refresh_token) store.setRefresh(data.refresh_token);
    store.setUser(data.user);
    setUser(data.user);
    await Promise.all([
      fetchWallet(),
      fetchOrders(),
      fetchUserTrades(),
      fetchLiveSpotPositions(),
      fetchKyc(),
      refreshSession(),
    ]);
    return data.user;
  }, [fetchWallet, fetchOrders, fetchUserTrades, fetchLiveSpotPositions, fetchKyc, refreshSession]);

  /** Google / Apple — `provider` is "google" | "apple". */
  const loginOAuth = useCallback(async (provider, payload = {}) => {
    const path = provider === 'apple' ? 'apple' : 'google';
    const body = {
      id_token: payload.id_token || undefined,
      access_token: payload.access_token || undefined,
      name: payload.name || undefined,
    };
    const ref = getStoredReferralCode();
    if (ref) body.referral_code = ref;
    const res = await authFetch(`${API}/api/auth/oauth/${path}`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(body),
    });
    const data = await readJsonSafe(res);
    if (!res.ok) throwAuthFailure(res, data, 'Social sign-in failed');
    return applyTokenResponse(data);
  }, [applyTokenResponse]);

  const register = useCallback(async (name, email, password, referralCode) => {
    const payload = {
      name: String(name ?? '').trim(),
      email: String(email ?? '').trim(),
      password: String(password ?? ''),
    };
    const ref = (referralCode != null && String(referralCode).trim()) || getStoredReferralCode();
    if (ref) payload.referral_code = ref;
    const body = JSON.stringify(payload);
    const res = await authFetch(`${API}/api/auth/register`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json; charset=utf-8',
      },
      body,
    });
    const data = await readJsonSafe(res);
    if (!res.ok) throwAuthFailure(res, data, 'Registration failed');
    return applyTokenResponse(data);
  }, [applyTokenResponse]);

  // ── Two-step registration (request → verify) ────────────────────────────

  /** Send email OTP (email only). Optionally pass mobile/country to link the same signup session. */
  const registerRequest = useCallback(async (email, mobile, countryCode) => {
    const body = { email: String(email ?? '').trim() };
    const mob = normalizeSignupMobileDigits(mobile);
    if (mob) body.mobile = mob;
    const cc = String(countryCode ?? '').replace(/\D/g, '');
    if (cc) body.country_code = cc;
    const ref = getStoredReferralCode();
    if (ref) body.referral_code = ref;
    const res = await authFetch(`${API}/api/auth/register/request`, {
      method: 'POST',
      body,
    });
    const data = await readJsonSafe(res);
    if (!res.ok) throwAuthFailure(res, data, 'Registration failed');
    return data;
  }, []);

  /** Send SMS OTP (mobile only). Optionally pass email to link the same signup session. */
  const registerMobileSendOtp = useCallback(async (mobile, email, countryCode) => {
    const body = { mobile: normalizeSignupMobileDigits(mobile) };
    const em = String(email ?? '').trim();
    if (em) body.email = em;
    const cc = String(countryCode ?? '').replace(/\D/g, '');
    if (cc) body.country_code = cc;
    const res = await authFetch(`${API}/api/auth/register/mobile/send-otp`, {
      method: 'POST',
      body,
    });
    const data = await readJsonSafe(res);
    if (!res.ok) throwAuthFailure(res, data, 'Could not send SMS code');
    return data;
  }, []);

  /** Verify email OTP (does not send SMS automatically). */
  const registerVerifyEmail = useCallback(async (email, code) => {
    const res = await authFetch(`${API}/api/auth/register/verify-email`, {
      method: 'POST',
      body: {
        email: String(email ?? '').trim(),
        code: String(code ?? '').trim(),
      },
    });
    const data = await readJsonSafe(res);
    if (!res.ok) throwAuthFailure(res, data, 'Email verification failed');
    return data;
  }, []);

  /** Verify mobile OTP only (marks phone verified; account created on /register/complete). */
  const registerVerifyMobile = useCallback(async (email, mobile, countryCode, code) => {
    const body = {
      mobile: normalizeSignupMobileDigits(mobile),
      code: String(code ?? '').trim(),
    };
    const em = String(email ?? '').trim();
    if (em) body.email = em;
    const cc = String(countryCode ?? '').replace(/\D/g, '');
    if (cc) body.country_code = cc;
    const res = await authFetch(`${API}/api/auth/register/verify-mobile`, {
      method: 'POST',
      body,
    });
    const data = await readJsonSafe(res);
    if (!res.ok) throwAuthFailure(res, data, 'Mobile verification failed');
    return data;
  }, []);

  /** Create account after email + mobile OTP verified. */
  const registerComplete = useCallback(async (name, email, password, mobile, countryCode) => {
    const body = {
      name: String(name ?? '').trim(),
      email: String(email ?? '').trim(),
      password: String(password ?? ''),
    };
    const mob = normalizeSignupMobileDigits(mobile);
    if (mob) body.mobile = mob;
    const cc = String(countryCode ?? '').replace(/\D/g, '');
    if (cc) body.country_code = cc;
    const ref = getStoredReferralCode();
    if (ref) body.referral_code = ref;
    const res = await authFetch(`${API}/api/auth/register/complete`, {
      method: 'POST',
      body,
    });
    const data = await readJsonSafe(res);
    if (!res.ok) throwAuthFailure(res, data, 'Could not create account');
    return applyTokenResponse(data);
  }, [applyTokenResponse]);

  /** Step 2: Submit OTP code → backend creates account and returns JWT tokens.
   *  Calls applyTokenResponse to log the user in. */
  const registerVerify = useCallback(async (email, code) => {
    const res = await authFetch(`${API}/api/auth/register/verify`, {
      method: 'POST',
      body: {
        email: String(email ?? '').trim(),
        code: String(code ?? '').trim(),
      },
    });
    const data = await readJsonSafe(res);
    if (!res.ok) throwAuthFailure(res, data, 'Verification failed');
    return applyTokenResponse(data);
  }, [applyTokenResponse]);

  /** Resend OTP to the same email (rate-limited server-side). */
  const registerResend = useCallback(async (email, channel) => {
    const body = { email: String(email ?? '').trim() };
    const ch = String(channel ?? '').trim().toLowerCase();
    if (ch) body.channel = ch;
    const res = await authFetch(`${API}/api/auth/register/resend`, {
      method: 'POST',
      body,
    });
    const data = await readJsonSafe(res);
    if (!res.ok) throwAuthFailure(res, data, 'Could not resend verification code');
    return data; // { message, email_hint }
  }, []);

  // ── Logout ────────────────────────────────────────────────────────────────
  const logout = useCallback(() => {
    // Fire-and-forget refresh-token revocation so the server drops the
    // rotated jti even if we never use it again. The response is ignored
    // — if it fails (offline / 401) the TTL index still reaps the row.
    const rt = store.getRefresh();
    const tok = store.getToken();
    if (rt && tok) {
      try {
        fetch(`${API}/api/auth/logout`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${tok}`,
          },
          body: JSON.stringify({ refresh_token: rt }),
          keepalive: true,
        }).catch(() => {});
      } catch { /* ignore */ }
    }
    clearAuthStorage();
    setUser(null);
    setWalletAssets([]); setBalance({}); setLockedBalance({});
    setOpenOrders([]); setOrderHistory([]);
    setUserTrades([]);
    setLiveSpotPositions(null);
    setKyc(null);
    setImpersonationActive(false);
    setImpersonatorAdminId(null);
    setUserFeaturesPaused(false);
    setUserTradingPaused(false);
    setUserWithdrawalsPaused(false);
    setUserPauseNote(null);
  }, []);

  // ── Phase 7b — revoke every other session ─────────────────────────────────
  const revokeAllSessions = useCallback(async () => {
    const res = await authFetch(`${API}/api/auth/sessions/revoke-all`, { method: 'POST' });
    const data = await readJsonSafe(res);
    if (!res.ok) {
      throw new Error(data?.detail || 'Could not revoke sessions');
    }
    // Our own session was also killed by the epoch bump; log out locally
    // and push the user to /login so they re-authenticate cleanly.
    clearAuthStorage();
    setUser(null);
    return data;
  }, []);

  const updateUser = useCallback((next) => {
    setUser((prev) => {
      const merged = typeof next === 'function' ? next(prev) : { ...prev, ...next };
      if (merged) store.setUser(merged);
      return merged;
    });
  }, []);

  return (
    <AuthContext.Provider value={{
      user, authLoading, updateUser,
      // Wallet
      walletAssets, balance, lockedBalance, walletLoading, fetchWallet,
      // Orders & fills (read-only — mutations via API; live updates via /ws/exchange/account)
      openOrders, orderHistory, ordersLoading, fetchOrders, upsertOpenOrder,
      userTrades, userTradesLoading, fetchUserTrades,
      liveSpotPositions, fetchLiveSpotPositions,
      // Phase 2 — wallet ledger fetcher (paged, filterable)
      fetchWalletTransactions,
      // KYC
      kyc, fetchKyc,
      // Auth
      login, loginOAuth, register, registerRequest, registerMobileSendOtp, registerVerifyEmail,
      registerVerifyMobile, registerComplete, registerVerify, registerResend, logout,
      revokeAllSessions,
      impersonationActive, impersonatorAdminId, refreshSession,
      userFeaturesPaused, userTradingPaused, userWithdrawalsPaused, userPauseNote,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext) ?? {};
