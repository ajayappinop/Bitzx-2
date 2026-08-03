import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { futuresApi } from '../api/futures.api';
import { marketApi } from '../api/market.api';
import { futuresWsUrl } from '../config/wsConfig';
import { wsService } from '../services/websocket.service';
import StorageService from '../services/storage.service';
import { STORAGE_KEYS } from '../config/storageKeys';
import { toFuturesSymbol, toSpotSymbol } from '../utils/tradeSymbols';
import {
  bookBestSides,
  extractFuturesMarkPayload,
  extractSpotTicker,
  lastTradePrice,
  normalizeFuturesBook,
} from '../utils/futuresQuotes';

export type FuturesQuotes = {
  dispMark: number;
  dispIndex: number;
  dispBid: number;
  dispAsk: number;
  dispLast: number;
  dispSpread: number;
};

function mergeMarkTick(prev: Record<string, unknown>, incoming: Record<string, unknown>) {
  const out: Record<string, unknown> = { ...prev, ...incoming, symbol: incoming.symbol || prev.symbol };
  const pi = Number(prev.index_price);
  const pm = Number(prev.mark_price);
  const ii = Number(incoming.index_price);
  const im = Number(incoming.mark_price);
  out.index_price = ii > 0 ? ii : (pi > 0 ? pi : incoming.index_price);
  out.mark_price = im > 0 ? im : (pm > 0 ? pm : incoming.mark_price);
  return out;
}

export function useFuturesMarketFeed(rawSymbol: string) {
  const symbol = useMemo(() => toFuturesSymbol(rawSymbol), [rawSymbol]);
  const spotSym = useMemo(() => toSpotSymbol(symbol), [symbol]);

  const [markPrice, setMarkPrice] = useState(0);
  const [indexPrice, setIndexPrice] = useState(0);
  const [fundingRate, setFundingRate] = useState<number | null>(null);
  const [recentTrades, setRecentTrades] = useState<unknown[]>([]);
  const [spotRefPrice, setSpotRefPrice] = useState(0);
  const [spotChangePct, setSpotChangePct] = useState<number | null>(null);
  const [isActive, setIsActive] = useState(false);
  const bookRef = useRef(normalizeFuturesBook({ bids: [], asks: [] }));

  const quotes = useMemo<FuturesQuotes>(() => {
    const { bid, ask } = bookBestSides(bookRef.current);
    const last = lastTradePrice(recentTrades);
    const spread = bid > 0 && ask > 0 ? Math.max(0, ask - bid) : 0;
    return {
      dispMark: markPrice,
      dispIndex: indexPrice,
      dispBid: bid,
      dispAsk: ask,
      dispLast: last,
      dispSpread: spread,
    };
  }, [markPrice, indexPrice, recentTrades]);

  const refresh = useCallback(async () => {
    try {
      const [markRes, spotRes, frRes, trRes, obRes] = await Promise.allSettled([
        futuresApi.getMarkPrice(symbol),
        marketApi.getTicker(spotSym),
        futuresApi.getFundingRate(symbol),
        futuresApi.getMarketTrades(symbol, 30),
        futuresApi.getOrderBook(symbol, 25),
      ]);
      if (markRes.status === 'fulfilled') {
        const { mark, index, funding } = extractFuturesMarkPayload(markRes.value.data);
        if (mark > 0) setMarkPrice(mark);
        if (index > 0) setIndexPrice(index);
        if (funding != null) setFundingRate(funding);
      }
      if (spotRes.status === 'fulfilled') {
        const spot = extractSpotTicker(spotRes.value.data);
        if (spot.price > 0) setSpotRefPrice(spot.price);
        setSpotChangePct(spot.changePct);
      }
      if (frRes.status === 'fulfilled') {
        const fr = (frRes.value.data as Record<string, unknown>)?.funding_rate
          ?? (frRes.value.data as Record<string, unknown>)?.rate;
        if (fr != null) setFundingRate(Number(fr));
      }
      if (trRes.status === 'fulfilled') {
        const rows = Array.isArray(trRes.value.data) ? trRes.value.data : [];
        setRecentTrades(rows);
      }
      if (obRes.status === 'fulfilled') {
        bookRef.current = normalizeFuturesBook(obRes.value.data);
      }
    } catch {
      /* keep WS values */
    }
  }, [symbol, spotSym]);

  useEffect(() => {
    setMarkPrice(0);
    setIndexPrice(0);
    setFundingRate(null);
    setRecentTrades([]);
    setSpotRefPrice(0);
    setSpotChangePct(null);
    bookRef.current = normalizeFuturesBook({ bids: [], asks: [] });
    void refresh();
  }, [symbol, spotSym, refresh]);

  useEffect(() => {
    let dead = false;
    let accUrl: string | null = null;
    const marketsUrl = futuresWsUrl('/api/ws/futures/markets');
    const bookUrl = futuresWsUrl(`/api/ws/futures/orderbook?symbol=${encodeURIComponent(symbol)}`);

    wsService.subscribe(marketsUrl, (msg: unknown) => {
      const m = msg as Record<string, unknown>;
      if (m.type === 'mark' && String(m.symbol) === symbol) {
        const { mark, index, funding } = extractFuturesMarkPayload(m);
        if (mark > 0) setMarkPrice(mark);
        if (index > 0) setIndexPrice(index);
        if (funding != null) setFundingRate(funding);
        setIsActive(true);
      } else if (m.type === 'snapshot' && m.markets && typeof m.markets === 'object') {
        const row = (m.markets as Record<string, Record<string, unknown>>)[symbol];
        if (row) {
          const merged = mergeMarkTick({}, row);
          const { mark, index, funding } = extractFuturesMarkPayload(merged);
          if (mark > 0) setMarkPrice(mark);
          if (index > 0) setIndexPrice(index);
          if (funding != null) setFundingRate(funding);
          setIsActive(true);
        }
      }
    });

    wsService.subscribe(bookUrl, (msg: unknown) => {
      const m = msg as Record<string, unknown>;
      if (m.orderbook) bookRef.current = normalizeFuturesBook(m.orderbook);
      if (Array.isArray(m.trades)) setRecentTrades(m.trades);
      if (m.type === 'trade' && m.trade) {
        setRecentTrades((prev) => [m.trade, ...prev].slice(0, 50));
      }
      setIsActive(true);
    });

    void (async () => {
      const token = await StorageService.get(STORAGE_KEYS.TOKEN);
      if (!token || dead) return;
      accUrl = futuresWsUrl(`/api/ws/futures/account?token=${encodeURIComponent(token)}`);
      wsService.subscribe(accUrl, () => setIsActive(true));
    })();

    return () => {
      dead = true;
      wsService.unsubscribe(marketsUrl);
      wsService.unsubscribe(bookUrl);
      if (accUrl) wsService.unsubscribe(accUrl);
    };
  }, [symbol]);

  return {
    symbol,
    spotSym,
    markPrice,
    indexPrice,
    fundingRate,
    recentTrades,
    spotRefPrice,
    spotChangePct,
    quotes,
    refresh,
    isActive,
  };
}
