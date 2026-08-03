import { useEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { AppDispatch, RootState } from '../store';
import { updateWalletFromWs } from '../store/wallet.slice';
import { updateOrdersFromWs } from '../store/trading.slice';
import { updateUserFromWs } from '../store/auth.slice';
import { fetchWalletThunk } from '../store/wallet.slice';
import { fetchOrdersThunk } from '../store/trading.slice';
import wsManager from '../services/websocket.service';
import { exchangeWsPath } from '../config/wsConfig';
import StorageService from '../services/storage.service';
import { STORAGE_KEYS } from '../config/storageKeys';

/**
 * Authenticated account WebSocket + REST bootstrap per user session.
 * Live updates: wallet, orders, positions (no polling).
 */
export function useAccountWs() {
  const dispatch = useDispatch<AppDispatch>();
  const uid = useSelector((s: RootState) => s.auth.user?.uid);
  const bootedUidRef = useRef<string | null>(null);

  useEffect(() => {
    if (!uid) {
      bootedUidRef.current = null;
      wsManager.disconnect('exchange_account');
      return undefined;
    }

    let cancelled = false;
    let unsub: (() => void) | undefined;

    void (async () => {
      const token = await StorageService.get(STORAGE_KEYS.TOKEN);
      if (!token || cancelled) return;

      if (bootedUidRef.current !== uid) {
        bootedUidRef.current = uid;
        void dispatch(fetchWalletThunk());
        void dispatch(fetchOrdersThunk(undefined));
      }

      const url = exchangeWsPath(`/api/ws/exchange/account?token=${encodeURIComponent(token)}`);
      unsub = wsManager.subscribe('exchange_account', url, (data: unknown) => {
        const msg = data as Record<string, unknown>;
        if (msg.type !== 'exchange_account') return;

        if (Array.isArray(msg.wallet)) {
          dispatch(updateWalletFromWs({ rawWallet: msg.wallet as Record<string, unknown>[] }));
        }

        if (msg.open_orders || msg.order_history || msg.user_trades || msg.positions) {
          dispatch(updateOrdersFromWs({
            open_orders: Array.isArray(msg.open_orders) ? (msg.open_orders as never[]) : undefined,
            order_history: Array.isArray(msg.order_history) ? (msg.order_history as never[]) : undefined,
            user_trades: Array.isArray(msg.user_trades) ? (msg.user_trades as never[]) : undefined,
            positions: Array.isArray(msg.positions) ? (msg.positions as never[]) : undefined,
          }));
        }

        if (msg.user) {
          dispatch(updateUserFromWs(msg.user as never));
        }
      });
    })();

    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [uid, dispatch]);
}
