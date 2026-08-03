import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { marketApi, normalizeMarket, marketStoreKey } from '../api/market.api';
import { MarketRow, Kline } from '../types/market.types';

interface MarketState {
  markets: Record<string, MarketRow>;
  marketList: string[];
  klines: Record<string, Kline[]>;
  loading: boolean;
}

const initialState: MarketState = {
  markets: {},
  marketList: [],
  klines: {},
  loading: false,
};

/** Fast path — majors + futures/options catalogs (no IBO pagination). */
export const fetchMarketsLiteThunk = createAsyncThunk('market/fetchLite', async () => {
  return marketApi.getMarketsLite();
});

/** Full IBO Web3 catalog — Markets screen / pair picker only. */
export const fetchMarketsThunk = createAsyncThunk('market/fetchAll', async () => {
  return marketApi.getAllMarkets();
});

export const fetchKlinesThunk = createAsyncThunk(
  'market/fetchKlines',
  async ({ symbol, interval }: { symbol: string; interval?: string }) => {
    const { data } = await marketApi.getKlines(symbol, { interval, limit: 200 });
    return { symbol, klines: data };
  },
);

const marketSlice = createSlice({
  name: 'market',
  initialState,
  reducers: {
    // Dispatch from WS exchange/markets message — type === 'exchange_markets'
    // Normalizes Binance-style field names (price, priceChangePercent) to mobile MarketRow format
    updateMarketsFromWs(state, action: PayloadAction<{ markets?: any[] }>) {
      const list = action.payload.markets ?? [];
      list.forEach((raw) => {
        const m = normalizeMarket({ ...raw, market_type: raw.market_type ?? 'spot' });
        const key = marketStoreKey(m);
        const prev = state.markets[key];
        state.markets[key] = {
          ...prev,
          ...m,
          // Preserve richer metadata from REST/catalog when WS ticks omit it.
          logo_url: m.logo_url ?? prev?.logo_url,
          base_asset: m.base_asset ?? prev?.base_asset,
          quote_asset: m.quote_asset ?? prev?.quote_asset,
        };
        if (!state.marketList.includes(key)) {
          state.marketList.push(key);
        }
      });
    },
    updateSingleMarket(state, action: PayloadAction<MarketRow>) {
      const m = action.payload;
      const key = marketStoreKey(m);
      state.markets[key] = m;
      if (!state.marketList.includes(key)) {
        state.marketList.push(key);
      }
    },
  },
  extraReducers: (builder) => {
    const applyMarketRows = (state: MarketState, rows: MarketRow[]) => {
      (rows ?? []).forEach((m: MarketRow) => {
        const key = marketStoreKey(m);
        state.markets[key] = m;
        if (!state.marketList.includes(key)) {
          state.marketList.push(key);
        }
      });
    };

    builder
      .addCase(fetchMarketsLiteThunk.pending, (state) => { state.loading = true; })
      .addCase(fetchMarketsLiteThunk.fulfilled, (state, action) => {
        state.loading = false;
        applyMarketRows(state, action.payload ?? []);
      })
      .addCase(fetchMarketsLiteThunk.rejected, (state) => { state.loading = false; })
      .addCase(fetchMarketsThunk.pending, (state) => { state.loading = true; })
      .addCase(fetchMarketsThunk.fulfilled, (state, action) => {
        state.loading = false;
        applyMarketRows(state, action.payload ?? []);
      })
      .addCase(fetchMarketsThunk.rejected, (state) => { state.loading = false; })
      .addCase(fetchKlinesThunk.fulfilled, (state, action) => {
        state.klines[action.payload.symbol] = action.payload.klines;
      });
  },
});

export const { updateMarketsFromWs, updateSingleMarket } = marketSlice.actions;
export default marketSlice.reducer;
