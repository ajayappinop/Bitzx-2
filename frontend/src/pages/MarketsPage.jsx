import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Search, Star, TrendingUp, TrendingDown, ArrowRight,
  BarChart2, RefreshCw, ArrowLeft,
} from 'lucide-react';
import { tradingApi } from '@/services/api';
import { SITE_CONFIG } from '@/config/site';
import { resolveMarketLogo } from '@/lib/marketLogo';

const LOGO_URL = SITE_CONFIG.brandLogoUrl;

const fmtPrice = (v, base) => {
  const n = parseFloat(v);
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

export default function MarketsPage() {
  const navigate  = useNavigate();
  const [markets,   setMarkets]   = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [search,    setSearch]    = useState('');
  const [category,  setCategory]  = useState('All');
  const [favorites, setFavorites] = useState(() => {
    try { return JSON.parse(localStorage.getItem('ibo_favs') || '[]'); }
    catch { return []; }
  });
  const [sortKey,   setSortKey]   = useState('');
  const [sortDir,   setSortDir]   = useState(1);
  const timerRef = useRef(null);

  const load = () => {
    tradingApi.getMarkets()
      .then(data => { setMarkets(data); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    load();
    timerRef.current = setInterval(load, 5000);
    return () => clearInterval(timerRef.current);
  }, []);

  const toggleFav = sym => {
    const next = favorites.includes(sym)
      ? favorites.filter(f => f !== sym)
      : [...favorites, sym];
    setFavorites(next);
    localStorage.setItem('ibo_favs', JSON.stringify(next));
  };

  const handleSort = key => {
    if (sortKey === key) setSortDir(d => -d);
    else { setSortKey(key); setSortDir(1); }
  };

  const filtered = markets
    .filter(m => {
      if (category === 'Favorites') return favorites.includes(m.symbol);
      if (category === 'IBO')  return m.baseAsset === 'IBO' || m.symbol === 'IBOUSDT';
      return true;
    })
    .filter(m =>
      !search ||
      m.symbol?.toLowerCase().includes(search.toLowerCase()) ||
      m.baseAsset?.toLowerCase().includes(search.toLowerCase()),
    )
    .sort((a, b) => {
      if (!sortKey) return 0;
      const va = parseFloat(a[sortKey] ?? 0);
      const vb = parseFloat(b[sortKey] ?? 0);
      return (va - vb) * sortDir;
    });

  const SortTh = ({ label, field }) => (
    <th
      className="px-4 py-3 text-left text-[11px] font-semibold text-[#4A4B50] uppercase tracking-wider cursor-pointer hover:text-ink-muted select-none"
      onClick={() => handleSort(field)}
    >
      {label}
      {sortKey === field && <span className="ml-1">{sortDir > 0 ? '↑' : '↓'}</span>}
    </th>
  );

  return (
    <div className="min-h-screen bg-surface">
      {/* Top nav */}
      <header className="border-b border-line bg-surface-elevated">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center justify-between gap-4 md:justify-start md:gap-6">
            <Link to="/" className="flex items-center gap-2">
              <img src={LOGO_URL} alt="IBO" className="h-8 w-8 object-contain" />
              <span className="font-bold text-lg">
                <span className="text-ink">IBO</span>
              </span>
            </Link>
            <nav className="flex items-center gap-3 sm:gap-4 text-sm">
              <Link to="/markets" className="text-ink-accent font-semibold">Markets</Link>
              <Link to="/trade/IBOUSDT" className="text-ink-muted hover:text-ink transition-colors">Trade</Link>
              <Link to="/" className="hidden sm:inline text-ink-muted hover:text-ink transition-colors">Home</Link>
            </nav>
          </div>
          <Link to="/" className="flex items-center gap-2 text-sm text-ink-muted hover:text-ink transition-colors self-start md:self-auto">
            <ArrowLeft size={16} />
            Back to Home
          </Link>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        {/* Page header */}
        <div className="mb-8">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <div className="flex items-center gap-2 mb-2">
              <BarChart2 size={20} className="text-ink-accent" />
              <span className="text-ink-accent text-sm font-semibold uppercase tracking-wider">Live Markets</span>
            </div>
            <h1 className="text-3xl md:text-4xl font-bold text-ink">Market Overview</h1>
            <p className="text-ink-muted mt-2">
              Trade IBO and top crypto assets with real-time prices
            </p>
          </motion.div>
        </div>

        {/* Filters & search */}
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 mb-6">
          <div className="flex flex-wrap gap-2">
            {['All', 'Favorites', 'IBO'].map(c => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                className={`px-4 py-1.5 rounded-full text-sm font-semibold transition-colors ${
                  category === c
                    ? 'bg-[#0EA4AB] text-[#050a1a]'
                    : 'bg-surface-card text-ink-muted hover:text-ink border border-line'
                }`}
              >
                {c === 'Favorites' && <Star size={12} className="inline mr-1 mb-0.5" />}
                {c}
              </button>
            ))}
          </div>
          <div className="flex w-full sm:w-auto items-center gap-3">
            <div className="flex flex-1 sm:flex-initial items-center gap-2 bg-surface-card border border-line rounded-xl px-4 py-2 min-w-0">
              <Search size={16} className="text-[#4A4B50]" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search pairs…"
                className="bg-transparent text-sm text-ink outline-none w-full sm:w-40 min-w-0 placeholder:text-[#4A4B50]"
              />
            </div>
            <button
              onClick={() => { setLoading(true); load(); }}
              className="p-2 rounded-xl bg-surface-card border border-line text-ink-muted hover:text-ink transition-colors"
            >
              <RefreshCw size={16} />
            </button>
          </div>
        </div>

        {/* Mobile cards */}
        <div className="md:hidden space-y-3">
          {loading ? (
            <div className="bg-surface-elevated border border-line rounded-2xl py-16">
              <div className="w-8 h-8 border-2 border-[#0EA4AB] border-t-transparent rounded-full animate-spin mx-auto" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="bg-surface-elevated border border-line rounded-2xl py-16 text-center text-[#4A4B50]">
              No pairs found
            </div>
          ) : (
            filtered.map((m, i) => {
              const pct = parseFloat(m.priceChangePercent || 0);
              const isUp = pct >= 0;
              const isFav = favorites.includes(m.symbol);
              const base = m.baseAsset || m.symbol.replace('USDT', '');
              const icon = resolveMarketLogo(m, m.logo_url);
              const isIbo = base === 'IBO';

              return (
                <motion.div
                  key={m.symbol}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03 }}
                  className="bg-surface-elevated border border-line rounded-2xl p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <button onClick={() => toggleFav(m.symbol)} className="mt-1">
                        <Star
                          size={14}
                          className={isFav ? 'text-ink-accent fill-[#C5E35B]' : 'text-[#1a2748]'}
                        />
                      </button>
                      {icon ? (
                        <img src={icon} alt={base} className="w-10 h-10 rounded-full object-cover flex-shrink-0" />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-[#0EA4AB]/20 flex items-center justify-center text-ink-accent text-xs font-bold flex-shrink-0">
                          {base.slice(0, 2)}
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-ink font-semibold">{base}</span>
                          <span className="text-[#4A4B50] text-xs">/USDT</span>
                          {isIbo && (
                            <span className="bg-[#0EA4AB]/20 text-ink-accent text-[9px] px-1.5 py-0.5 rounded font-semibold">
                              IBO
                            </span>
                          )}
                        </div>
                        <span className="text-[#4A4B50] text-xs break-all">{m.symbol}</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-ink font-mono font-semibold">${fmtPrice(m.price, base)}</p>
                      <p className={`text-sm font-semibold ${isUp ? 'text-green-400' : 'text-red-400'}`}>
                        {isUp ? '+' : ''}{pct.toFixed(2)}%
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3 mt-4 text-sm">
                    <div className="rounded-xl bg-surface-card border border-line p-3">
                      <p className="text-[#4A4B50] text-[11px] uppercase tracking-wider mb-1">High</p>
                      <p className="text-ink-muted font-mono">${fmtPrice(m.highPrice, base)}</p>
                    </div>
                    <div className="rounded-xl bg-surface-card border border-line p-3">
                      <p className="text-[#4A4B50] text-[11px] uppercase tracking-wider mb-1">Low</p>
                      <p className="text-ink-muted font-mono">${fmtPrice(m.lowPrice, base)}</p>
                    </div>
                    <div className="rounded-xl bg-surface-card border border-line p-3">
                      <p className="text-[#4A4B50] text-[11px] uppercase tracking-wider mb-1">Volume</p>
                      <p className="text-ink-muted">{fmtVol(m.volume)}</p>
                    </div>
                  </div>

                  <button
                    onClick={() => navigate(`/trade/${m.symbol}`)}
                    className="mt-4 inline-flex w-full items-center justify-center gap-1 bg-[#0EA4AB]/10 hover:bg-[#0EA4AB]/30 text-ink-accent border border-[#0EA4AB]/30 text-sm font-semibold px-3 py-2.5 rounded-lg transition-colors"
                  >
                    Trade
                    <ArrowRight size={14} />
                  </button>
                </motion.div>
              );
            })
          )}
        </div>

        {/* Desktop table */}
        <div className="hidden md:block bg-surface-elevated border border-line rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full min-w-[860px]">
            <thead className="border-b border-line">
              <tr>
                <th className="px-4 py-3 w-8" />
                <th className="px-4 py-3 text-left text-[11px] font-semibold text-[#4A4B50] uppercase tracking-wider">Pair</th>
                <SortTh label="Price"  field="price" />
                <SortTh label="24h %" field="priceChangePercent" />
                <SortTh label="24h High" field="highPrice" />
                <SortTh label="24h Low"  field="lowPrice"  />
                <SortTh label="Volume"   field="volume"    />
                <th className="px-4 py-3 text-right text-[11px] font-semibold text-[#4A4B50] uppercase tracking-wider">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="text-center py-16">
                    <div className="w-8 h-8 border-2 border-[#0EA4AB] border-t-transparent rounded-full animate-spin mx-auto" />
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-16 text-[#4A4B50]">No pairs found</td>
                </tr>
              ) : (
                filtered.map((m, i) => {
                  const pct     = parseFloat(m.priceChangePercent || 0);
                  const isUp    = pct >= 0;
                  const isFav   = favorites.includes(m.symbol);
                  const base    = m.baseAsset || m.symbol.replace('USDT', '');
                  const icon    = resolveMarketLogo(m, m.logo_url);
                  const isIbo   = base === 'IBO';

                  return (
                    <motion.tr
                      key={m.symbol}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.03 }}
                      className="border-b border-line/50 hover:bg-white/[0.03] transition-colors group"
                    >
                      {/* Favorite */}
                      <td className="px-4 py-3">
                        <button onClick={() => toggleFav(m.symbol)}>
                          <Star
                            size={14}
                            className={isFav ? 'text-ink-accent fill-[#C5E35B]' : 'text-[#1a2748] group-hover:text-[#4A4B50]'}
                          />
                        </button>
                      </td>

                      {/* Pair */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          {icon ? (
                            <img src={icon} alt={base} className="w-8 h-8 rounded-full object-cover" />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-[#0EA4AB]/20 flex items-center justify-center text-ink-accent text-xs font-bold">
                              {base.slice(0, 2)}
                            </div>
                          )}
                          <div>
                            <div className="flex items-center gap-1.5">
                              <span className="text-ink font-semibold">{base}</span>
                              <span className="text-[#4A4B50] text-xs">/USDT</span>
                              {isIbo && (
                                <span className="bg-[#0EA4AB]/20 text-ink-accent text-[9px] px-1.5 py-0.5 rounded font-semibold">
                                  IBO
                                </span>
                              )}
                            </div>
                            <span className="text-[#4A4B50] text-xs">{m.symbol}</span>
                          </div>
                        </div>
                      </td>

                      {/* Price */}
                      <td className="px-4 py-3">
                        <span className="text-ink font-mono font-semibold">
                          ${fmtPrice(m.price, base)}
                        </span>
                      </td>

                      {/* 24h % */}
                      <td className="px-4 py-3">
                        <span className={`flex items-center gap-1 font-semibold ${isUp ? 'text-green-400' : 'text-red-400'}`}>
                          {isUp ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                          {isUp ? '+' : ''}{parseFloat(m.priceChangePercent || 0).toFixed(2)}%
                        </span>
                      </td>

                      {/* High */}
                      <td className="px-4 py-3 text-ink-muted font-mono text-sm">
                        ${fmtPrice(m.highPrice, base)}
                      </td>

                      {/* Low */}
                      <td className="px-4 py-3 text-ink-muted font-mono text-sm">
                        ${fmtPrice(m.lowPrice, base)}
                      </td>

                      {/* Volume */}
                      <td className="px-4 py-3 text-ink-muted text-sm">
                        {fmtVol(m.volume)}
                      </td>

                      {/* Action */}
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => navigate(`/trade/${m.symbol}`)}
                          className="inline-flex items-center gap-1 bg-[#0EA4AB]/10 hover:bg-[#0EA4AB]/30 text-ink-accent border border-[#0EA4AB]/30 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
                        >
                          Trade
                          <ArrowRight size={12} />
                        </button>
                      </td>
                    </motion.tr>
                  );
                })
              )}
            </tbody>
          </table>
          </div>
        </div>

        <p className="text-[#4A4B50] text-xs mt-4 text-center">
          Prices update every 5 seconds. IBO data from IBO backend · Other pairs from Binance public API.
        </p>
      </main>
    </div>
  );
}
