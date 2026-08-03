import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { tradingApi } from '../api/trading.api';
import { Order, Trade, SpotPosition } from '../types/trading.types';
import { parseApiError } from '../api/errors';
import type { RootState } from './index';
import {
  bootstrapAuth,
  loginThunk,
  logoutThunk,
  registerCompleteThunk,
  registerThunk,
  verifyRegisterThunk,
} from './auth.slice';

interface TradingState {
  openOrders: Order[];
  orderHistory: Order[];
  trades: Trade[];
  livePositions: SpotPosition[];
  ordersLoading: boolean;
  placingOrder: boolean;
  orderError: string | null;
  expectedUid: string | null;
}

const initialState: TradingState = {
  openOrders: [],
  orderHistory: [],
  trades: [],
  livePositions: [],
  ordersLoading: false,
  placingOrder: false,
  orderError: null,
  expectedUid: null,
};

function resetTradingState(): TradingState {
  return { ...initialState };
}

export const fetchOrdersThunk = createAsyncThunk('trading/fetchOrders', async (symbol: string | undefined, { getState, rejectWithValue }) => {
  const uid = (getState() as RootState).auth.user?.uid;
  if (!uid) return rejectWithValue('not_authenticated');
  const [openRes, historyRes, tradesRes, posRes] = await Promise.all([
    tradingApi.getOpenOrders(symbol),
    tradingApi.getOrderHistory({ symbol }),
    tradingApi.getTrades({ symbol }),
    tradingApi.getPositions(),
  ]);
  return {
    forUid: uid,
    openOrders: openRes.data ?? [],
    history: historyRes.data ?? [],
    trades: tradesRes.data ?? [],
    positions: posRes.data ?? [],
  };
});

export const cancelOrderThunk = createAsyncThunk(
  'trading/cancelOrder',
  async (orderId: string, { rejectWithValue }) => {
    try {
      await tradingApi.cancelOrder(orderId);
      return orderId;
    } catch (err) {
      return rejectWithValue(parseApiError(err).message);
    }
  },
);

const tradingSlice = createSlice({
  name: 'trading',
  initialState,
  reducers: {
    /**
     * Dispatch from WS exchange/account message.
     * Backend field names: open_orders, order_history, user_trades, positions
     */
    updateOrdersFromWs(
      state,
      action: PayloadAction<{
        open_orders?: Order[];
        order_history?: Order[];
        user_trades?: Trade[];
        positions?: SpotPosition[];
      }>,
    ) {
      if (!state.expectedUid) return;
      const { open_orders, order_history, user_trades, positions } = action.payload;
      if (open_orders) state.openOrders = open_orders;
      if (order_history) state.orderHistory = order_history;
      if (user_trades) state.trades = user_trades;
      if (positions) state.livePositions = positions;
    },
    setPlacingOrder(state, action: PayloadAction<boolean>) {
      state.placingOrder = action.payload;
    },
    setOrderError(state, action: PayloadAction<string | null>) {
      state.orderError = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(logoutThunk.pending, () => resetTradingState())
      .addCase(loginThunk.pending, () => resetTradingState())
      .addCase(registerThunk.pending, () => resetTradingState())
      .addCase(registerCompleteThunk.pending, () => resetTradingState())
      .addCase(verifyRegisterThunk.pending, () => resetTradingState())
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
      .addCase(fetchOrdersThunk.pending, (state) => { state.ordersLoading = true; })
      .addCase(fetchOrdersThunk.fulfilled, (state, action) => {
        state.ordersLoading = false;
        if (state.expectedUid && action.payload.forUid !== state.expectedUid) return;
        state.expectedUid = action.payload.forUid;
        state.openOrders = action.payload.openOrders;
        state.orderHistory = action.payload.history;
        state.trades = action.payload.trades;
        state.livePositions = action.payload.positions;
      })
      .addCase(fetchOrdersThunk.rejected, (state) => { state.ordersLoading = false; })
      .addCase(cancelOrderThunk.fulfilled, (state, action) => {
        state.openOrders = state.openOrders.filter((o) => o.order_id !== action.payload);
      });
  },
});

export function selectSessionTrading(state: RootState): Pick<
  TradingState,
  'openOrders' | 'livePositions' | 'ordersLoading' | 'orderHistory' | 'trades'
> {
  const uid = state.auth.user?.uid;
  const t = state.trading;
  const ok = !!uid && t.expectedUid === uid;
  return {
    openOrders: ok ? t.openOrders : [],
    livePositions: ok ? t.livePositions : [],
    orderHistory: ok ? t.orderHistory : [],
    trades: ok ? t.trades : [],
    ordersLoading: t.ordersLoading,
  };
}

export const { updateOrdersFromWs, setPlacingOrder, setOrderError } = tradingSlice.actions;
export default tradingSlice.reducer;
