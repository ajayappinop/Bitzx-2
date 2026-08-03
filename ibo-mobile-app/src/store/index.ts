import { configureStore } from '@reduxjs/toolkit';
import authReducer from './auth.slice';
import marketReducer from './market.slice';
import walletReducer from './wallet.slice';
import tradingReducer from './trading.slice';
import uiReducer from './ui.slice';

export const store = configureStore({
  reducer: {
    auth: authReducer,
    market: marketReducer,
    wallet: walletReducer,
    trading: tradingReducer,
    ui: uiReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({ serializableCheck: false }),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
