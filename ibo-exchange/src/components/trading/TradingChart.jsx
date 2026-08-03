/**
 * TradingChart — TradingView for Binance-listed USDT pairs; synthetic chart for
 * internal mock / listed non-Binance pairs (e.g. MIDASUSDT).
 */
import TVChart from './TVChart';
import SyntheticChart from './SyntheticChart';
import { isSyntheticUsdtChartSymbol } from '@/services/marketApi';

export default function TradingChart({ symbol, lastPrice, marketMeta }) {
  const sym = String(symbol || '').toUpperCase();
  if (isSyntheticUsdtChartSymbol(sym, marketMeta)) {
    return <SyntheticChart key={sym} symbol={sym} lastPrice={lastPrice} />;
  }
  return <TVChart key={sym} symbol={sym} />;
}
