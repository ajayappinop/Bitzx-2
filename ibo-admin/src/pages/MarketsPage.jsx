import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { TrendingUp, TrendingDown, LineChart, RefreshCw } from 'lucide-react';
import { api, getStoredToken, adminWebSocketUrl } from '@/lib/api';
import { Sparkline } from '@/components/Sparkline';
import CoinAvatar from '@/components/CoinAvatar';
import { AdminPageHeader, StatusBadge, AdminDataTable } from '@/components/AdminPrimitives';
import FeesCommissionsPanel from '@/components/FeesCommissionsPanel';

const INTERVALS = [
  { value: '15m', label: '15m' },
  { value: '1h', label: '1h' },
  { value: '4h', label: '4h' },
  { value: '1d', label: '1d' },
];

const KLINES_LIMIT = 200;

export default function MarketsPage({
  forcedSubTab = null,
  title = 'Market Management',
  subtitle = 'Live prices and simple direction hints from the exchange feed so you can spot busy pairs quickly.',
  hideTabBar = false,
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [subTab, setSubTab] = useState(forcedSubTab || searchParams.get('subtab') || 'pairs');
  const [markets, setMarkets] = useState([]);
  const [symbol, setSymbol] = useState((searchParams.get('symbol') || 'BTCUSDT').toUpperCase());
  const [barInterval, setBarInterval] = useState(searchParams.get('interval') || '1h');
  const [search, setSearch] = useState('');
  const [klines, setKlines] = useState([]);
  const [loadingM, setLoadingM] = useState(true);
  const [loadingK, setLoadingK] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [err, setErr] = useState('');
  const [health, setHealth] = useState(null);
  const [controls, setControls] = useState(null);
  const [savingControls, setSavingControls] = useState(false);
  const wsMarketsRef = useRef(null);
  const wsKlinesRef = useRef(null);

  const loadMarkets = useCallback(async (background = false) => {
    if (!background) setLoadingM(true);
    if (background) setRefreshing(true);
    try {
      const r = await api.tradingMarkets();
      if (!r.ok) throw new Error('Markets unavailable');
      const list = await r.json();
      setMarkets(Array.isArray(list) ? list : []);
      setLastUpdated(new Date());
    } catch {
      setErr('Could not load market list');
    } finally {
      if (!background) setLoadingM(false);
      if (background) setRefreshing(false);
    }
  }, []);

  const loadKlines = useCallback(async (background = false) => {
    if (!background) setLoadingK(true);
    try {
      const r = await api.tradingKlines(symbol, { interval: barInterval, limit: String(KLINES_LIMIT) });
      if (!r.ok) throw new Error('Chart data unavailable');
      setKlines(await r.json());
    } catch {
      setKlines([]);
      setErr('Chart failed to load for this symbol.');
    } finally {
      if (!background) setLoadingK(false);
    }
  }, [symbol, barInterval]);

  useEffect(() => {
    setErr('');
    const token = getStoredToken();
    if (!token) {
      setMarkets([]);
      setLoadingM(false);
      setErr('Not authenticated');
      return;
    }
    const url = adminWebSocketUrl('/api/admin/ws/markets-tickers');
    let closed = false;
    let reconnectTimer = null;
    const connect = () => {
      if (closed) return;
      try {
        const ws = new WebSocket(url);
        wsMarketsRef.current = ws;
        ws.onmessage = (ev) => {
          try {
            const j = JSON.parse(ev.data);
            if (j.type === 'error' && j.detail) {
              setErr(String(j.detail));
              setLoadingM(false);
              return;
            }
            if (j.type === 'markets_tickers' && Array.isArray(j.markets)) {
              setMarkets(j.markets);
              setLastUpdated(j.updated_at ? new Date(j.updated_at) : new Date());
              setLoadingM(false);
            }
          } catch {
            /* ignore */
          }
        };
        ws.onerror = () => {
          setLoadingM(false);
        };
        ws.onclose = () => {
          wsMarketsRef.current = null;
          if (!closed) reconnectTimer = window.setTimeout(connect, 3000);
        };
      } catch {
        setLoadingM(false);
        if (!closed) reconnectTimer = window.setTimeout(connect, 3000);
      }
    };
    connect();
    return () => {
      closed = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (wsMarketsRef.current) {
        try {
          wsMarketsRef.current.close();
        } catch {
          /* ignore */
        }
        wsMarketsRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    setErr('');
    const token = getStoredToken();
    if (!token) {
      setKlines([]);
      setLoadingK(false);
      return;
    }
    setLoadingK(true);
    const qs = new URLSearchParams({
      symbol,
      interval: barInterval,
      limit: String(KLINES_LIMIT),
    });
    const url = adminWebSocketUrl(`/api/admin/ws/trading-klines?${qs.toString()}`);
    let closed = false;
    let reconnectTimer = null;
    const connect = () => {
      if (closed) return;
      try {
        const ws = new WebSocket(url);
        wsKlinesRef.current = ws;
        ws.onmessage = (ev) => {
          try {
            const j = JSON.parse(ev.data);
            if (j.type === 'error' && j.detail) {
              setKlines([]);
              setErr(String(j.detail));
              setLoadingK(false);
              return;
            }
            if (j.type === 'trading_klines' && j.symbol === symbol && j.interval === barInterval && Array.isArray(j.klines)) {
              setKlines(j.klines);
              setLoadingK(false);
            }
          } catch {
            /* ignore */
          }
        };
        ws.onerror = () => {
          setKlines([]);
          setLoadingK(false);
        };
        ws.onclose = () => {
          wsKlinesRef.current = null;
          if (!closed) reconnectTimer = window.setTimeout(connect, 3000);
        };
      } catch {
        setKlines([]);
        setLoadingK(false);
        if (!closed) reconnectTimer = window.setTimeout(connect, 3000);
      }
    };
    connect();
    return () => {
      closed = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (wsKlinesRef.current) {
        try {
          wsKlinesRef.current.close();
        } catch {
          /* ignore */
        }
        wsKlinesRef.current = null;
      }
    };
  }, [symbol, barInterval]);

  useEffect(() => {
    if (forcedSubTab) {
      setSubTab(forcedSubTab);
      return;
    }
    const p = new URLSearchParams();
    p.set('symbol', symbol);
    p.set('interval', barInterval);
    p.set('subtab', subTab);
    setSearchParams(p, { replace: true });
  }, [symbol, barInterval, subTab, setSearchParams, forcedSubTab]);

  useEffect(() => {
    let alive = true;
    const loadOps = async () => {
      try {
        const [h, c] = await Promise.all([
          api.liquidityHealth().then((r) => (r.ok ? r.json() : null)),
          api.platformControls().then((r) => (r.ok ? r.json() : null)),
        ]);
        if (!alive) return;
        setHealth(h);
        setControls(c);
      } catch {
        if (!alive) return;
        setHealth(null);
        setControls(null);
      }
    };
    loadOps();
    const t = setInterval(loadOps, 5000);
    return () => { alive = false; clearInterval(t); };
  }, [savingControls]);

  const closes = klines.map(k => k.close);
  const last = closes.length ? closes[closes.length - 1] : null;
  const first = closes.length ? closes[0] : null;
  const chg = last != null && first != null && first !== 0 ? ((last - first) / first) * 100 : null;

  const filteredMarkets = useMemo(() => {
    const q = search.trim().toUpperCase();
    if (!q) return markets;
    return markets.filter(m => String(m.symbol || '').toUpperCase().includes(q) || String(m.baseAsset || m.base || '').toUpperCase().includes(q));
  }, [markets, search]);

  const row = markets.find(m => m.symbol === symbol) || filteredMarkets[0];

  const fmt = (v, d = 8) => Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: d });
  const fmtVol = (v) => {
    const n = Number(v || 0);
    if (!Number.isFinite(n)) return '—';
    if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
    if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
    return n.toFixed(2);
  };

  const renderMeter = (label, value, max = 100, tone = 'cyan') => {
    const num = Number(value || 0);
    const pct = Math.max(0, Math.min(100, (num / Math.max(1, max)) * 100));
    const barTone = tone === 'red'
      ? 'from-red-500/70 to-red-400/60'
      : tone === 'amber'
      ? 'from-gold/70 to-gold-light/60'
      : 'from-cyan-500/70 to-blue-500/60';
    return (
      <div className="rounded-xl border border-surface-border bg-surface-dark/50 p-3">
        <div className="flex items-center justify-between text-xs text-white/70 mb-2">
          <span className="font-bold">{label}</span>
          <span className="font-mono">{Number.isFinite(num) ? num.toFixed(2) : '—'}</span>
        </div>
        <div className="h-2 rounded-full bg-white/10 overflow-hidden">
          <div className={`h-full bg-gradient-to-r ${barTone}`} style={{ width: `${pct}%` }} />
        </div>
      </div>
    );
  };

  return (
    <div className="admin-page">
      <AdminPageHeader
        icon={LineChart}
        title={title}
        subtitle={subtitle}
        actions={(
          <>
            <StatusBadge tone="info">Last updated: {lastUpdated ? lastUpdated.toLocaleTimeString() : '—'}</StatusBadge>
            <button
              type="button"
              onClick={() => { loadMarkets(true); loadKlines(true); }}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-surface-border text-white/90 font-bold"
            >
              <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
              Refresh now
            </button>
          </>
        )}
      />

      {!hideTabBar ? (
        <div className="mb-5 adm-table-x scrollbar-thin">
          <div className="admin-tabs w-max min-w-full">
            {[
              ['pairs', 'All Pairs'],
              ['health', 'Market Health'],
              ['fees', 'Fees & Commissions'],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setSubTab(id)}
                className={`admin-tab-btn shrink-0 ${subTab === id ? 'active' : ''}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {subTab === 'pairs' ? (
      <div className="grid xl:grid-cols-3 gap-4 mb-6">
        <div className="xl:col-span-1 rounded-2xl border border-surface-border bg-surface-card overflow-hidden max-h-[min(420px,55vh)] xl:max-h-[420px] overflow-y-auto scrollbar-thin min-h-0">
          <div className="px-4 py-3 border-b border-surface-border bg-white/[.02] sticky top-0 z-10">
            <p className="text-sm font-semibold text-white/80 mb-2">Trading pairs</p>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search symbol/base"
              className="w-full rounded-lg bg-surface-dark border border-surface-border px-3 py-2 text-xs text-white font-mono"
            />
          </div>
          {loadingM ? (
            <p className="p-6 text-white/45 text-sm">Loading…</p>
          ) : (
            <ul className="divide-y divide-surface-border/60">
              {filteredMarkets.map(m => {
                const pct = parseFloat(m.priceChangePercent ||0);
                const up = pct >= 0;
                return (
                  <li key={m.symbol}>
                    <button
                      type="button"
                      onClick={() => setSymbol(m.symbol)}
                      className={`w-full text-left px-4 py-3 flex items-center justify-between gap-2 hover:bg-white/[.04] ${
                        m.symbol === symbol ? 'bg-gold/10 border-l-2 border-gold-light' : ''
                      }`}
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <CoinAvatar symbol={m.symbol} className="w-7 h-7 shrink-0" title={m.symbol} />
                        <span className="font-bold text-white truncate">{m.baseAsset || m.base}/{m.quoteAsset || 'USDT'}</span>
                      </span>
                      <span className="flex items-center gap-1 text-xs font-mono">
                        {up ? <TrendingUp size={14} className="text-green-400" /> : <TrendingDown size={14} className="text-red-400" />}
                        <span className={up ? 'text-green-400' : 'text-red-400'}>{pct.toFixed(2)}%</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="xl:col-span-2 rounded-2xl border border-surface-border bg-surface-card p-4 sm:p-5 min-w-0">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
            <div>
              <p className="text-white/50 text-xs font-bold uppercase">Selected</p>
              <div className="flex items-center gap-3 mt-1">
                <CoinAvatar symbol={symbol} className="w-10 h-10" title={symbol} />
                <p className="text-2xl font-extrabold text-white font-mono">{symbol}</p>
              </div>
              {row && (
                <p className="text-gold-light font-mono text-lg mt-1">
                  {fmt(row.price, 8)}
                  <span className="text-white/45 text-sm ml-2">USDT</span>
                </p>
              )}
              {chg != null && (
                <p className={`text-sm font-bold mt-1 ${chg >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {chg >= 0 ? '+' : ''}{chg.toFixed(2)}% over visible range
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {INTERVALS.map(iv => (
                <button
                  key={iv.value}
                  type="button"
                  onClick={() => setBarInterval(iv.value)}
                  className={`px-4 py-2 rounded-xl text-sm font-bold border ${
                    barInterval === iv.value
                      ? 'border-gold/40 bg-gold/15 text-gold-light'
                      : 'border-surface-border text-white/75'
                  }`}
                >
                  {iv.label}
                </button>
              ))}
            </div>
          </div>

          {err && <p className="text-red-400 text-sm mb-3">{err}</p>}

          {loadingK ? (
            <div className="flex justify-center py-20">
              <div className="w-10 h-10 border-2 border-gold border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="rounded-xl border border-surface-border bg-surface-dark/50 p-3">
              <Sparkline values={closes} className="w-full h-40 md:h-52" width={600} height={200} />
              <p className="text-[11px] text-white/40 mt-2 text-center font-mono">
                Close price · {barInterval} · {closes.length} candles
              </p>
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-3 text-sm">
            <Link to="/analysis" className="text-gold-light font-bold hover:underline">Open analysis →</Link>
            <Link to="/trading" className="text-gold-light font-bold hover:underline">Platform trades →</Link>
          </div>
        </div>
      </div>
      ) : null}

      {subTab === 'pairs' ? (
      <AdminDataTable minWidth="1200px">
        <thead>
              <tr>
                <th>Pair</th>
                <th className="text-right">Last</th>
                <th className="text-right">24h %</th>
                <th className="text-right">24h High</th>
                <th className="text-right">24h Low</th>
                <th className="text-right">Volume</th>
                <th className="text-right">Quote Vol</th>
                <th className="text-right">Bid</th>
                <th className="text-right">Ask</th>
                <th className="text-right">Trades</th>
              </tr>
            </thead>
            <tbody>
              {loadingM ? (
                <tr><td colSpan={10} className="text-center text-white/45 !py-16">Loading markets…</td></tr>
              ) : filteredMarkets.length === 0 ? (
                <tr><td colSpan={10} className="text-center text-white/45 !py-16">No market rows</td></tr>
              ) : (
                filteredMarkets.map((m) => {
                  const pct = Number(m.priceChangePercent || 0);
                  return (
                    <tr key={m.symbol} className="cursor-pointer" onClick={() => setSymbol(m.symbol)}>
                      <td>
                        <div className="flex items-center gap-2">
                          <CoinAvatar symbol={m.symbol} className="w-8 h-8" title={m.symbol} />
                          <span className="font-mono font-bold text-gold-light/90">{m.symbol}</span>
                        </div>
                      </td>
                      <td className="text-right font-mono">{fmt(m.price, 8)}</td>
                      <td className={`text-right font-mono ${pct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
                      </td>
                      <td className="text-right font-mono">{fmt(m.highPrice, 8)}</td>
                      <td className="text-right font-mono">{fmt(m.lowPrice, 8)}</td>
                      <td className="text-right font-mono">{fmtVol(m.volume)}</td>
                      <td className="text-right font-mono">{fmtVol(m.quoteVolume)}</td>
                      <td className="text-right font-mono">{fmt(m.bidPrice, 8)}</td>
                      <td className="text-right font-mono">{fmt(m.askPrice, 8)}</td>
                      <td className="text-right font-mono">{fmt(m.count || 0, 0)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          
      </AdminDataTable>
      ) : null}

      {subTab === 'health' ? (
        <div className="rounded-2xl border border-surface-border bg-surface-card p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <span className={`inline-flex items-center rounded-md border px-2 py-1 text-xs font-bold ${health?.circuit_breaker?.open ? 'border-red-500/35 bg-red-500/15 text-red-300' : 'border-emerald-500/35 bg-emerald-500/15 text-emerald-300'}`}>
              Circuit breaker: {health?.circuit_breaker?.open ? 'OPEN' : 'CLOSED'}
            </span>
            <button
              type="button"
              disabled={savingControls}
              onClick={async () => {
                try {
                  setSavingControls(true);
                  const next = !Boolean(controls?.binance_kill_switch);
                  const r = await api.patchPlatformControls({ binance_kill_switch: next });
                  const j = await r.json().catch(() => ({}));
                  if (!r.ok) throw new Error(j.detail || 'Failed to toggle circuit breaker');
                  setControls(j);
                } catch (e) {
                  setErr(e.message || 'Failed to toggle circuit breaker');
                } finally {
                  setSavingControls(false);
                }
              }}
              className="rounded-lg border border-surface-border px-3 py-1.5 text-xs font-bold text-white/85"
            >
              {savingControls ? 'Saving…' : (controls?.binance_kill_switch ? 'Disable circuit breaker' : 'Enable circuit breaker')}
            </button>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {renderMeter('Spread p50 (bps)', health?.metrics?.spread_bps_p50, 50, 'amber')}
            {renderMeter('Spread p95 (bps)', health?.metrics?.spread_bps_p95, 100, 'red')}
            {renderMeter('Depth p50 (USD)', health?.metrics?.depth_usd_p50, 100000, 'cyan')}
            {renderMeter('Depth p95 (USD)', health?.metrics?.depth_usd_p95, 200000, 'cyan')}
            {renderMeter('Latency p95 (ms)', health?.metrics?.latency_p95_ms, Number(health?.thresholds?.latency_ms || 1000), 'amber')}
            {renderMeter('Fallback hit %', health?.metrics?.fallback_hit_pct, 100, 'red')}
          </div>
          <p className="text-xs text-white/50 mt-3">
            Dynamic bars use live values from liquidity health metrics and refresh when the page refreshes.
          </p>
        </div>
      ) : null}

      {subTab === 'fees' ? (
        <FeesCommissionsPanel />
      ) : null}
    </div>
  );
}
