import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Users, UserCheck, ArrowDownToLine, ArrowUpFromLine, Activity, Landmark,
  LineChart, BarChart3, ScrollText, Settings, DollarSign, Gauge, Filter,
  AlertCircle, RefreshCw,
} from 'lucide-react';
import { api, getStoredToken, adminWebSocketUrl } from '@/lib/api';
import { Sparkline } from '@/components/Sparkline';
import { useAdminAuth } from '@/context/AdminAuthContext';
import CoinAvatar from '@/components/CoinAvatar';
import { AdminPageHeader, AdminPanel, FilterBar } from '@/components/AdminPrimitives';

function fmtVol(n) {
  if (n == null || Number.isNaN(n)) return '0';
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function sumObjValues(obj) {
  if (!obj || typeof obj !== 'object') return 0;
  return Object.values(obj).reduce((s, v) => s + Number(v || 0), 0);
}

function Card({ to, icon: Icon, label, value, sub, color, tone = 'orange' }) {
  const toneMap = {
    blue: 'from-[#FE6C02]/18 to-transparent border-[#FE6C02]/30 hover:border-[#FE6C02]/45',
    green: 'from-[#00A876]/20 to-transparent border-[#00A876]/30 hover:border-[#00A876]/45',
    yellow: 'from-[#FE9D55]/18 to-transparent border-[#FE6C02]/30 hover:border-[#FE6C02]/45',
    red: 'from-[#EB5454]/20 to-transparent border-[#EB5454]/30 hover:border-[#EB5454]/45',
    purple: 'from-[#FE6C02]/15 to-transparent border-[#B44D01]/30 hover:border-[#FE6C02]/40',
    cyan: 'from-[#FE6C02]/18 to-transparent border-[#FE6C02]/30 hover:border-[#FE6C02]/45',
    orange: 'from-[#FE6C02]/20 to-transparent border-[#FE6C02]/30 hover:border-[#FE6C02]/45',
    neutral: 'from-white/10 to-transparent border-white/15 hover:border-white/30',
  };
  return (
    <Link
      to={to}
      className={`adm-card rounded-2xl border bg-gradient-to-br ${toneMap[tone] || toneMap.blue} p-4 sm:p-5 transition-colors block min-h-[96px] sm:min-h-[120px] min-w-0`}
    >
      <Icon size={22} className={`${color} mb-2 sm:mb-3 shrink-0`} />
      <p className="text-white/80 text-xs sm:text-sm font-semibold leading-snug line-clamp-2">{label}</p>
      <p className="text-xl sm:text-2xl font-extrabold text-white mt-1 font-mono leading-tight break-all">{value}</p>
      {sub && <p className="text-sm text-white/55 mt-1">{sub}</p>}
    </Link>
  );
}

export default function DashboardPage() {
  const { admin } = useAdminAuth();
  const [stats, setStats] = useState(null);
  const [flows, setFlows] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [err, setErr] = useState('');
  const [sparks, setSparks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);
  const [symbolInput, setSymbolInput] = useState('');
  const [symbolFilter, setSymbolFilter] = useState('');
  const [liquidityHealth, setLiquidityHealth] = useState(null);
  const [platformControls, setPlatformControls] = useState(null);
  const statsWsRef = useRef(null);

  useEffect(() => {
    let ok = true;
    setLoading(true);
    setErr('');
    Promise.all([
      api.stats().then(async r => {
        if (!r.ok) throw new Error('Failed to load stats');
        return r.json();
      }),
      api.statsFlows({ days: String(days) }).then(async r => {
        if (!r.ok) throw new Error('Failed to load treasury flows');
        return r.json();
      }),
      api.analytics({ days: String(days), ...(symbolFilter ? { symbol: symbolFilter } : {}) }).then(async r => {
        if (!r.ok) throw new Error('Failed to load analytics');
        return r.json();
      }),
      api.platformControls().then(async r => {
        if (!r.ok) throw new Error('Failed to load platform controls');
        return r.json();
      }),
      api.liquidityHealth().then(async r => {
        if (!r.ok) throw new Error('Failed to load liquidity health');
        return r.json();
      }),
    ])
      .then(([s, f, a, c, h]) => {
        if (!ok) return;
        setStats(s);
        setFlows(f);
        setAnalytics(a);
        setPlatformControls(c);
        setLiquidityHealth(h);
      })
      .catch(e => { if (ok) setErr(e.message); })
      .finally(() => { if (ok) setLoading(false); });
    return () => { ok = false; };
  }, [days, symbolFilter]);

  useEffect(() => {
    const token = getStoredToken();
    if (!token) return;
    const url = adminWebSocketUrl('/api/admin/ws/stats-overview');
    let closed = false;
    let reconnectTimer = null;
    const connect = () => {
      if (closed) return;
      try {
        const ws = new WebSocket(url);
        statsWsRef.current = ws;
        ws.onmessage = (ev) => {
          try {
            const j = JSON.parse(ev.data);
            if (j.type === 'stats_overview' && j.stats) {
              setStats(j.stats);
            }
          } catch {
            /* ignore */
          }
        };
        ws.onclose = () => {
          statsWsRef.current = null;
          if (!closed) reconnectTimer = window.setTimeout(connect, 5000);
        };
      } catch {
        if (!closed) reconnectTimer = window.setTimeout(connect, 5000);
      }
    };
    connect();
    return () => {
      closed = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (statsWsRef.current) {
        try {
          statsWsRef.current.close();
        } catch {
          /* ignore */
        }
        statsWsRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const pairs = ['BTCUSDT', 'ETHUSDT', 'IBOUSDT'];
    Promise.all(
      pairs.map(sym =>
        api.tradingKlines(sym, { interval: '4h', limit: '48' }).then(r => (r.ok ? r.json() : [])),
      ),
    ).then(rows => {
      if (cancelled) return;
      setSparks(
        pairs.map((sym, i) => ({
          sym,
          closes: (rows[i] || []).map(k => k.close),
        })),
      );
    }).catch(() => { if (!cancelled) setSparks([]); });
    return () => { cancelled = true; };
  }, []);

  const analyticsDaily = analytics?.daily || [];
  const maxTrade = Math.max(1, ...analyticsDaily.map(d => Number(d.trades || 0)));
  const maxVolume = Math.max(1, ...analyticsDaily.map(d => Number(d.volume_usdt || 0)));

  const flowDaily = useMemo(() => {
    const rows = flows?.days || [];
    return rows.map(d => ({
      date: d.date,
      dep: sumObjValues(d.deposits),
      wd: sumObjValues(d.withdrawals),
    }));
  }, [flows]);
  const maxFlow = Math.max(1, ...flowDaily.map(d => Math.max(d.dep, d.wd)));

  const volumeTrend = analyticsDaily.map(d => Number(d.volume_usdt || 0));
  const tradeTrend = analyticsDaily.map(d => Number(d.trades || 0));

  const isSuper = admin?.role === 'superadmin';
  const cbOpen = !!liquidityHealth?.circuit_breaker?.open;
  const p95 = liquidityHealth?.metrics?.latency_p95_ms;
  const latencyTh = liquidityHealth?.thresholds?.latency_ms;
  const binanceEnabled = !!platformControls?.binance_liquidity_enabled;
  const liquidityMode = String(platformControls?.liquidity_mode || 'HEDGE_ONLY');
  const killSwitch = !!platformControls?.binance_kill_switch;

  return (
    <div className="admin-page">
      <AdminPageHeader
        title="Dashboard"
        subtitle="Real-time exchange overview for onboarding, risk, treasury movement, and trading activity."
        badge="Live updates"
      />

      {err && <p className="text-red-400 text-sm mb-4">{err}</p>}

      {loading && !stats && !err && (
        <div className="flex justify-center py-20">
          <div className="w-10 h-10 border-2 border-gold border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {stats && (
        <>
          {/* KPI cards first */}
          <h2 className="text-base font-extrabold text-white mb-3">Key metrics</h2>
          <div className="grid grid-cols-1 min-[380px]:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-8">
            <Card to="/users" icon={Users} label="Total users" value={stats.users_total} color="text-[#FE9D55]" tone="orange" />
            <Card
              to="/users"
              icon={Users}
              label="New signups (7d)"
              value={stats.users_new_7d ?? 0}
              color="text-[#FE6C02]"
              tone="orange"
              sub="All registrations"
            />
            <Card to="/kyc" icon={UserCheck} label="Pending KYC" value={stats.kyc_pending} color="text-gold" tone="yellow" />
            <Card to="/deposits?status=pending" icon={ArrowDownToLine} label="Deposits pending" value={stats.deposits_pending} color="text-[#00A876]" tone="green" />
            <Card
              to="/settings"
              icon={RefreshCw}
              label="On-chain deposits (in flight)"
              value={stats.deposit_events_chain_inflight ?? 0}
              color="text-[#FE9D55]"
              tone="orange"
              sub="Phase 4: pending/confirming events — enable auto-credit in Settings"
            />
            <Card
              to="/deposit-events?status=pending_kyc"
              icon={AlertCircle}
              label="Deposit events (review)"
              value={stats.deposit_events_operator_attention ?? 0}
              color="text-gold-light"
              tone="yellow"
              sub="Phase 5: KYC / min / reorg — Deposit events page"
            />
            <Card to="/withdrawals?status=pending" icon={ArrowUpFromLine} label="Withdrawals pending" value={stats.withdrawals_pending} color="text-red-400" tone="red" />
            <Card
              to="/withdrawals?status=awaiting_treasury"
              icon={AlertCircle}
              label="Withdrawals waiting for payout wallet"
              value={stats.withdrawals_awaiting_treasury ?? 0}
              color="text-gold-light"
              tone="yellow"
              sub="Fix on Hot & cold wallets"
            />
            <Card to="/trading" icon={Activity} label="Trades (24h)" value={stats.trades_24h ?? 0} color="text-[#FE9D55]" tone="orange" />
            <Card to="/trading" icon={Activity} label="Spot trades (7d)" value={stats.trades_7d ?? 0} color="text-white/80" tone="neutral" />
            <Card to="/analysis?days=1" icon={Gauge} label="Trading volume (24h)" value={fmtVol(stats.platform_volume_24h)} color="text-emerald-400" tone="green" sub="In USDT" />
            <Card to="/analysis?days=7" icon={Gauge} label="Trading volume (7d)" value={fmtVol(stats.platform_volume_7d)} color="text-emerald-300/90" tone="green" sub="In USDT" />
            <Card
              to="/analysis?days=1"
              icon={DollarSign}
              label="Fee revenue USDT (24h)"
              value={stats.fee_revenue_usdt_24h ?? 0}
              color="text-green-400"
              tone="yellow"
            />
            <Card
              to="/analysis?days=7"
              icon={DollarSign}
              label="Fee revenue USDT (7d)"
              value={stats.fee_revenue_usdt_7d ?? 0}
              color="text-green-300"
              tone="yellow"
            />
            <Card to="/treasury" icon={Landmark} label="Fees collected" value="By coin" color="text-gold-light/90" tone="purple" sub="Treasury view" />
            <Card to="/audit" icon={ScrollText} label="Admin actions (7d)" value={stats.audit_events_7d ?? 0} color="text-white/70" tone="neutral" />
          </div>

          <AdminPanel
            title="Binance liquidity status"
            subtitle="Live operations state for Binance backstop routing and guardrails."
            className="mb-8"
          >
            <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
              <div className="rounded-xl border border-surface-border bg-surface-dark/40 p-3">
                <p className="text-[11px] text-white/55 uppercase">Enabled</p>
                <p className={`text-sm font-extrabold ${binanceEnabled ? 'text-emerald-300' : 'text-red-300'}`}>{binanceEnabled ? 'ON' : 'OFF'}</p>
              </div>
              <div className="rounded-xl border border-surface-border bg-surface-dark/40 p-3">
                <p className="text-[11px] text-white/55 uppercase">Liquidity mode</p>
                <p className="text-sm font-extrabold text-white">{liquidityMode}</p>
              </div>
              <div className="rounded-xl border border-surface-border bg-surface-dark/40 p-3">
                <p className="text-[11px] text-white/55 uppercase">Kill switch</p>
                <p className={`text-sm font-extrabold ${killSwitch ? 'text-red-300' : 'text-emerald-300'}`}>{killSwitch ? 'ACTIVE' : 'OFF'}</p>
              </div>
              <div className="rounded-xl border border-surface-border bg-surface-dark/40 p-3">
                <p className="text-[11px] text-white/55 uppercase">Circuit breaker</p>
                <p className={`text-sm font-extrabold ${cbOpen ? 'text-red-300' : 'text-emerald-300'}`}>{cbOpen ? 'OPEN' : 'CLOSED'}</p>
              </div>
              <div className="rounded-xl border border-surface-border bg-surface-dark/40 p-3">
                <p className="text-[11px] text-white/55 uppercase">Latency p95</p>
                <p className="text-sm font-extrabold text-white">{p95 != null ? `${p95} ms` : '—'}</p>
                <p className="text-[11px] text-white/50 mt-1">Threshold {latencyTh != null ? `${latencyTh} ms` : '—'}</p>
              </div>
            </div>
            <div className="mt-3 text-xs text-white/60">
              <Link to="/settings" className="text-[#8f3600] font-semibold hover:underline">Settings</Link>
              <span className="mx-1">|</span>
              <Link to="/liquidity-ops" className="text-[#8f3600] font-semibold hover:underline">Liquidity Operations</Link>
            </div>
          </AdminPanel>

          {/* analysis section second */}
          <FilterBar className="mb-8 min-w-0">
            <p className="text-base font-extrabold text-white mb-4 flex items-center gap-2">
              <Filter size={16} className="text-gold-light shrink-0" />
              Analytics filters
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <select
                value={String(days)}
                onChange={(e) => setDays(Number(e.target.value))}
                className="rounded-xl bg-surface-dark border border-surface-border px-4 py-3 text-white font-bold"
              >
                {[7, 14, 30, 60, 90].map(d => <option key={d} value={d}>Last {d} days</option>)}
              </select>
              <input
                value={symbolInput}
                onChange={(e) => setSymbolInput(e.target.value.toUpperCase())}
                placeholder="Symbol (optional, e.g. BTCUSDT)"
                className="rounded-xl bg-surface-dark border border-surface-border px-4 py-3 text-white font-mono"
              />
              <button
                type="button"
                onClick={() => setSymbolFilter(symbolInput.trim())}
                className="rounded-xl bg-gold/20 border border-gold/35 text-gold-light font-bold px-4 py-3"
              >
                Apply filter
              </button>
              <button
                type="button"
                onClick={() => { setSymbolInput(''); setSymbolFilter(''); }}
                className="rounded-xl border border-surface-border text-white/85 font-bold px-4 py-3"
              >
                Clear filter
              </button>
            </div>
          </FilterBar>

          <div className="grid lg:grid-cols-2 gap-4 sm:gap-5 mb-8 min-w-0">
            <AdminPanel title="Volume trend" subtitle="Total buy and sell notional (USDT) for the selected window" className="min-w-0">
              <p className="text-base font-extrabold text-white mb-3">Volume</p>
              <Sparkline values={volumeTrend} className="w-full h-24 sm:h-28" width={620} height={120} stroke="rgb(34,197,94)" fill="rgba(34,197,94,0.15)" />
              <p className="text-xs text-white/50 mt-2">
                Window total: <span className="font-mono text-emerald-300">{fmtVol(volumeTrend.reduce((s, v) => s + v, 0))}</span>
              </p>
            </AdminPanel>
            <AdminPanel title="Trade count trend" subtitle="Completed spot trades per day in the selected window" className="min-w-0">
              <p className="text-base font-extrabold text-white mb-3">Trade count</p>
              <Sparkline values={tradeTrend} className="w-full h-24 sm:h-28" width={620} height={120} stroke="rgb(34,211,238)" fill="rgba(34,211,238,0.14)" />
              <p className="text-xs text-white/50 mt-2">
                Window trades: <span className="font-mono text-[#FE9D55]">{tradeTrend.reduce((s, v) => s + v, 0).toLocaleString()}</span>
              </p>
            </AdminPanel>
          </div>

          <div className="grid lg:grid-cols-2 gap-4 sm:gap-5 mb-8 min-w-0">
            <div className="rounded-2xl border border-surface-border bg-surface-card p-4 sm:p-5 adm-table-x scrollbar-thin">
              <p className="text-base font-extrabold text-white mb-3">Daily activity bars</p>
              <div className="min-w-[560px] h-48 flex items-end gap-2">
                {analyticsDaily.length === 0 ? (
                  <p className="text-white/50">No data in selected window.</p>
                ) : analyticsDaily.map(d => (
                  <div key={d.date} className="flex-1 min-w-[8px]">
                    <div
                      className="w-full rounded-t bg-[#FE6C02]/75"
                      style={{ height: `${(Number(d.trades || 0) / maxTrade) * 70}%`, minHeight: Number(d.trades || 0) ? 4 : 0 }}
                      title={`${d.date} trades: ${d.trades}`}
                    />
                    <div
                      className="w-full rounded-t bg-emerald-400/70 mt-1"
                      style={{ height: `${(Number(d.volume_usdt || 0) / maxVolume) * 70}%`, minHeight: Number(d.volume_usdt || 0) ? 4 : 0 }}
                      title={`${d.date} volume: ${d.volume_usdt}`}
                    />
                  </div>
                ))}
              </div>
              <p className="text-sm text-white/65 mt-2">Purple bar height = trades that day. Green bar height = trading volume that day (USDT).</p>
            </div>

            <div className="rounded-2xl border border-surface-border bg-surface-card p-4 sm:p-5 adm-table-x scrollbar-thin">
              <p className="text-base font-extrabold text-white mb-3">Deposits and withdrawals by day</p>
              <div className="min-w-[560px] h-48 flex items-end gap-2">
                {flowDaily.length === 0 ? (
                  <p className="text-white/50">No approved flow data.</p>
                ) : flowDaily.map(d => (
                  <div key={d.date} className="flex-1 min-w-[8px]">
                    <div
                      className="w-full rounded-t bg-green-400/75"
                      style={{ height: `${(d.dep / maxFlow) * 75}%`, minHeight: d.dep ? 4 : 0 }}
                      title={`${d.date} deposits total: ${d.dep.toFixed(4)}`}
                    />
                    <div
                      className="w-full rounded-t bg-red-400/70 mt-1"
                      style={{ height: `${(d.wd / maxFlow) * 75}%`, minHeight: d.wd ? 4 : 0 }}
                      title={`${d.date} withdrawals total: ${d.wd.toFixed(4)}`}
                    />
                  </div>
                ))}
              </div>
              <p className="text-sm text-white/65 mt-2">Green = deposits approved that day. Red = withdrawals approved that day.</p>
            </div>
          </div>

          <div className="grid lg:grid-cols-2 gap-4 sm:gap-5 mb-8 min-w-0">
            <div className="rounded-2xl border border-surface-border bg-surface-card p-4 sm:p-5 min-w-0">
              <p className="text-base font-extrabold text-white mb-3">Fees by coin (this period)</p>
              <div className="space-y-2">
                {(analytics?.fees_period || []).length === 0 ? (
                  <p className="text-white/50">No fee rows.</p>
                ) : analytics.fees_period.map(row => (
                  <div key={row.asset} className="flex items-center justify-between rounded-lg border border-surface-border bg-surface-dark/50 px-3 py-2">
                    <span className="inline-flex items-center gap-2 font-bold text-white">
                      <CoinAvatar asset={row.asset} className="h-6 w-6" />
                      {row.asset}
                    </span>
                    <span className="font-mono text-gold-light">{row.total}</span>
                  </div>
                ))}
              </div>
            </div>
            <Link
              to="/markets"
              className="rounded-2xl border border-surface-border bg-surface-card p-4 sm:p-5 hover:border-gold/25 transition-colors block min-w-0"
            >
              <p className="text-base font-extrabold text-white mb-3">Sample market prices</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
                {sparks.map(({ sym, closes }) => (
                  <div key={sym} className="rounded-xl border border-surface-border/80 bg-surface-dark/40 p-3">
                    <p className="text-xs font-bold text-white/55 mb-2 font-mono inline-flex items-center gap-2">
                      <CoinAvatar symbol={sym} className="h-5 w-5" />
                      {sym}
                    </p>
                    <Sparkline values={closes} className="w-full h-16" width={280} height={64} />
                    <p className="text-sm text-white/55 mt-1">Last few hours</p>
                  </div>
                ))}
              </div>
            </Link>
          </div>

          <h2 className="text-sm font-extrabold text-white/45 uppercase tracking-widest mb-3">Shortcuts</h2>
          <div className="grid grid-cols-1 min-[380px]:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <Card to="/trading" icon={Activity} label="Trading activity" value={stats.trades_total ?? 0} color="text-[#FE9D55]" sub="All-time fills" />
            <Card to="/analysis" icon={BarChart3} label="Analytics" value="Open" color="text-[#FE6C02]" />
            <Card to="/audit" icon={ScrollText} label="Who changed what" value="Open" color="text-white/60" />
            {isSuper ? (
              <Card to="/settings" icon={Settings} label="Admin users" value="Settings" color="text-gold-light" />
            ) : (
              <div className="rounded-2xl border border-dashed border-surface-border bg-surface-card/50 p-5 flex items-center justify-center text-white/35 text-sm font-semibold">
                Settings (superadmin)
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
