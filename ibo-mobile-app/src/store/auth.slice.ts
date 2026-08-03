import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { authApi, LoginPayload, RegisterPayload } from '../api/auth.api';
import StorageService from '../services/storage.service';
import { STORAGE_KEYS } from '../config/storageKeys';
import { User, KYCInfo, SessionInfo } from '../types/auth.types';
import { parseApiError } from '../api/errors';
import { normalizeKycPayload } from '../utils/kycGate';
import { normalizeKycMode, type KycMode } from '../utils/kycNavigation';
import { kycApi } from '../api/kyc.api';
import { invalidateFuturesWalletCache } from '../api/futures.api';
import { API_URL } from '../config/env';

interface AuthState {
  user: User | null;
  kyc: KYCInfo | null;
  kycMode: KycMode | null;
  kycModeLoading: boolean;
  session: SessionInfo | null;
  authLoading: boolean;
  loginLoading: boolean;
  error: string | null;
  /** Set to true when a new account is created so the app can navigate to Wallet → History. */
  justRegistered: boolean;
}

const initialState: AuthState = {
  user: null,
  kyc: null,
  kycMode: null,
  kycModeLoading: false,
  session: null,
  authLoading: true,
  loginLoading: false,
  error: null,
  justRegistered: false,
};

function absolutizeUrl(pathOrUrl?: string): string | undefined {
  const raw = (pathOrUrl || '').trim();
  if (!raw) return undefined;
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
  const rel = raw.startsWith('/') ? raw : `/${raw}`;
  return `${API_URL}${rel}`;
}

function normalizeUserPayload(user: User): User {
  return {
    ...user,
    avatar_url: absolutizeUrl(user.avatar_url),
  };
}

// ── Thunks ────────────────────────────────────────────────────────────────

export const bootstrapAuth = createAsyncThunk('auth/bootstrap', async (_, { rejectWithValue }) => {
  const token = await StorageService.get(STORAGE_KEYS.TOKEN);
  if (!token) return null;
  try {
    const [meRes, kycRes, modeRes] = await Promise.all([
      authApi.me(),
      authApi.getKycStatus().catch(() => null),
      kycApi.getMode().catch(() => null),
    ]);
    await StorageService.setJSON(STORAGE_KEYS.USER, normalizeUserPayload(meRes.data));
    return {
      user: meRes.data,
      kyc: kycRes?.data ?? null,
      kycMode: normalizeKycMode(modeRes?.data?.kyc_mode),
    };
  } catch {
    await StorageService.clearAll();
    return null;
  }
});

export const loginThunk = createAsyncThunk(
  'auth/login',
  async (payload: LoginPayload, { rejectWithValue }) => {
    try {
      invalidateFuturesWalletCache();
      const { data } = await authApi.login(payload);
      await StorageService.set(STORAGE_KEYS.TOKEN, data.access_token);
      await StorageService.set(STORAGE_KEYS.REFRESH, data.refresh_token);
      await StorageService.setJSON(STORAGE_KEYS.USER, normalizeUserPayload(data.user));
      const [kycRes, modeRes] = await Promise.all([
        authApi.getKycStatus().catch(() => null),
        kycApi.getMode().catch(() => null),
      ]);
      return {
        ...data,
        kyc: kycRes?.data ?? null,
        kycMode: normalizeKycMode(modeRes?.data?.kyc_mode),
      };
    } catch (err) {
      return rejectWithValue(parseApiError(err).message);
    }
  },
);

export const verifyRegisterEmailThunk = createAsyncThunk(
  'auth/verifyRegisterEmail',
  async ({ email, code }: { email: string; code: string }, { rejectWithValue }) => {
    try {
      const { data } = await authApi.verifyRegisterEmail(email, code);
      return data;
    } catch (err) {
      return rejectWithValue(parseApiError(err).message);
    }
  },
);

export const verifyRegisterMobileThunk = createAsyncThunk(
  'auth/verifyRegisterMobile',
  async (
    payload: { email?: string; mobile: string; country_code?: string; code: string },
    { rejectWithValue },
  ) => {
    try {
      const { data } = await authApi.verifyRegisterMobile(payload);
      return data;
    } catch (err) {
      return rejectWithValue(parseApiError(err).message);
    }
  },
);

export const registerCompleteThunk = createAsyncThunk(
  'auth/registerComplete',
  async (
    payload: {
      name: string;
      email: string;
      password: string;
      mobile: string;
      country_code?: string;
      referral_code?: string;
    },
    { rejectWithValue },
  ) => {
    try {
      const { data } = await authApi.completeRegister(payload);
      await StorageService.set(STORAGE_KEYS.TOKEN, data.access_token);
      await StorageService.set(STORAGE_KEYS.REFRESH, data.refresh_token);
      await StorageService.setJSON(STORAGE_KEYS.USER, normalizeUserPayload(data.user));
      const [kycRes, modeRes] = await Promise.all([
        authApi.getKycStatus().catch(() => null),
        kycApi.getMode().catch(() => null),
      ]);
      return {
        ...data,
        kyc: kycRes?.data ?? null,
        kycMode: normalizeKycMode(modeRes?.data?.kyc_mode),
      };
    } catch (err) {
      return rejectWithValue(parseApiError(err).message);
    }
  },
);

/** Legacy single-step verify */
export const verifyRegisterThunk = createAsyncThunk(
  'auth/verifyRegister',
  async ({ email, code }: { email: string; code: string }, { rejectWithValue }) => {
    try {
      const { data } = await authApi.verifyRegisterOtp(email, code);
      await StorageService.set(STORAGE_KEYS.TOKEN, data.access_token);
      await StorageService.set(STORAGE_KEYS.REFRESH, data.refresh_token);
      await StorageService.setJSON(STORAGE_KEYS.USER, normalizeUserPayload(data.user));
      const [kycRes, modeRes] = await Promise.all([
        authApi.getKycStatus().catch(() => null),
        kycApi.getMode().catch(() => null),
      ]);
      return {
        ...data,
        kyc: kycRes?.data ?? null,
        kycMode: normalizeKycMode(modeRes?.data?.kyc_mode),
      };
    } catch (err) {
      return rejectWithValue(parseApiError(err).message);
    }
  },
);

export const registerThunk = createAsyncThunk(
  'auth/register',
  async (payload: RegisterPayload, { rejectWithValue }) => {
    try {
      const { data } = await authApi.register(payload);
      await StorageService.set(STORAGE_KEYS.TOKEN, data.access_token);
      await StorageService.set(STORAGE_KEYS.REFRESH, data.refresh_token);
      await StorageService.setJSON(STORAGE_KEYS.USER, normalizeUserPayload(data.user));
      const [kycRes, modeRes] = await Promise.all([
        authApi.getKycStatus().catch(() => null),
        kycApi.getMode().catch(() => null),
      ]);
      return {
        ...data,
        kyc: kycRes?.data ?? null,
        kycMode: normalizeKycMode(modeRes?.data?.kyc_mode),
      };
    } catch (err) {
      return rejectWithValue(parseApiError(err).message);
    }
  },
);

export const logoutThunk = createAsyncThunk('auth/logout', async () => {
  invalidateFuturesWalletCache();
  const refresh = await StorageService.get(STORAGE_KEYS.REFRESH);
  try { await authApi.logout(refresh ?? undefined); } catch { /* silent */ }
  await StorageService.clearAll();
});

export const fetchKycThunk = createAsyncThunk('auth/fetchKyc', async () => {
  const [statusRes, modeRes] = await Promise.all([
    authApi.getKycStatus(),
    kycApi.getMode().catch(() => ({ data: { kyc_mode: 'manual' as const } })),
  ]);
  return {
    status: statusRes.data,
    kycMode: normalizeKycMode(modeRes.data?.kyc_mode),
  };
});

// ── Slice ─────────────────────────────────────────────────────────────────

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setUser(state, action: PayloadAction<User>) {
      state.user = normalizeUserPayload(action.payload);
    },
    clearAuth(state) {
      state.user = null;
      state.kyc = null;
      state.kycMode = null;
      state.kycModeLoading = false;
      state.session = null;
      state.error = null;
    },
    setKyc(state, action: PayloadAction<KYCInfo>) {
      state.kyc = action.payload;
    },
    setSession(state, action: PayloadAction<SessionInfo>) {
      state.session = action.payload;
    },
    clearError(state) {
      state.error = null;
    },
    clearJustRegistered(state) {
      state.justRegistered = false;
    },
    // Called from WS account messages
    updateUserFromWs(state, action: PayloadAction<Partial<User>>) {
      if (state.user) {
        const next = { ...state.user, ...action.payload } as User;
        state.user = normalizeUserPayload(next);
      }
    },
  },
  extraReducers: (builder) => {
    builder
      // bootstrap
      .addCase(bootstrapAuth.pending, (state) => { state.authLoading = true; })
      .addCase(bootstrapAuth.fulfilled, (state, action) => {
        state.authLoading = false;
        if (action.payload) {
          state.user = normalizeUserPayload(action.payload.user);
          state.kyc = action.payload.kyc ? normalizeKycPayload(action.payload.kyc) : null;
          state.kycMode = action.payload.kycMode;
        }
      })
      .addCase(bootstrapAuth.rejected, (state) => { state.authLoading = false; })
      // login
      .addCase(loginThunk.pending, (state) => {
        state.loginLoading = true;
        state.error = null;
        state.kyc = null;
        state.kycMode = null;
        state.kycModeLoading = false;
      })
      .addCase(loginThunk.fulfilled, (state, action) => {
        state.loginLoading = false;
        state.user = normalizeUserPayload(action.payload.user);
        state.kyc = action.payload.kyc ? normalizeKycPayload(action.payload.kyc) : null;
        state.kycMode = action.payload.kycMode ?? null;
      })
      .addCase(loginThunk.rejected, (state, action) => {
        state.loginLoading = false;
        state.error = action.payload as string;
      })
      // register
      .addCase(registerThunk.pending, (state) => {
        state.loginLoading = true;
        state.error = null;
        state.kyc = null;
        state.kycMode = null;
        state.kycModeLoading = false;
      })
      .addCase(registerThunk.fulfilled, (state, action) => {
        state.loginLoading = false;
        state.user = normalizeUserPayload(action.payload.user);
        state.kyc = action.payload.kyc ? normalizeKycPayload(action.payload.kyc) : null;
        state.kycMode = action.payload.kycMode ?? null;
      })
      .addCase(registerThunk.rejected, (state, action) => {
        state.loginLoading = false;
        state.error = action.payload as string;
      })
      // verify register mobile (marks phone verified only)
      .addCase(verifyRegisterMobileThunk.pending, (state) => { state.loginLoading = true; state.error = null; })
      .addCase(verifyRegisterMobileThunk.fulfilled, (state) => {
        state.loginLoading = false;
      })
      .addCase(verifyRegisterMobileThunk.rejected, (state, action) => {
        state.loginLoading = false;
        state.error = action.payload as string;
      })
      // register complete (creates account + JWT)
      .addCase(registerCompleteThunk.pending, (state) => {
        state.loginLoading = true;
        state.error = null;
        state.kyc = null;
        state.kycMode = null;
        state.kycModeLoading = false;
      })
      .addCase(registerCompleteThunk.fulfilled, (state, action) => {
        state.loginLoading = false;
        state.user = normalizeUserPayload(action.payload.user);
        state.kyc = action.payload.kyc ? normalizeKycPayload(action.payload.kyc) : null;
        state.kycMode = action.payload.kycMode ?? null;
        state.justRegistered = true;
      })
      .addCase(registerCompleteThunk.rejected, (state, action) => {
        state.loginLoading = false;
        state.error = action.payload as string;
      })
      // legacy verify register
      .addCase(verifyRegisterThunk.pending, (state) => {
        state.loginLoading = true;
        state.error = null;
        state.kyc = null;
        state.kycMode = null;
        state.kycModeLoading = false;
      })
      .addCase(verifyRegisterThunk.fulfilled, (state, action) => {
        state.loginLoading = false;
        state.justRegistered = true;
        state.user = normalizeUserPayload(action.payload.user);
        state.kyc = action.payload.kyc ? normalizeKycPayload(action.payload.kyc) : null;
        state.kycMode = action.payload.kycMode ?? null;
      })
      .addCase(verifyRegisterThunk.rejected, (state, action) => {
        state.loginLoading = false;
        state.error = action.payload as string;
      })
      // logout
      .addCase(logoutThunk.fulfilled, (state) => {
        state.user = null;
        state.kyc = null;
        state.kycMode = null;
        state.kycModeLoading = false;
        state.session = null;
      })
      // kyc
      .addCase(fetchKycThunk.pending, (state) => {
        state.kycModeLoading = true;
      })
      .addCase(fetchKycThunk.fulfilled, (state, action) => {
        state.kyc = normalizeKycPayload(action.payload.status);
        state.kycMode = action.payload.kycMode;
        state.kycModeLoading = false;
      })
      .addCase(fetchKycThunk.rejected, (state) => {
        state.kycModeLoading = false;
      });
  },
});

export const {
  setUser, clearAuth, setKyc, setSession, clearError, updateUserFromWs, clearJustRegistered,
} = authSlice.actions;
export default authSlice.reducer;
