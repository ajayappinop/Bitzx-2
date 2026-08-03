import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronDown, TrendingUp, TrendingDown, BarChart2,
  ArrowLeft, Globe,
} from 'lucide-react';
import { tradingApi } from '@/services/api';
import TradingChart  from '@/components/trading/TradingChart';
import OrderBook     from '@/components/trading/OrderBook';
import TradeForm     from '@/components/trading/TradeForm';
import RecentTrades  from '@/components/trading/RecentTrades';
import OpenOrders    from '@/components/trading/OpenOrders';
import { resolveMarketLogo } from '@/lib/marketLogo';
import { normalizeSpotRouteSymbol, baseFromSpotSymbol } from '@/lib/tradeSymbol';
import { SITE_CONFIG } from '@/config/site';

const LOGO_URL = SITE_CONFIG.brandLogoUrl;

const QUICK_PAIRS = ['IBOUSDT', 'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT'];

const fmtPrice = (v, base) => {
  const n = parseFloat(v);
  if (!n) return '—';
  if (base === 'BTC') return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (n >= 1)    return n.toFixed(4);
  return n.toFixed(6);
};

const fmtVol = v => {
  const n = parseFloat(v);
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(2) + 'K';
  return n.toFixed(2);
};

function StatItem({ label, value, sub }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] text-[#4A4B50] uppercase tracking-wider">{label}</span>
      <span className="text-sm text-ink font-mono">{value}</span>
      {sub && <span className="text-[10px] text-[#4A4B50]">{sub}</span>}
    </div>
  );
}

export default function TradePage() {
  const { symbol: routeSymbol } = useParams();
  const navigate = useNavigate();

  const symbol = useMemo(
    () => normalizeSpotRouteSymbol(routeSymbol),
    [routeSymbol],
  );

  const [ticker,    setTicker]    = useState(null);
  const [orders,    setOrders]    = useState([]);
  const [pairOpen,  setPairOpen]  = useState(false);
  const [formPrice, setFormPrice] = useState('');
  const [logoUrl,   setLogoUrl]   = useState(null);
  const [listedPairs, setListedPairs] = useState([]);
  const tickerTimer = useRef(null);

  const base  = baseFromSpotSymbol(symbol);
  const icon  = resolveMarketLogo(base, logoUrl);

  useEffect(() => {
    const canonical = normalizeSpotRouteSymbol(routeSymbol);
    if (!routeSymbol || routeSymbol.toUpperCase() !== canonical) {
      navigate(`/trade/${canonical}`, { replace: true });
    }
  }, [routeSymbol, navigate]);

  const loadTicker = useCallback(() => {
    tradingApi.getTicker(symbol)
      .then(setTicker)
      .catch(console.error);
  }, [symbol]);

  useEffect(() => {
    setTicker(null);
    loadTicker();
    tickerTimer.current = setInterval(loadTicker, 2000);
    return () => clearInterval(tickerTimer.current);
  }, [symbol, loadTicker]);

  useEffect(() => {
    tradingApi.getMarkets()
      .then((markets) => {
        const row = (markets || []).find((m) => m.symbol === symbol);
        setLogoUrl(row?.logo_url ?? null);
        const staticSyms = new Set(QUICK_PAIRS);
        const extra = (markets || [])
          .filter((m) => m?.symbol?.endsWith('USDT') && (m.is_listed || m.source === 'listed'))
          .filter((m) => !staticSyms.has(m.symbol))
          .map((m) => ({
            symbol: m.symbol,
            base: m.baseAsset || m.base || baseFromSpotSymbol(m.symbol),
            logo_url: m.logo_url,
          }));
        setListedPairs(extra);
      })
      .catch(() => {
        setLogoUrl(null);
        setListedPairs([]);
      });
  }, [symbol]);

  const usdtPairs = useMemo(() => {
    const seen = new Set(QUICK_PAIRS);
    const merged = QUICK_PAIRS.map((sym) => ({ symbol: sym, base: baseFromSpotSymbol(sym), logo_url: null }));
    for (const p of listedPairs) {
      if (p?.symbol && !seen.has(p.symbol)) {
        seen.add(p.symbol);
        merged.push(p);
      }
    }
    if (!seen.has(symbol) && symbol.endsWith('USDT')) {
      merged.unshift({ symbol, base, logo_url: logoUrl });
    }
    return merged;
  }, [listedPairs, symbol, base, logoUrl]);

  const switchPair = sym => {
    const next = normalizeSpotRouteSymbol(sym);
    navigate(`/trade/${next}`, { replace: true });
    setPairOpen(false);
    setOrders([]);
  };

  const handleOrderPlaced = order => {
    setOrders(prev => [order, ...prev]);
  };

  const handleCancelOrder = id => {
    setOrders(prev =>
      prev.map(o => o.id === id ? { ...o, status: 'cancelled' } : o),
    );
  };

  const handleOrderBookPrice = useCallback(p => {
    setFormPrice(p);
  }, []);

  const pct    = parseFloat(ticker?.priceChangePercent ?? 0);
  const isUp   = pct >= 0;
  const price  = ticker?.price ?? '—';

  return (
    <div className="min-h-screen flex flex-col bg-surface" data-trade-layout="delta">

      {/* ── Top: symbol · price · 24h stats ──────────────────────────────── */}
      <header className="sticky top-0 z-30 flex items-center gap-3 px-3 py-1.5 border-b border-line bg-surface flex-shrink-0">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2 flex-shrink-0">
          <img src={LOGO_URL} alt="Delta" className="h-7 w-7 object-contain" />
          <span className="font-bold text-base hidden sm:block">
            <span className="text-ink">Delta</span>
          </span>
        </Link>

        <div className="w-px h-6 bg-[#1a2748] flex-shrink-0" />

        {/* Pair selector */}
        <div className="relative flex-shrink-0">
          <button
            onClick={() => setPairOpen(v => !v)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-card border border-line hover:border-[#0EA4AB]/50 transition-colors"
          >
            {icon && <img src={icon} alt={base} className="w-5 h-5 rounded-full" />}
            <span className="text-ink font-semibold text-sm">{base}</span>
            <span className="text-[#4A4B50] text-sm">/USDT</span>
            <ChevronDown size={14} className="text-[#4A4B50]" />
          </button>

          <AnimatePresence>
            {pairOpen && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                className="absolute top-full left-0 mt-1 w-52 max-h-72 overflow-y-auto bg-surface-card border border-line rounded-xl shadow-xl z-50 py-1"
              >
                {usdtPairs.map(p => (
                  <button
                    key={p.symbol}
                    onClick={() => switchPair(p.symbol)}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-[#1a2748] transition-colors ${
                      p.symbol === symbol ? 'text-ink-accent' : 'text-ink-soft'
                    }`}
                  >
                    {resolveMarketLogo(p.base, p.logo_url) ? (
                      <img
                        src={resolveMarketLogo(p.base, p.logo_url)}
                        alt={p.base}
                        className="w-5 h-5 rounded-full"
                      />
                    ) : null}
                    <span className="font-semibold">{p.base}</span>
                    <span className="text-[#4A4B50]">/USDT</span>
                    {p.symbol === symbol && (
                      <span className="ml-auto text-[10px] bg-[#0EA4AB]/20 text-ink-accent px-1.5 py-0.5 rounded">Active</span>
                    )}
                  </button>
                ))}
                <div className="border-t border-line mt-1 pt-1">
                  <Link
                    to="/markets"
                    className="flex items-center gap-2 px-3 py-2 text-sm text-ink-muted hover:text-ink hover:bg-[#1a2748] transition-colors"
                    onClick={() => setPairOpen(false)}
                  >
                    <Globe size={14} />
                    All markets
                  </Link>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Price + 24h stats */}
        <div className="flex items-center gap-4 flex-1 overflow-x-auto scrollbar-hide min-w-0">
          {ticker ? (
            <>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className={`text-lg font-bold font-mono ${isUp ? 'text-green-400' : 'text-red-400'}`}>
                  ${fmtPrice(price, base)}
                </span>
                <span className={`flex items-center gap-0.5 text-xs font-semibold ${isUp ? 'text-green-400' : 'text-red-400'}`}>
                  {isUp ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                  {isUp ? '+' : ''}{pct.toFixed(2)}%
                </span>
              </div>

              <div className="hidden lg:flex items-center gap-6">
                <StatItem label="24h High" value={`$${fmtPrice(ticker.highPrice, base)}`} />
                <StatItem label="24h Low"  value={`$${fmtPrice(ticker.lowPrice,  base)}`} />
                <StatItem label="24h Vol"  value={fmtVol(ticker.volume)} sub={base} />
                <StatItem label="24h Val"  value={fmtVol(ticker.quoteVolume)} sub="USDT" />
              </div>
            </>
          ) : (
            <div className="h-5 w-32 bg-[#1a2748] rounded animate-pulse" />
          )}
        </div>

        {/* Right actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <Link to="/markets" className="hidden sm:flex items-center gap-1 text-xs text-ink-muted hover:text-ink transition-colors px-2">
            <BarChart2 size={14} />
            Markets
          </Link>
          <Link to="/" className="hidden sm:flex items-center gap-1 text-xs text-ink-muted hover:text-ink transition-colors">
            <ArrowLeft size={14} />
            Home
          </Link>
        </div>
      </header>

      {/* ── Main: chart | order book + trades | ticket (Delta layout) ─────── */}
      <div className="flex min-h-[520px] h-[min(68vh,760px)] overflow-hidden shrink-0">

        {/* Chart (dominant left) */}
        <div className="flex-1 min-w-0 min-h-0 relative overflow-hidden border-r border-line">
          <TradingChart symbol={symbol} />
        </div>

        {/* Center: order book (top) + recent trades (bottom) */}
        <div className="hidden md:flex w-[240px] lg:w-[260px] xl:w-[280px] shrink-0 flex-col min-h-0 border-r border-line bg-transparent">
          <div className="flex-[1.2] min-h-0 overflow-hidden">
            <OrderBook
              symbol={symbol}
              baseAsset={base}
              lastPrice={ticker?.price}
              changePct={ticker != null ? parseFloat(ticker.priceChangePercent) : null}
              onPriceClick={handleOrderBookPrice}
            />
          </div>
          <div className="flex-[0.85] min-h-[160px] max-h-[280px] border-t border-line overflow-hidden">
            <RecentTrades symbol={symbol} baseAsset={base} />
          </div>
        </div>

        {/* Right: order ticket */}
        <div className="hidden md:flex w-[280px] lg:w-[300px] xl:w-[320px] shrink-0 flex-col min-h-0 overflow-hidden">
          <div className="flex-1 min-h-0 overflow-y-auto">
            <TradeForm
              symbol={symbol}
              currentPrice={formPrice || fmtPrice(price, base)}
              onOrderPlaced={handleOrderPlaced}
            />
          </div>
        </div>
      </div>

      {/* Mobile: form under chart, book accessible via secondary strip */}
      <div className="md:hidden flex flex-col border-t border-line shrink-0">
        <div className="min-h-[280px] overflow-y-auto border-b border-line">
          <TradeForm
            symbol={symbol}
            currentPrice={formPrice || fmtPrice(price, base)}
            onOrderPlaced={handleOrderPlaced}
          />
        </div>
        <div className="h-[280px] min-h-0 flex">
          <div className="flex-1 min-w-0 overflow-hidden border-r border-line">
            <OrderBook
              symbol={symbol}
              baseAsset={base}
              lastPrice={ticker?.price}
              changePct={ticker != null ? parseFloat(ticker.priceChangePercent) : null}
              onPriceClick={handleOrderBookPrice}
            />
          </div>
          <div className="w-[45%] min-w-0 overflow-hidden">
            <RecentTrades symbol={symbol} baseAsset={base} />
          </div>
        </div>
      </div>

      {/* Bottom dock — full table; page scrolls to show all rows */}
      <div className="min-h-[320px] border-t border-line bg-surface flex flex-col">
        <OpenOrders
          orders={orders}
          onCancel={handleCancelOrder}
        />
      </div>
    </div>
  );
}
