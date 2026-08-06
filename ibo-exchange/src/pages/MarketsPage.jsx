import { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import {
  Search, Star, ArrowRight, RefreshCw,
} from 'lucide-react';
import BscTokenDirectory from '@/components/markets/BscTokenDirectory';
import DeltaOptionsChain from '@/components/markets/DeltaOptionsChain';
import { COIN_ICONS, marketApi } from '@/services/marketApi';
import MarketCoinCell from '@/components/markets/MarketCoinCell';
import MarketsSpotMobileCard from '@/components/markets/MarketsSpotMobileCard';
import { useLiveMarkets } from '@/hooks/useLiveMarkets';
import {
  computeMarketBreadth,
  hasLive24hStats,
  isUsdtSpotMarket,
  marketsWithLiveStats,
} from '@/lib/marketStats';
import { futuresApi, openMarketsWs } from '@/services/futuresApi';
import { optionsApi } from '@/services/optionsApi';
import { useAuth } from '@/context/AuthContext';
import GetVerifiedModal from '@/components/GetVerifiedModal';

const fmtP = (v, base) => {
  const n = parseFloat(v);
  if (!n) return '—';
  if (base === 'BTC') return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n >= 1000 ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : n >= 1 ? n.toFixed(4) : n.toFixed(6);
};

const fmtVol = v => {
  const n = parseFloat(v);
  if (!n) return '—';
  return n >= 1e9 ? `${(n / 1e9).toFixed(2)}B`
    : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M`
      : n >= 1e3 ? `${(n / 1e3).toFixed(2)}K`
        : n.toFixed(2);
};


const num = v => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

/** Large-cap USDT pairs (for “Major” tab) */
const MAJOR_BASES = new Set(['BTC', 'ETH', 'BNB', 'SOL', 'XRP']);

const MARKET_MODES = [
  { id: 'spot', label: 'Spot', desc: 'USDT pairs' },
  { id: 'web3', label: 'BEP-20 / Web3', desc: 'Full token directory' },
  { id: 'futures', label: 'Futures', desc: 'USDT perpetuals' },
  { id: 'options', label: 'Options', desc: 'USDT · v1 long-only' },
  { id: 'ibo', label: 'Delta Markets', desc: 'Delta-quoted pairs' },
];

const CATEGORY_TABS = [
  { id: 'all', label: 'All' },
  { id: 'favorites', label: 'Watchlist', icon: Star },
  { id: 'major', label: 'Major' },
  { id: 'alt', label: 'Alts' },
  { id: 'listed', label: 'Listed' },
  { id: 'ibo', label: 'Delta' },
  { id: 'gainers', label: 'Gainers' },
  { id: 'losers', label: 'Losers' },
  { id: 'topVolume', label: 'Volume' },
];

/** Futures tab: Delta-style category filters */
const FUTURES_CATEGORY_TABS = [
  { id: 'all', label: 'All' },
  { id: 'favorites', label: 'Watchlist', icon: Star },
  { id: 'major', label: 'Major' },
  { id: 'alt', label: 'Alts' },
  { id: 'gainers', label: 'Gainers' },
  { id: 'losers', label: 'Losers' },
  { id: 'topVolume', label: 'Volume' },
];

/** Shared category tab button for Spot / Futures (keeps Watchlist visible). */
function MarketsCategoryTab({ id, label, Icon, active, onClick, count }) {
  const isWatchlist = id === 'favorites';
  const TabIcon = Icon || (isWatchlist ? Star : null);
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`relative flex h-11 flex-shrink-0 items-center gap-1.5 px-3.5 text-[13px] whitespace-nowrap transition-colors ${
        active
          ? 'font-semibold text-[color:var(--ibo-ink)]'
          : 'font-medium text-[color:var(--ibo-muted)] hover:text-[color:var(--ibo-ink)]'
      }`}
    >
      {TabIcon ? (
        <TabIcon
          size={12}
          className={
            active || (isWatchlist && count > 0)
              ? 'fill-[color:var(--ibo-accent)] text-[color:var(--ibo-accent)]'
              : 'text-[color:var(--ibo-muted)]'
          }
        />
      ) : null}
      <span>{label}</span>
      {isWatchlist && typeof count === 'number' ? (
        <span className="font-mono text-[11px] tabular-nums" style={{ color: 'var(--ibo-muted)' }}>
          ({count})
        </span>
      ) : null}
      {active ? (
        <span
          className="absolute inset-x-2 bottom-0 h-0.5 rounded-full"
          style={{ background: 'var(--ibo-accent)' }}
        />
      ) : null}
    </button>
  );
}

/** Options markets: Delta-style underlying + call/put filters */
const OPTIONS_MARKET_UNDERLYINGS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'];

/** Fill bid/ask/IV/OI when chain has no book yet so the Delta chain table is populated. */
function ensureOptionQuotes(row) {
  const m = row.market || {};
  const hasBook = (m.best_bid != null || row.bid != null) && (m.best_ask != null || row.ask != null);
  const hasLast = num(row.last_price ?? m.last_price ?? row.mark_price ?? m.mark_price) > 0;
  if (hasBook && hasLast && num(row.volume_24h ?? m.volume_24h) > 0) return row;
  const S = num(row.index_price ?? row.demo_index_price);
  const K = num(row.strike);
  const ot = String(row.option_type || '').toLowerCase();
  if (S <= 0 || K <= 0) return row;
  const intrinsic = ot === 'put' ? Math.max(K - S, 0) : Math.max(S - K, 0);
  const moneyness = Math.abs(S - K) / S;
  const mid = Math.max(intrinsic + S * 0.01 * Math.max(0.15, 1 - moneyness * 3.5), S * 0.0004);
  const spread = Math.max(mid * 0.02, 0.01);
  const seed = String(row.id || `${ot}-${K}`).split('').reduce((a, ch) => a + ch.charCodeAt(0), 0);
  const volume = Math.round(Math.max(40, S * 0.012 * Math.max(0.12, 1 - moneyness * 4)) * (0.55 + (seed % 90) / 100));
  const change = ((((seed % 61) - 30) / 10) * (0.35 + moneyness));
  const last = mid * (1 + change / 200);
  const oi = Math.round(volume * (0.4 + (seed % 40) / 100));
  const bidQty = Math.round((10 + (seed % 50)) * (0.5 + (1 - moneyness))) / 10;
  const askQty = Math.round((8 + (seed % 40)) * (0.5 + (1 - moneyness))) / 10;
  const delta = ot === 'call'
    ? Math.max(0.01, Math.min(0.99, 0.5 + (S - K) / S))
    : Math.max(-0.99, Math.min(-0.01, -0.5 + (S - K) / S));
  const market = {
    ...m,
    mark_price: m.mark_price ?? mid,
    mid: m.mid ?? mid,
    last_price: m.last_price ?? last,
    best_bid: m.best_bid ?? Math.max(0, mid - spread / 2),
    best_ask: m.best_ask ?? mid + spread / 2,
    bid_qty: m.bid_qty ?? bidQty,
    ask_qty: m.ask_qty ?? askQty,
    bid_iv: m.bid_iv ?? 0.45 + moneyness,
    ask_iv: m.ask_iv ?? 0.55 + moneyness,
    iv: m.iv ?? 0.5 + moneyness * 0.5,
    delta: m.delta ?? delta,
    volume_24h: m.volume_24h ?? volume,
    change_24h_pct: m.change_24h_pct ?? change,
    open_interest: m.open_interest ?? oi,
  };
  return {
    ...row,
    mark_price: row.mark_price ?? market.mark_price,
    last_price: row.last_price ?? market.last_price,
    bid: row.bid ?? market.best_bid,
    ask: row.ask ?? market.best_ask,
    volume_24h: row.volume_24h ?? market.volume_24h,
    change_24h_pct: row.change_24h_pct ?? market.change_24h_pct,
    open_interest: row.open_interest ?? market.open_interest,
    delta: row.delta ?? market.delta,
    market,
  };
}

const fmtFunding8h = (rate) => {
  if (rate == null || !Number.isFinite(Number(rate))) return '—';
  const r = Number(rate);
  return `${(r * 100).toFixed(4)}%`;
};

const VERIFY_DISMISSED_KEY = 'maxbyteex_get_verified_dismissed';

/** Highlighted Trade CTA — brand accent pill */
const TRADE_BTN_CLASS =
  'inline-flex items-center justify-center rounded-md bg-[color:var(--ibo-accent)] px-3 py-1.5 text-[12px] font-bold text-[#101013] transition-[filter] hover:brightness-110';

export default function MarketsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const [showVerify, setShowVerify] = useState(false);
  const { markets, loading } = useLiveMarkets();
  const [search, setSearch] = useState('');
  const [marketMode, setMarketMode] = useState('spot');
  const [category, setCategory] = useState('all');
  const [favorites, setFavorites] = useState(() => {
    try { return JSON.parse(localStorage.getItem('maxbyteex_favs') || '[]'); } catch { return []; }
  });
  const [sortKey, setSortKey] = useState('quoteVolume');
  const [sortDir, setSortDir] = useState(-1);
  const [futuresCatalog, setFuturesCatalog] = useState([]);
  const [futuresMarks, setFuturesMarks] = useState({});
  const [futuresLoading, setFuturesLoading] = useState(false);
  const [futuresSearch, setFuturesSearch] = useState('');
  const [underlyingMarkets, setUnderlyingMarkets] = useState({});
  const [futuresFunding, setFuturesFunding] = useState({});
  const [futuresCategory, setFuturesCategory] = useState('all');
  const [futuresSortKey, setFuturesSortKey] = useState('quoteVolume');
  const [futuresSortDir, setFuturesSortDir] = useState(-1);
  const [futuresFavorites, setFuturesFavorites] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('maxbyteex_favs_perp') || '[]');
    } catch {
      return [];
    }
  });
  const [optionsUnderlying, setOptionsUnderlying] = useState('BTCUSDT');
  const [optionsContracts, setOptionsContracts] = useState([]);
  const [optionsIndexPrice, setOptionsIndexPrice] = useState(null);
  const [optionsLoading, setOptionsLoading] = useState(false);

  // Show GetVerifiedModal after registration or for unverified users
  useEffect(() => {
    if (location.state?.justRegistered) {
      setShowVerify(true);
      window.history.replaceState({}, '', location.pathname);
      return;
    }
    if (user && user.kyc_status !== 'approved') {
      const dismissed = sessionStorage.getItem(VERIFY_DISMISSED_KEY);
      if (!dismissed) setShowVerify(true);
    }
  }, [user?.uid, location.state?.justRegistered]); // eslint-disable-line react-hooks/exhaustive-deps

  const dismissVerify = () => {
    sessionStorage.setItem(VERIFY_DISMISSED_KEY, '1');
    setShowVerify(false);
  };

  useEffect(() => {
    if (marketMode !== 'options') return undefined;
    let cancelled = false;

    const load = async () => {
      const sym = optionsUnderlying;
      setOptionsLoading(true);
      try {
        let list = [];
        let idx = null;
        try {
          const chain = await optionsApi.getChain(sym, true, true);
          if (Array.isArray(chain?.contracts) && chain.contracts.length) {
            list = chain.contracts;
            idx = chain.index_price ?? null;
          }
        } catch {
          /* demo */
        }
        if (!list.length) {
          try {
            const demo = await optionsApi.demoChain(sym);
            if (Array.isArray(demo?.contracts) && demo.contracts.length) {
              list = demo.contracts;
              idx = demo.index_price ?? null;
            }
          } catch {
            /* empty */
          }
        }
        if (cancelled) return;
        const enriched = list.map((c) =>
          ensureOptionQuotes({
            ...c,
            index_price: idx ?? c.demo_index_price ?? c.index_price,
            underlying_symbol: c.underlying_symbol || sym,
          }),
        );
        setOptionsContracts(enriched);
        setOptionsIndexPrice(idx ?? enriched[0]?.index_price ?? enriched[0]?.demo_index_price ?? null);
      } finally {
        if (!cancelled) setOptionsLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [marketMode, optionsUnderlying]);

  useEffect(() => {
    if (marketMode !== 'futures') return undefined;
    let cancelled = false;
    setFuturesLoading(true);
    futuresApi
      .listSymbols()
      .then((d) => {
        if (!cancelled) setFuturesCatalog(Array.isArray(d?.symbols) ? d.symbols : []);
      })
      .catch(() => {
        if (!cancelled) setFuturesCatalog([]);
      })
      .finally(() => {
        if (!cancelled) setFuturesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [marketMode]);

  useEffect(() => {
    if (marketMode !== 'futures') return undefined;
    let cancelled = false;
    const tick = async () => {
      try {
        const list = await marketApi.getMarkets();
        if (cancelled) return;
        const map = Object.fromEntries(list.filter((m) => m?.symbol).map((m) => [m.symbol, m]));
        setUnderlyingMarkets(map);
      } catch {
        if (!cancelled) setUnderlyingMarkets({});
      }
    };
    tick();
    const id = window.setInterval(tick, 8000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [marketMode]);

  useEffect(() => {
    if (marketMode !== 'futures' || !futuresCatalog.length) return undefined;
    let cancelled = false;
    const loadFunding = () => {
      Promise.all(
        futuresCatalog.map((s) =>
          futuresApi
            .fundingRate(s.symbol)
            .then((d) => [s.symbol, d?.rate])
            .catch(() => [s.symbol, null]),
        ),
      ).then((pairs) => {
        if (cancelled) return;
        setFuturesFunding((prev) => {
          const next = { ...prev };
          for (const [sym, r] of pairs) {
            if (r != null && Number.isFinite(Number(r))) next[sym] = Number(r);
          }
          return next;
        });
      });
    };
    loadFunding();
    const iv = window.setInterval(loadFunding, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(iv);
    };
  }, [futuresCatalog, marketMode]);

  useEffect(() => {
    if (marketMode !== 'futures') return undefined;
    let closed = false;
    let ws = null;
    let reconnectTimer = null;
    const connect = () => {
      if (closed) return;
      ws = openMarketsWs((msg) => {
        if (msg?.type !== 'futures_markets' || !Array.isArray(msg.markets)) return;
        const next = {};
        for (const m of msg.markets) {
          if (m?.symbol) next[m.symbol] = m;
        }
        setFuturesMarks((prev) => ({ ...prev, ...next }));
      });
      ws.onclose = () => {
        ws = null;
        if (!closed) reconnectTimer = window.setTimeout(connect, 3000);
      };
    };
    connect();
    return () => {
      closed = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
    };
  }, [marketMode]);

  const futuresRowsMerged = useMemo(() => {
    return futuresCatalog.map((s) => {
      const bin = s.binance_symbol || '';
      const spot = bin ? underlyingMarkets[bin] : null;
      const mark = futuresMarks[s.symbol];
      const mp = mark?.mark_price != null ? parseFloat(mark.mark_price) : NaN;
      const ixRaw = mark?.index_price != null ? parseFloat(mark.index_price) : NaN;
      const ix = Number.isFinite(ixRaw) ? ixRaw : (Number.isFinite(mp) ? mp : NaN);
      const fr = futuresFunding[s.symbol];
      return {
        ...s,
        spot,
        markPrice: Number.isFinite(mp) ? mp : null,
        indexPrice: Number.isFinite(ix) ? ix : null,
        fundingRate: Number.isFinite(Number(fr)) ? Number(fr) : null,
      };
    });
  }, [futuresCatalog, underlyingMarkets, futuresMarks, futuresFunding]);


  const futuresList = useMemo(() => {
    const q = futuresSearch.trim().toLowerCase();
    let list = futuresRowsMerged.filter((row) => {
      const base = row.base || '';
      if (q && !(row.symbol?.toLowerCase().includes(q) || String(base).toLowerCase().includes(q))) return false;
      if (futuresCategory === 'favorites') return futuresFavorites.includes(row.symbol);
      if (futuresCategory === 'major') return MAJOR_BASES.has(base);
      if (futuresCategory === 'alt') return !MAJOR_BASES.has(base);
      if (futuresCategory === 'gainers') return num(row.spot?.priceChangePercent) > 0;
      if (futuresCategory === 'losers') return num(row.spot?.priceChangePercent) < 0;
      return true;
    });
    const sk = futuresSortKey;
    const sd = futuresSortDir;
    if (sk === 'spread') {
      list = [...list].sort((a, b) => {
        const sa = num(a.spot?.askPrice) - num(a.spot?.bidPrice);
        const sb = num(b.spot?.askPrice) - num(b.spot?.bidPrice);
        return (sa - sb) * sd;
      });
    } else if (sk === 'markBasis') {
      list = [...list].sort((a, b) => {
        const lastA = num(a.spot?.price);
        const lastB = num(b.spot?.price);
        const basisA =
          lastA > 0 && a.markPrice != null ? ((a.markPrice - lastA) / lastA) * 10000 : -1e9;
        const basisB =
          lastB > 0 && b.markPrice != null ? ((b.markPrice - lastB) / lastB) * 10000 : -1e9;
        return (basisA - basisB) * sd;
      });
    } else {
      list = [...list].sort((a, b) => {
        let va = 0;
        let vb = 0;
        if (sk === 'markPrice') {
          va = a.markPrice ?? 0;
          vb = b.markPrice ?? 0;
        } else if (sk === 'fundingRate') {
          va = a.fundingRate ?? -1e9;
          vb = b.fundingRate ?? -1e9;
        } else if (sk === 'max_leverage') {
          va = num(a.max_leverage);
          vb = num(b.max_leverage);
        } else {
          va = num(a.spot?.[sk]);
          vb = num(b.spot?.[sk]);
        }
        return (va - vb) * sd;
      });
    }
    return list;
  }, [
    futuresRowsMerged,
    futuresSearch,
    futuresCategory,
    futuresFavorites,
    futuresSortKey,
    futuresSortDir,
  ]);

  const handleFuturesSort = (k) => {
    if (futuresSortKey === k) setFuturesSortDir((d) => -d);
    else {
      setFuturesSortKey(k);
      if (k === 'spread') setFuturesSortDir(1);
      else {
        setFuturesSortDir(
          k === 'priceChangePercent' || k === 'quoteVolume' || k === 'volume' || k === 'count' || k === 'markBasis'
            ? -1
            : 1,
        );
      }
    }
  };

  const FuturesSortTh = ({ label, field, className = '', align = 'left' }) => (
    <th
      onClick={() => handleFuturesSort(field)}
      className={`px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider cursor-pointer select-none whitespace-nowrap transition-colors ${
        align === 'right' ? 'text-right' : 'text-left'
      } ${className}`}
      style={{ color: 'var(--ibo-muted)' }}
    >
      <span className="inline-flex items-center gap-0.5 hover:text-[color:var(--ibo-ink)]">
        {label}
        {futuresSortKey === field && (
          <span style={{ color: 'var(--ibo-accent)' }}>{futuresSortDir > 0 ? '↑' : '↓'}</span>
        )}
      </span>
    </th>
  );

  const selectFuturesCategory = (id) => {
    setFuturesCategory(id);
    if (id === 'topVolume') {
      setFuturesSortKey('quoteVolume');
      setFuturesSortDir(-1);
    }
  };

  const toggleFuturesFav = (sym) => {
    const next = futuresFavorites.includes(sym) ? futuresFavorites.filter((f) => f !== sym) : [...futuresFavorites, sym];
    setFuturesFavorites(next);
    localStorage.setItem('maxbyteex_favs_perp', JSON.stringify(next));
  };

  const refreshFuturesPage = async () => {
    setFuturesLoading(true);
    try {
      const [d, spotList] = await Promise.all([futuresApi.listSymbols(), marketApi.getMarkets()]);
      setFuturesCatalog(Array.isArray(d?.symbols) ? d.symbols : []);
      const map = Object.fromEntries(spotList.filter((m) => m?.symbol).map((m) => [m.symbol, m]));
      setUnderlyingMarkets(map);
    } catch {
      /* ignore */
    } finally {
      setFuturesLoading(false);
    }
  };

  useEffect(() => {
    const tab = new URLSearchParams(location.search).get('tab');
    if (tab === 'web3') setMarketMode('web3');
  }, [location.search]);

  useEffect(() => {
    if (marketMode !== 'futures') {
      setFuturesSearch('');
      setFuturesCategory('all');
    }
  }, [marketMode]);

  const refreshOptionsPage = async () => {
    setOptionsLoading(true);
    try {
      const sym = optionsUnderlying;
      let list = [];
      let idx = null;
      try {
        const chain = await optionsApi.getChain(sym, true, true);
        if (Array.isArray(chain?.contracts) && chain.contracts.length) {
          list = chain.contracts;
          idx = chain.index_price ?? null;
        }
      } catch {
        /* demo */
      }
      if (!list.length) {
        try {
          const demo = await optionsApi.demoChain(sym);
          if (Array.isArray(demo?.contracts) && demo.contracts.length) {
            list = demo.contracts;
            idx = demo.index_price ?? null;
          }
        } catch {
          /* empty */
        }
      }
      const enriched = list.map((c) =>
        ensureOptionQuotes({
          ...c,
          index_price: idx ?? c.demo_index_price ?? c.index_price,
          underlying_symbol: c.underlying_symbol || sym,
        }),
      );
      setOptionsContracts(enriched);
      setOptionsIndexPrice(idx ?? enriched[0]?.index_price ?? enriched[0]?.demo_index_price ?? null);
    } finally {
      setOptionsLoading(false);
    }
  };

  const toggleFav = sym => {
    const next = favorites.includes(sym) ? favorites.filter(f => f !== sym) : [...favorites, sym];
    setFavorites(next);
    localStorage.setItem('maxbyteex_favs', JSON.stringify(next));
  };

  const handleSort = k => {
    if (sortKey === k) setSortDir(d => -d);
    else {
      setSortKey(k);
      if (k === 'spread') setSortDir(1);
      else setSortDir(k === 'priceChangePercent' || k === 'quoteVolume' || k === 'volume' || k === 'count' ? -1 : 1);
    }
  };

  const { gainers, losers } = useMemo(
    () => {
      const b = computeMarketBreadth(markets, { usdtSpotOnly: true });
      return {
        gainers: b.gainers,
        losers: b.losers,
      };
    },
    [markets],
  );

  const selectCategory = id => {
    setCategory(id);
    if (id === 'topVolume') {
      setSortKey('quoteVolume');
      setSortDir(-1);
    }
  };

  const filtered = useMemo(() => {
    if (marketMode !== 'spot') return [];
    let list = markets.filter(m => m.market_visible !== false).filter(m => {
      const base = m.base || m.symbol?.replace('USDT', '');
      if (category !== 'ibo' && !isUsdtSpotMarket(m)) return false;
      if (category === 'listed') return m.is_listed || m.source === 'listed' || m.source === 'internal_mock';
      if (category === 'favorites') return favorites.includes(m.symbol);
      if (category === 'ibo') return base === 'IBO';
      if (category === 'major') return MAJOR_BASES.has(base);
      if (category === 'alt') return !MAJOR_BASES.has(base) && base !== 'IBO';
      if (category === 'gainers') return hasLive24hStats(m) && num(m.priceChangePercent) > 0;
      if (category === 'losers') return hasLive24hStats(m) && num(m.priceChangePercent) < 0;
      return true;
    });
    list = list.filter(m =>
      !search || m.symbol?.toLowerCase().includes(search.toLowerCase()) || m.base?.toLowerCase().includes(search.toLowerCase()),
    );
    if (sortKey === 'spread') {
      list = [...list].sort((a, b) => {
        const sa = num(a.askPrice) - num(a.bidPrice);
        const sb = num(b.askPrice) - num(b.bidPrice);
        return (sa - sb) * sortDir;
      });
    } else {
      list.sort((a, b) => {
        const va = num(a[sortKey] ?? 0);
        const vb = num(b[sortKey] ?? 0);
        return (va - vb) * sortDir;
      });
    }
    return list;
  }, [markets, marketMode, category, favorites, search, sortKey, sortDir]);

  const SortTh = ({ label, field, className = '' }) => (
    <th
      onClick={() => handleSort(field)}
      className={`px-2 md:px-2.5 py-2 text-left text-[10px] md:text-[11px] font-bold uppercase tracking-wider cursor-pointer select-none whitespace-nowrap transition-colors ${className}`}
      style={{ color: 'var(--ibo-muted)' }}
    >
      <span className="hover:text-[color:var(--ibo-ink)] inline-flex items-center gap-0.5">
        {label}
        {sortKey === field && (
          <span style={{ color: 'var(--ibo-accent)' }}>{sortDir > 0 ? '↑' : '↓'}</span>
        )}
      </span>
    </th>
  );

  return (
    <div className="ibo-page">
      {showVerify && <GetVerifiedModal onClose={dismissVerify} />}

      <div className="w-full max-w-[100vw] min-w-0 px-3 sm:px-4 md:px-6 lg:px-8 xl:px-10 py-3 sm:py-4 md:py-5 pb-10 sm:pb-14">

        {/* Title */}
        <div className="mb-4 flex flex-col gap-3 sm:mb-5 sm:flex-row sm:items-end sm:justify-between">
              <div>
            <h1 className="text-xl font-extrabold tracking-tight sm:text-2xl" style={{ color: 'var(--ibo-ink)' }}>
              Markets
            </h1>
            <p className="mt-0.5 text-[12px] sm:text-[13px]" style={{ color: 'var(--ibo-muted)' }}>
              Spot · Futures · Options
                </p>
              </div>
            </div>

        {/* Movers strip — above product tabs (Delta homepage style) */}
        <div className="mb-4 grid grid-cols-1 gap-3 sm:mb-5 md:grid-cols-3">
          {[
            {
              key: 'vol',
              title: 'Highest volume',
              accent: 'var(--ibo-accent)',
              rows: marketsWithLiveStats(markets, { usdtSpotOnly: true })
                .slice()
                .sort((a, b) => num(b.quoteVolume) - num(a.quoteVolume))
                .slice(0, 5),
              pctClass: null,
            },
            {
              key: 'up',
              title: 'Top gainers',
              accent: '#22c55e',
              rows: gainers,
              pctClass: 'text-green-500',
            },
            {
              key: 'down',
              title: 'Top losers',
              accent: '#ef4444',
              rows: losers,
              pctClass: 'text-red-500',
            },
          ].map((col) => (
            <div
              key={col.key}
              className="delta-movers-card overflow-hidden rounded border"
            >
              <div className="flex items-center gap-2 border-b px-3 py-2.5">
                <span className="h-3.5 w-1 rounded-full" style={{ background: col.accent }} />
                <span className="text-[12px] font-bold" style={{ color: 'var(--ibo-ink)' }}>{col.title}</span>
                    </div>
              <div className="delta-movers-rows">
                {loading ? (
                  <div className="py-6 text-center text-[12px]" style={{ color: 'var(--ibo-muted)' }}>Loading…</div>
                ) : col.rows.length === 0 ? (
                  <div className="py-6 text-center text-[12px]" style={{ color: 'var(--ibo-muted)' }}>No data</div>
                ) : (
                  col.rows.map((m) => {
                    const base = m.base || m.symbol?.replace('USDT', '');
                    const pct = num(m.priceChangePercent);
                      const icon = COIN_ICONS[base];
                      return (
                        <button
                        key={m.symbol}
                          type="button"
                        onClick={() => navigate(`/trade/${m.symbol}`)}
                        className="delta-movers-row flex w-full items-center gap-2.5 px-3 py-2 text-left"
                        >
                          {icon ? (
                          <img src={icon} alt="" className="h-6 w-6 rounded-full" />
                          ) : (
                          <div className="delta-movers-fallback-icon flex h-6 w-6 items-center justify-center rounded-full text-[9px] font-bold">
                              {base?.slice(0, 2)}
                            </div>
                          )}
                        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold" style={{ color: 'var(--ibo-ink)' }}>
                          {base}
                          <span className="font-normal" style={{ color: 'var(--ibo-muted)' }}>/USDT</span>
                  </span>
                        {col.key === 'vol' ? (
                          <span className="font-mono text-[11px] tabular-nums" style={{ color: 'var(--ibo-ink-secondary)' }}>
                            ${fmtVol(m.quoteVolume)}
                          </span>
                        ) : (
                          <span className={`font-mono text-[12px] font-bold tabular-nums ${col.pctClass}`}>
                            {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
                          </span>
                        )}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
          ))}
            </div>

        {/* Product tabs */}
        <div
          className="mb-0 flex items-center gap-0 overflow-x-auto overscroll-x-contain border-b"
          style={{ borderColor: 'var(--ibo-border-solid)' }}
          role="tablist"
          aria-label="Market type"
        >
          {MARKET_MODES.map(({ id, label }) => {
            const active = marketMode === id;
                    return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setMarketMode(id)}
                className={`relative flex-shrink-0 px-3.5 py-2.5 text-[13px] font-bold whitespace-nowrap transition-colors sm:px-5 sm:py-3 sm:text-sm ${
                  active
                    ? 'text-[color:var(--ibo-ink)]'
                    : 'text-[color:var(--ibo-muted)] hover:text-[color:var(--ibo-ink-secondary)]'
                }`}
              >
                {label}
                {active ? (
                  <span
                    className="absolute bottom-0 left-2 right-2 h-[2px] rounded-full"
                    style={{ background: 'var(--ibo-accent)' }}
                  />
                ) : null}
              </button>
                    );
                  })}
                </div>

        {marketMode === 'options' && (
          <DeltaOptionsChain
            underlying={optionsUnderlying}
            indexPrice={optionsIndexPrice}
            contracts={optionsContracts}
            loading={optionsLoading}
            onRefresh={refreshOptionsPage}
            onUnderlyingChange={setOptionsUnderlying}
            underlyings={OPTIONS_MARKET_UNDERLYINGS}
          />
        )}

        {marketMode === 'futures' && (
          <>
            {/* Full-bleed Delta markets list — edge to edge, no card box */}
            <div
              className="delta-markets-panel -mx-3 sm:-mx-4 md:-mx-6 lg:-mx-8 xl:-mx-10 border-y"
            >
              <div
                className="delta-markets-tabs flex flex-col border-b sm:flex-row sm:items-center sm:justify-between"
                style={{ borderColor: 'var(--ibo-border-solid)' }}
              >
                <div
                  className="flex min-w-0 flex-1 items-center gap-0 overflow-x-auto overscroll-x-contain pl-2 pr-1 sm:pl-4 md:pl-6 lg:pl-8 xl:pl-10 [scrollbar-width:none]"
                  role="tablist"
                  aria-label="Futures categories"
                >
                  {FUTURES_CATEGORY_TABS.map(({ id, label, icon: Icon }) => (
                    <MarketsCategoryTab
                        key={id}
                      id={id}
                      label={label}
                      Icon={Icon}
                      active={futuresCategory === id}
                        onClick={() => selectFuturesCategory(id)}
                      count={id === 'favorites' ? futuresFavorites.length : undefined}
                    />
                  ))}
                  <span className="hidden flex-shrink-0 pl-2 font-mono text-[11px] tabular-nums sm:inline" style={{ color: 'var(--ibo-muted)' }}>
                    {futuresList.length}/{futuresRowsMerged.length}
                  </span>
                  </div>

                <div className="flex items-center gap-2 border-t px-3 py-2 sm:border-t-0 sm:py-0 sm:pr-4 md:pr-6 lg:pr-8 xl:pr-10" style={{ borderColor: 'var(--ibo-border-solid)' }}>
                <div
                    className="delta-markets-search flex h-8 min-w-0 flex-1 items-center gap-2 rounded border px-2.5 sm:w-48 sm:flex-none"
                >
                    <Search size={13} className="flex-shrink-0" style={{ color: 'var(--ibo-muted)' }} />
                  <input
                    value={futuresSearch}
                    onChange={(e) => setFuturesSearch(e.target.value)}
                      placeholder="Search"
                      className="min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-[color:var(--ibo-muted)]"
                      style={{ color: 'var(--ibo-ink)' }}
                  />
                </div>
                  <button
                    type="button"
                    onClick={() => refreshFuturesPage()}
                    className="delta-markets-icon-btn flex h-8 w-8 flex-shrink-0 items-center justify-center rounded border transition-colors"
                    style={{ color: 'var(--ibo-ink-secondary)' }}
                    aria-label="Refresh futures data"
                  >
                    <RefreshCw size={13} className={futuresLoading ? 'animate-spin' : ''} />
                  </button>
              </div>
            </div>

              <div className="hidden md:block w-full min-w-0">
                <div className="w-full min-w-0 overflow-x-auto overscroll-x-contain touch-pan-x [scrollbar-width:thin]">
                    <table className="w-full min-w-[860px] border-collapse text-left text-[13px]">
                      <thead>
                        <tr className="border-b">
                          <th className="w-10 py-2.5 pl-3 pr-2 sm:pl-4 md:pl-6 lg:pl-8 xl:pl-10" />
                          <th
                            className="px-3 py-2.5 text-left text-[10px] font-medium uppercase tracking-wider"
                            style={{ color: 'var(--ibo-muted)' }}
                          >
                            Contract
                        </th>
                          <FuturesSortTh label="Price" field="price" align="right" />
                          <FuturesSortTh label="Mark" field="markPrice" align="right" />
                          <FuturesSortTh label="24h Change" field="priceChangePercent" align="right" />
                          <FuturesSortTh label="24h High" field="highPrice" align="right" className="hidden lg:table-cell" />
                          <FuturesSortTh label="24h Low" field="lowPrice" align="right" className="hidden lg:table-cell" />
                          <FuturesSortTh label="24h Volume" field="quoteVolume" align="right" />
                          <FuturesSortTh label="Funding" field="fundingRate" align="right" />
                          <FuturesSortTh label="Max Lev" field="max_leverage" align="right" className="hidden xl:table-cell" />
                          <th
                            className="py-2.5 pl-3 pr-3 text-right text-[10px] font-medium uppercase tracking-wider sm:pr-4 md:pr-6 lg:pr-8 xl:pr-10"
                            style={{ color: 'var(--ibo-muted)' }}
                          >
                          Trade
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {futuresLoading && futuresList.length === 0 ? (
                        <tr>
                            <td colSpan={11} className="py-20 text-center">
                              <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-[color:var(--ibo-accent)] border-t-transparent" />
                          </td>
                        </tr>
                      ) : futuresList.length === 0 ? (
                        <tr>
                            <td colSpan={11} className="py-16 text-center text-[13px]" style={{ color: 'var(--ibo-muted)' }}>
                              {futuresCategory === 'favorites'
                                ? 'No contracts in your watchlist yet. Tap the star on any row to add one.'
                                : 'No contracts match your filters.'}
                          </td>
                        </tr>
                      ) : (
                          futuresList.map((row) => {
                          const spot = row.spot;
                          const base = row.base || row.symbol?.replace(/USDT-PERP/i, '')?.replace('USDT', '');
                          const icon = COIN_ICONS[base];
                          const pct = num(spot?.priceChangePercent);
                          const isUp = pct >= 0;
                          const mp = row.markPrice;
                          const fav = futuresFavorites.includes(row.symbol);
                            const fund = row.fundingRate;
                            const fundNum = fund != null ? Number(fund) : null;
                            const fundUp = fundNum != null && Number.isFinite(fundNum) ? fundNum >= 0 : null;
                          return (
                              <tr
                              key={row.symbol}
                                className="border-b transition-colors cursor-pointer"
                                style={{ borderColor: 'var(--ibo-border-solid)' }}
                                onClick={() => navigate(`/futures/${encodeURIComponent(row.symbol)}`)}
                              >
                                <td className="py-2.5 pl-3 pr-2 sm:pl-4 md:pl-6 lg:pl-8 xl:pl-10" onClick={(e) => e.stopPropagation()}>
                                <button
                                  type="button"
                                  onClick={() => toggleFuturesFav(row.symbol)}
                                  className="p-1"
                                  aria-label={fav ? 'Remove from perp watchlist' : 'Add to perp watchlist'}
                                >
                                    <Star
                                      size={13}
                                      className={
                                        fav
                                          ? 'fill-[color:var(--ibo-accent)] text-[color:var(--ibo-accent)]'
                                          : 'text-[color:var(--ibo-muted)]'
                                      }
                                    />
                                </button>
                              </td>
                                <td className="px-3 py-2.5">
                                  <div className="flex min-w-0 items-center gap-2.5">
                                  {icon ? (
                                      <img src={icon} alt="" className="h-6 w-6 flex-shrink-0 rounded-full" />
                                  ) : (
                                      <div
                                        className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[9px] font-bold"
                                        style={{ background: 'rgba(254, 108, 2,0.15)', color: 'var(--ibo-accent)' }}
                                      >
                                      {base?.slice(0, 2)}
                                    </div>
                                  )}
                                    <div className="min-w-0 leading-tight">
                                      <div className="truncate text-[13px] font-semibold" style={{ color: 'var(--ibo-ink)' }}>
                                        {base}
                                        <span className="ml-1 font-normal" style={{ color: 'var(--ibo-muted)' }}>
                                          USDT
                                        </span>
                                      </div>
                                      <div className="text-[10px]" style={{ color: 'var(--ibo-muted)' }}>
                                        Perpetual
                                      </div>
                                  </div>
                                </div>
                              </td>
                                <td className="px-3 py-2.5 text-right font-mono text-[13px] tabular-nums whitespace-nowrap" style={{ color: 'var(--ibo-ink)' }}>
                                {spot ? `$${fmtP(spot.price, base)}` : '—'}
                              </td>
                                <td className="px-3 py-2.5 text-right font-mono text-[13px] tabular-nums whitespace-nowrap" style={{ color: 'var(--ibo-ink-secondary)' }}>
                                {mp != null && mp > 0 ? `$${fmtP(String(mp), base)}` : '—'}
                              </td>
                                <td className="px-3 py-2.5 text-right">
                                {spot ? (
                                    <span className={`font-semibold tabular-nums ${isUp ? 'text-green-500' : 'text-red-500'}`}>
                                      {isUp ? '+' : ''}
                                      {pct.toFixed(2)}%
                                    </span>
                                ) : (
                                    <span style={{ color: 'var(--ibo-muted)' }}>—</span>
                                )}
                              </td>
                                <td className="hidden px-3 py-2.5 text-right font-mono text-[12px] tabular-nums whitespace-nowrap lg:table-cell" style={{ color: 'var(--ibo-ink-secondary)' }}>
                                {spot ? `$${fmtP(spot.highPrice, base)}` : '—'}
                              </td>
                                <td className="hidden px-3 py-2.5 text-right font-mono text-[12px] tabular-nums whitespace-nowrap lg:table-cell" style={{ color: 'var(--ibo-ink-secondary)' }}>
                                {spot ? `$${fmtP(spot.lowPrice, base)}` : '—'}
                              </td>
                                <td className="px-3 py-2.5 text-right font-mono text-[12px] tabular-nums whitespace-nowrap" style={{ color: 'var(--ibo-ink-secondary)' }}>
                                {spot ? `$${fmtVol(spot.quoteVolume)}` : '—'}
                              </td>
                                <td
                                  className={`px-3 py-2.5 text-right font-mono text-[12px] tabular-nums whitespace-nowrap ${
                                    fundUp == null ? '' : fundUp ? 'text-green-500' : 'text-red-500'
                                  }`}
                                  style={fundUp == null ? { color: 'var(--ibo-ink-secondary)' } : undefined}
                                >
                                  {fmtFunding8h(row.fundingRate)}
                              </td>
                                <td className="hidden px-3 py-2.5 text-right font-mono text-[12px] tabular-nums xl:table-cell" style={{ color: 'var(--ibo-ink-secondary)' }}>
                                {row.max_leverage != null ? `${row.max_leverage}×` : '—'}
                              </td>
                                <td className="py-2.5 pl-3 pr-3 text-right sm:pr-4 md:pr-6 lg:pr-8 xl:pr-10" onClick={(e) => e.stopPropagation()}>
                                <Link
                                  to={`/futures/${encodeURIComponent(row.symbol)}`}
                                    className={TRADE_BTN_CLASS}
                                >
                                    Trade
                                </Link>
                              </td>
                              </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

                <div className="divide-y md:hidden" style={{ borderColor: 'var(--ibo-border-solid)' }}>
                {futuresLoading && futuresList.length === 0 ? (
                    <div className="flex justify-center py-16">
                      <div className="h-8 w-8 animate-spin rounded-full border-2 border-[color:var(--ibo-accent)] border-t-transparent" />
                  </div>
                ) : futuresList.length === 0 ? (
                    <p className="py-12 text-center text-[13px]" style={{ color: 'var(--ibo-muted)' }}>
                      {futuresCategory === 'favorites'
                        ? 'No contracts in your watchlist yet. Tap the star on any row to add one.'
                        : 'No contracts match your filters.'}
                    </p>
                ) : (
                  futuresList.map((row) => {
                    const spot = row.spot;
                    const base = row.base || row.symbol?.replace(/USDT-PERP/i, '')?.replace('USDT', '');
                    const icon = COIN_ICONS[base];
                    const pct = num(spot?.priceChangePercent);
                    const isUp = pct >= 0;
                    const mp = row.markPrice;
                    const fav = futuresFavorites.includes(row.symbol);
                      const fund = row.fundingRate;
                      const fundNum = fund != null ? Number(fund) : null;
                      const fundUp = fundNum != null && Number.isFinite(fundNum) ? fundNum >= 0 : null;
                    return (
                      <div
                        key={row.symbol}
                          className="space-y-2.5 px-3 py-3 sm:px-4 md:px-6"
                          style={{ borderColor: 'var(--ibo-border-solid)' }}
                      >
                        <div className="flex items-start justify-between gap-2">
                            <div className="flex min-w-0 flex-1 items-center gap-2">
                              <button type="button" onClick={() => toggleFuturesFav(row.symbol)} className="flex-shrink-0">
                                <Star
                                  size={13}
                                  className={
                                    fav
                                      ? 'fill-[color:var(--ibo-accent)] text-[color:var(--ibo-accent)]'
                                      : 'text-[color:var(--ibo-muted)]'
                                  }
                                />
                            </button>
                            {icon ? (
                                <img src={icon} alt="" className="h-7 w-7 flex-shrink-0 rounded-full" />
                            ) : (
                                <div
                                  className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[9px] font-bold"
                                  style={{ background: 'rgba(254, 108, 2,0.15)', color: 'var(--ibo-accent)' }}
                                >
                                {base?.slice(0, 2)}
                              </div>
                            )}
                              <div className="min-w-0 leading-tight">
                                <p className="truncate text-[13px] font-semibold" style={{ color: 'var(--ibo-ink)' }}>
                                  {base}{' '}
                                  <span className="font-normal" style={{ color: 'var(--ibo-muted)' }}>
                                    USDT
                                  </span>
                                </p>
                                <p className="text-[10px]" style={{ color: 'var(--ibo-muted)' }}>
                                  Perpetual
                                </p>
                            </div>
                          </div>
                          {spot && (
                              <div className={`flex-shrink-0 text-right text-[13px] font-semibold tabular-nums ${isUp ? 'text-green-500' : 'text-red-500'}`}>
                              {isUp ? '+' : ''}
                              {pct.toFixed(2)}%
                            </div>
                          )}
                        </div>
                          <div className="grid grid-cols-3 gap-2 text-[11px]">
                          <div>
                              <p style={{ color: 'var(--ibo-muted)' }}>Price</p>
                              <p className="font-mono tabular-nums" style={{ color: 'var(--ibo-ink)' }}>
                                {spot ? `$${fmtP(spot.price, base)}` : '—'}
                              </p>
                          </div>
                          <div>
                              <p style={{ color: 'var(--ibo-muted)' }}>Mark</p>
                              <p className="font-mono tabular-nums" style={{ color: 'var(--ibo-ink)' }}>
                                {mp != null && mp > 0 ? `$${fmtP(String(mp), base)}` : '—'}
                              </p>
                          </div>
                          <div>
                              <p style={{ color: 'var(--ibo-muted)' }}>Volume</p>
                              <p className="font-mono tabular-nums" style={{ color: 'var(--ibo-ink-secondary)' }}>
                                {spot ? `$${fmtVol(spot.quoteVolume)}` : '—'}
                              </p>
                          </div>
                          <div>
                              <p style={{ color: 'var(--ibo-muted)' }}>High</p>
                              <p className="font-mono tabular-nums" style={{ color: 'var(--ibo-ink-secondary)' }}>
                                {spot ? `$${fmtP(spot.highPrice, base)}` : '—'}
                              </p>
                          </div>
                          <div>
                              <p style={{ color: 'var(--ibo-muted)' }}>Low</p>
                              <p className="font-mono tabular-nums" style={{ color: 'var(--ibo-ink-secondary)' }}>
                                {spot ? `$${fmtP(spot.lowPrice, base)}` : '—'}
                              </p>
                          </div>
                          <div>
                              <p style={{ color: 'var(--ibo-muted)' }}>Funding</p>
                              <p
                                className={`font-mono tabular-nums ${fundUp == null ? '' : fundUp ? 'text-green-500' : 'text-red-500'}`}
                                style={fundUp == null ? { color: 'var(--ibo-ink-secondary)' } : undefined}
                              >
                                {fmtFunding8h(row.fundingRate)}
                              </p>
                          </div>
                        </div>
                        <Link
                          to={`/futures/${encodeURIComponent(row.symbol)}`}
                            className={`${TRADE_BTN_CLASS} w-full`}
                        >
                            Trade
                        </Link>
                      </div>
                    );
                  })
                )}
              </div>
          </div>

          </>
        )}

        {marketMode === 'web3' && (
          <BscTokenDirectory
            title="BEP-20 / Web3 token directory"
            subtitle="Same tokens as Wallet → Deposit on BNB Chain. Search, filter, and deposit — live USD prices where CoinGecko provides them."
          />
        )}

        {marketMode === 'spot' && (
        <>
        {/* Full-bleed Delta markets list — edge to edge, no card box */}
        <div
          className="delta-markets-panel -mx-3 sm:-mx-4 md:-mx-6 lg:-mx-8 xl:-mx-10 border-y"
        >
          <div
            className="delta-markets-tabs flex flex-col border-b sm:flex-row sm:items-center sm:justify-between"
            style={{ borderColor: 'var(--ibo-border-solid)' }}
          >
            <div
              className="flex min-w-0 flex-1 items-center gap-0 overflow-x-auto overscroll-x-contain pl-2 pr-1 sm:pl-4 md:pl-6 lg:pl-8 xl:pl-10 [scrollbar-width:none]"
              role="tablist"
              aria-label="Spot categories"
            >
              {CATEGORY_TABS.map(({ id, label, icon: Icon }) => (
                <MarketsCategoryTab
                    key={id}
                  id={id}
                  label={label}
                  Icon={Icon}
                  active={category === id}
                    onClick={() => selectCategory(id)}
                  count={id === 'favorites' ? favorites.length : undefined}
                />
              ))}
              <span className="hidden flex-shrink-0 pl-2 font-mono text-[11px] tabular-nums sm:inline" style={{ color: 'var(--ibo-muted)' }}>
                {loading ? '…' : filtered.length}
                </span>
              </div>
            <div className="flex items-center gap-2 border-t px-3 py-2 sm:border-t-0 sm:py-0 sm:pr-4 md:pr-6 lg:pr-8 xl:pr-10" style={{ borderColor: 'var(--ibo-border-solid)' }}>
            <div
                className="delta-markets-search flex h-8 min-w-0 flex-1 items-center gap-2 rounded border px-2.5 sm:w-48 sm:flex-none"
            >
                <Search size={13} className="flex-shrink-0" style={{ color: 'var(--ibo-muted)' }} />
              <input
                value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search"
                  className="min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-[color:var(--ibo-muted)]"
                  style={{ color: 'var(--ibo-ink)' }}
              />
            </div>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="delta-markets-icon-btn flex h-8 w-8 flex-shrink-0 items-center justify-center rounded border transition-colors"
                style={{ color: 'var(--ibo-ink-secondary)' }}
                aria-label="Refresh list"
              >
                <RefreshCw size={13} />
              </button>
          </div>
        </div>

          <div className="hidden md:block w-full min-w-0">
              <div className="w-full min-w-0 overflow-x-auto overscroll-x-contain touch-pan-x [scrollbar-width:thin]">
                <table className="w-full min-w-[720px] md:min-w-[880px] lg:min-w-[1000px] xl:min-w-[1180px] border-collapse text-left text-[13px]">
                  <thead>
                    <tr className="border-b">
                      <th className="w-9 py-2.5 pl-3 pr-1.5 sm:pl-4 md:pl-6 lg:pl-8 xl:pl-10" />
                      <th
                        className="px-2 py-2.5 text-left text-[10px] font-medium uppercase tracking-wider lg:min-w-[140px]"
                        style={{ color: 'var(--ibo-muted)' }}
                      >
                        Contract
                    </th>
                      <SortTh label="Price" field="price" />
                      <SortTh label="24h Change" field="priceChangePercent" />
                    <SortTh label="High" field="highPrice" className="hidden md:table-cell" />
                    <SortTh label="Low" field="lowPrice" className="hidden md:table-cell" />
                      <SortTh label="Volume" field="volume" />
                    <SortTh label="Vol USDT" field="quoteVolume" className="hidden md:table-cell" />
                      <th
                        className="py-2.5 pl-2 pr-3 text-right text-[10px] font-medium uppercase tracking-wider sm:pr-4 md:pr-6 lg:pr-8 xl:pr-10"
                        style={{ color: 'var(--ibo-muted)' }}
                      >
                      Trade
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                        <td colSpan={9} className="py-20 text-center">
                          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-[color:var(--ibo-accent)] border-t-transparent" />
                      </td>
                    </tr>
                  ) : filtered.length === 0 ? (
                    <tr>
                        <td colSpan={9} className="py-16 text-center text-[13px]" style={{ color: 'var(--ibo-muted)' }}>
                          {category === 'favorites'
                            ? 'No pairs in your watchlist yet. Tap the star on any row to add one.'
                            : 'No pairs match your filters.'}
                        </td>
                    </tr>
                  ) : (
                      filtered.map((m) => {
                      const pct = num(m.priceChangePercent);
                      const isUp = pct >= 0;
                      const base = m.base || m.symbol?.replace('USDT', '');
                      const isFav = favorites.includes(m.symbol);
                      return (
                          <tr
                          key={m.symbol}
                            className="border-b transition-colors cursor-pointer"
                            style={{ borderColor: 'var(--ibo-border-solid)' }}
                            onClick={() => navigate(`/trade/${m.symbol}`)}
                          >
                            <td className="py-2.5 pl-3 pr-1.5 sm:pl-4 md:pl-6 lg:pl-8 xl:pl-10" onClick={(e) => e.stopPropagation()}>
                              <button type="button" onClick={() => toggleFav(m.symbol)} className="p-0.5" aria-label={isFav ? 'Remove from watchlist' : 'Add to watchlist'}>
                                <Star size={13} className={isFav ? 'fill-[color:var(--ibo-accent)] text-[color:var(--ibo-accent)]' : 'text-[color:var(--ibo-muted)]'} />
                            </button>
                          </td>
                            <td className="px-2 py-2.5 min-w-[140px]">
                              <MarketCoinCell market={m} size={28} />
                          </td>
                            <td className="px-2 py-2.5 font-mono text-[13px] font-semibold tabular-nums whitespace-nowrap" style={{ color: 'var(--ibo-ink)' }}>
                              ${fmtP(m.price, base)}
                            </td>
                            <td className="px-2 py-2.5">
                              <span className={`font-semibold tabular-nums text-[12px] ${isUp ? 'text-green-500' : 'text-red-500'}`}>
                                {isUp ? '+' : ''}{pct.toFixed(2)}%
                              </span>
                          </td>
                            <td className="hidden px-2 py-2.5 font-mono text-[12px] tabular-nums whitespace-nowrap md:table-cell" style={{ color: 'var(--ibo-ink-secondary)' }}>
                              ${fmtP(m.highPrice, base)}
                          </td>
                            <td className="hidden px-2 py-2.5 font-mono text-[12px] tabular-nums whitespace-nowrap md:table-cell" style={{ color: 'var(--ibo-ink-secondary)' }}>
                              ${fmtP(m.lowPrice, base)}
                          </td>
                            <td className="px-2 py-2.5 font-mono text-[12px] tabular-nums whitespace-nowrap" style={{ color: 'var(--ibo-ink-secondary)' }}>
                              {fmtVol(m.volume)}
                            </td>
                            <td className="hidden px-2 py-2.5 font-mono text-[12px] tabular-nums whitespace-nowrap md:table-cell" style={{ color: 'var(--ibo-ink-secondary)' }}>
                              ${fmtVol(m.quoteVolume)}
                            </td>
                            <td className="py-2.5 pl-2 pr-3 text-right sm:pr-4 md:pr-6 lg:pr-8 xl:pr-10" onClick={(e) => e.stopPropagation()}>
                            <Link
                              to={`/trade/${m.symbol}`}
                                className={TRADE_BTN_CLASS}
                            >
                                Trade
                            </Link>
                          </td>
                          </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

            <div className="divide-y md:hidden" style={{ borderColor: 'var(--ibo-border-solid)' }}>
            {loading ? (
                <div className="flex justify-center py-16">
                  <div className="h-8 w-8 animate-spin rounded-full border-2 border-[color:var(--ibo-accent)] border-t-transparent" />
              </div>
            ) : filtered.length === 0 ? (
                <p className="py-12 text-center text-[13px]" style={{ color: 'var(--ibo-muted)' }}>
                  {category === 'favorites'
                    ? 'No pairs in your watchlist yet. Tap the star on any row to add one.'
                    : 'No pairs match your filters.'}
                </p>
              ) : (
                  filtered.map((m) => (
                    <div key={m.symbol} className="px-3 py-3 sm:px-4 md:px-6">
                <MarketsSpotMobileCard
                  market={m}
                  isFavorite={favorites.includes(m.symbol)}
                  onToggleFavorite={toggleFav}
                />
                    </div>
                  ))
        )}
            </div>
        </div>

        </>
        )}

        {/* ── Delta Markets section ──────────────────────────────────────── */}
        {marketMode === 'ibo' && (
          <div className="text-center py-8">
            <p className="text-white/50 text-sm mb-4">
              Delta-quoted pairs are available on the dedicated Delta Markets page.
            </p>
            <Link
              to="/ibo-markets"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gold/15 border border-gold/30 text-gold-light font-bold text-sm hover:bg-gold/25 transition-colors"
            >
              Open Delta Markets <ArrowRight size={14} />
            </Link>
          </div>
        )}

        <p className="text-white/45 text-xs sm:text-sm text-center mt-8 px-2">
          Delta data from Delta backend · Other pairs from Binance public 24h ticker · Not financial advice
        </p>
      </div>
    </div>
  );
}
