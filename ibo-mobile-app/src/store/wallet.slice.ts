import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { walletApi } from '../api/wallet.api';
import { WalletAsset, WalletTransaction } from '../types/wallet.types';
import type { RootState } from './index';
import {
  bootstrapAuth,
  loginThunk,
  logoutThunk,
  registerCompleteThunk,
  registerThunk,
  verifyRegisterThunk,
} from './auth.slice';

interface WalletState {
  assets: WalletAsset[];
  totalUsd: string | number;
  transactions: WalletTransaction[];
  loading: boolean;
  txnsLoading: boolean;
  /** UID the loaded balances belong to — guards against stale cross-account responses. */
  expectedUid: string | null;
}

const initialState: WalletState = {
  assets: [],
  totalUsd: '0',
  transactions: [],
  loading: false,
  txnsLoading: false,
  expectedUid: null,
};

function resetWalletState(): WalletState {
  return { ...initialState };
}

export const fetchWalletThunk = createAsyncThunk('wallet/fetch', async (_, { getState, rejectWithValue }) => {
  const uid = (getState() as RootState).auth.user?.uid;
  if (!uid) return rejectWithValue('not_authenticated');
  const res = await walletApi.getBalances();
  return { rawWallet: res.data, forUid: uid };
});

export const fetchTransactionsThunk = createAsyncThunk(
  'wallet/fetchTransactions',
  async (params?: { asset?: string; page?: number }) => {
    const page = await walletApi.getTransactionsPage(params);
    return page.items;
  },
);

/** Transform WS wallet items {asset, available, locked} → mobile WalletAsset shape */
function transformWsWallet(rawWallet: Array<Record<string, any>>): WalletAsset[] {
  return rawWallet.map((w) => ({
    asset: w.asset,
    name: w.name ?? w.asset,
    balance: (Number(w.available ?? 0) + Number(w.locked ?? 0)).toString(),
    available_balance: String(w.available ?? 0),
    locked_balance: String(w.locked ?? 0),
    usd_value: w.usd_value,
  }));
}

const walletSlice = createSlice({
  name: 'wallet',
  initialState,
  reducers: {
    /**
     * Dispatch from WS exchange/account message.
     * Backend sends wallet as rawWallet: { asset, available, locked }[]
     */
    updateWalletFromWs(
      state,
      action: PayloadAction<{ rawWallet?: Array<Record<string, any>>; total_usd?: string | number }>,
    ) {
      if (!state.expectedUid) return;
      if (action.payload.rawWallet) {
        state.assets = transformWsWallet(action.payload.rawWallet);
      }
      if (action.payload.total_usd !== undefined) state.totalUsd = action.payload.total_usd;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(logoutThunk.pending, () => resetWalletState())
      .addCase(loginThunk.pending, () => resetWalletState())
      .addCase(registerThunk.pending, () => resetWalletState())
      .addCase(registerCompleteThunk.pending, () => resetWalletState())
      .addCase(verifyRegisterThunk.pending, () => resetWalletState())
      .addCase(bootstrapAuth.fulfilled, (state, action) => {
        if (action.payload?.user?.uid) state.expectedUid = action.payload.user.uid;
      })
      .addCase(loginThunk.fulfilled, (state, action) => {
        state.expectedUid = action.payload.user.uid;
      })
      .addCase(registerThunk.fulfilled, (state, action) => {
        state.expectedUid = action.payload.user.uid;
      })
      .addCase(registerCompleteThunk.fulfilled, (state, action) => {
        state.expectedUid = action.payload.user.uid;
      })
      .addCase(verifyRegisterThunk.fulfilled, (state, action) => {
        state.expectedUid = action.payload.user.uid;
      })
      .addCase(fetchWalletThunk.pending, (state) => { state.loading = true; })
      .addCase(fetchWalletThunk.fulfilled, (state, action) => {
        state.loading = false;
        if (state.expectedUid && action.payload.forUid !== state.expectedUid) return;
        state.expectedUid = action.payload.forUid;
        const raw = action.payload.rawWallet;
        if (Array.isArray(raw)) {
          state.assets = transformWsWallet(raw as Array<Record<string, any>>);
          const total = raw.reduce((acc: number, w: any) => {
            const usd = Number(w.usd_value ?? 0);
            if (usd > 0) return acc + usd;
            const avail = Number(w.available ?? 0);
            const locked = Number(w.locked ?? 0);
            const asset = String(w.asset ?? '').toUpperCase();
            if (asset === 'USDT') return acc + avail + locked;
            return acc;
          }, 0);
          if (total > 0) state.totalUsd = total;
        } else if (raw && typeof raw === 'object') {
          // Some backends return { assets: [], total_usd: 0 }
          const obj = raw as any;
          if (Array.isArray(obj.assets)) state.assets = transformWsWallet(obj.assets);
          if (obj.total_usd !== undefined) state.totalUsd = obj.total_usd;
        }
      })
      .addCase(fetchWalletThunk.rejected, (state) => { state.loading = false; })
      .addCase(fetchTransactionsThunk.pending, (state) => { state.txnsLoading = true; })
      .addCase(fetchTransactionsThunk.fulfilled, (state, action) => {
        state.txnsLoading = false;
        state.transactions = action.payload ?? [];
      })
      .addCase(fetchTransactionsThunk.rejected, (state) => { state.txnsLoading = false; });
  },
});

/** Only expose wallet balances when they belong to the signed-in user. */
export function selectSessionWallet(state: RootState): Pick<WalletState, 'assets' | 'totalUsd' | 'loading'> {
  const uid = state.auth.user?.uid;
  const w = state.wallet;
  const ok = !!uid && w.expectedUid === uid;
  return {
    assets: ok ? w.assets : [],
    totalUsd: ok ? w.totalUsd : '0',
    loading: w.loading,
  };
}

export const { updateWalletFromWs } = walletSlice.actions;
export default walletSlice.reducer;
