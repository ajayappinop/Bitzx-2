import { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { AppDispatch, RootState } from '../store';
import { fetchMarketsLiteThunk, updateMarketsFromWs } from '../store/market.slice';
import wsManager from '../services/websocket.service';
import { exchangeWsPath } from '../config/wsConfig';

/**
 * Exchange markets WS + REST seed (mirrors web landing / session bootstrap).
 * Keeps Redux market rows warm so Trade/Dashboard show prices before first WS tick.
 */
export function useMarketData() {
  const dispatch = useDispatch<AppDispatch>();
  const hasMarkets = useSelector((s: RootState) => s.market.marketList.length > 0);

  useEffect(() => {
    if (!hasMarkets) {
      void dispatch(fetchMarketsLiteThunk());
    }
  }, [dispatch, hasMarkets]);

  useEffect(() => {
    const url = exchangeWsPath('/api/ws/exchange/markets');
    const unsub = wsManager.subscribe('exchange_markets', url, (data: unknown) => {
      const msg = data as { type?: string; markets?: unknown[] };
      if (msg.type === 'exchange_markets') {
        dispatch(updateMarketsFromWs(msg as { markets?: unknown[] }));
      }
    });
    return unsub;
  }, [dispatch]);
}
