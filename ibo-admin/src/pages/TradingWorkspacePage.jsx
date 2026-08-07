import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Activity, ClipboardList, Radio } from 'lucide-react';
import TradingActivityPage from '@/pages/TradingActivityPage';
import OrdersPage from '@/pages/OrdersPage';
import LivePositionsPage from '@/pages/LivePositionsPage';
import LiquidityOpsPage from '@/pages/LiquidityOpsPage';
import AlertsPage from '@/pages/AlertsPage';
import AuditPage from '@/pages/AuditPage';
import { api } from '@/lib/api';

const TABS = [
  { id: 'spot', label: 'Spot Trading', icon: Activity },
  { id: 'orders', label: 'Order Management', icon: ClipboardList },
  { id: 'positions', label: 'Live Risk Positions', icon: Radio },
];

export default function TradingWorkspacePage() {
  const [params, setParams] = useSearchParams();
  const active = useMemo(() => {
    const v = String(params.get('tab') || 'spot').toLowerCase();
    if (v === 'orders' || v === 'positions' || v === 'spot') return v;
    return 'spot';
  }, [params]);

  const setTab = (id) => {
    const p = new URLSearchParams(params);
    p.set('tab', id);
    setParams(p, { replace: true });
  };
  const [spotSummary, setSpotSummary] = useState({
    loading: true,
    activePairs: 0,
    volume24h: 0,
    openOrders: 0,
    riskAlerts: 0,
  });
  const [spotSection, setSpotSection] = useState('markets');
  const [spotMarketTab, setSpotMarketTab] = useState('pairs');
  const [marketRows, setMarketRows] = useState([]);
  const [marketSearch, setMarketSearch] = useState('');
  const [marketErr, setMarketErr] = useState('');
  const [pairModal, setPairModal] = useState({ open: false, mode: 'create', pair: null });
  const [pairForm, setPairForm] = useState({ symbol: '', base_asset: '', quote_asset: 'USDT', maker_fee_rate: '0.001', taker_fee_rate: '0.001', is_active: true });
  const [orderbookSymbol, setOrderbookSymbol] = useState('BTCUSDT');
  const [orderbook, setOrderbook] = useState({ bids: [], asks: [], updated_at: '' });
  const [orderbookLoading, setOrderbookLoading] = useState(false);
  const [health, setHealth] = useState(null);
  const [controls, setControls] = useState(null);
  const [feesStats, setFeesStats] = useState([]);
  const [savingControls, setSavingControls] = useState(false);
  const [opsLastUpdated, setOpsLastUpdated] = useState('');
  const [feeForm, setFeeForm] = useState({
    maker_fee_rate: '',
    taker_fee_rate: '',
    withdraw_fee_rate: '',
    withdraw_gas_fee_ibo: '',
  });

  useEffect(() => {
    if (active !== 'spot') return;
    let mounted = true;
    async function loadSpotSummary() {
      try {
        setSpotSummary((s) => ({ ...s, loading: true }));
        const [ordersRes, positionsRes, tradesRes] = await Promise.all([
          api.orders({ skip: '0', limit: '1', status: 'open,partially_filled' }),
          api.livePositions({ skip: '0', limit: '1' }),
          api.recentTrades({ skip: '0', limit: '1' }),
        ]);
        const [ordersJson, positionsJson, tradesJson, marketsJson, alertsJson] = await Promise.all([
          ordersRes.json().catch(() => ({})),
          positionsRes.json().catch(() => ({})),
          tradesRes.json().catch(() => ({})),
          api.tradingMarkets().then((r) => (r.ok ? r.json() : [])),
          api.alertsStats().then((r) => (r.ok ? r.json() : {})),
        ]);
        if (!mounted) return;
        const markets = Array.isArray(marketsJson) ? marketsJson : [];
        const activePairs = markets.filter((m) => m?.is_active !== false).length;
        const volume24h = Number(tradesJson?.stats?.notional_usdt_total || 0);
        const riskAlerts = Number(alertsJson?.open?.total || 0);
        setSpotSummary({
          loading: false,
          activePairs,
          volume24h,
          openOrders: Number(ordersJson.total || 0),
          riskAlerts: riskAlerts + Math.max(0, Number(positionsJson.total || 0)),
        });
      } catch {
        if (!mounted) return;
        setSpotSummary({
          loading: false,
          activePairs: 0,
          volume24h: 0,
          openOrders: 0,
          riskAlerts: 0,
        });
      }
    }
    loadSpotSummary();
    return () => { mounted = false; };
  }, [active]);

  useEffect(() => {
    if (active !== 'spot') return;
    let alive = true;
    api.adminMarketPairs()
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => {
        if (!alive) return;
        const list = Array.isArray(rows?.items) ? rows.items : [];
        setMarketRows(list);
        if (list.length && !list.some((m) => String(m.symbol) === orderbookSymbol)) {
          setOrderbookSymbol(String(list[0].symbol || 'BTCUSDT'));
        }
      })
      .catch(() => { if (alive) setMarketRows([]); });
    return () => { alive = false; };
  }, [active]);

  useEffect(() => {
    if (active !== 'spot' || spotSection !== 'markets') return;
    let alive = true;
    const loadOps = async () => {
      try {
        const [h, c, feeRes] = await Promise.all([
          api.liquidityHealth().then((r) => (r.ok ? r.json() : null)),
          api.platformControls().then((r) => (r.ok ? r.json() : null)),
          api.statsFees().then((r) => (r.ok ? r.json() : {})),
        ]);
        if (!alive) return;
        setHealth(h);
        setControls(c);
        setFeesStats(Array.isArray(feeRes?.by_asset) ? feeRes.by_asset : []);
        setOpsLastUpdated(new Date().toLocaleTimeString());
        if (c && !savingControls) {
          setFeeForm({
            maker_fee_rate: String(c.maker_fee_rate ?? 0.001),
            taker_fee_rate: String(c.taker_fee_rate ?? 0.001),
            withdraw_fee_rate: String(c.withdraw_fee_rate ?? 0),
            withdraw_gas_fee_ibo: String(c.withdraw_gas_fee_ibo ?? 0),
          });
        }
      } catch {
        if (!alive) return;
        setHealth(null);
        setControls(null);
        setFeesStats([]);
        setMarketErr('Live data refresh failed. Please check backend/API connectivity.');
      }
    };
    loadOps();
    const t = setInterval(loadOps, 5000);
    return () => { alive = false; clearInterval(t); };
  }, [active, spotSection, savingControls]);

  useEffect(() => {
    if (active !== 'spot' || spotSection !== 'orderbook') return;
    let alive = true;
    const run = async () => {
      setOrderbookLoading(true);
      try {
        const r = await api.tradingOrderbook(orderbookSymbol, { limit: '20' });
        const j = await r.json().catch(() => ({}));
        if (!alive) return;
        if (!r.ok) throw new Error();
        setOrderbook({
          bids: Array.isArray(j.bids) ? j.bids : [],
          asks: Array.isArray(j.asks) ? j.asks : [],
          updated_at: j.updated_at || '',
        });
      } catch {
        if (!alive) return;
        setOrderbook({ bids: [], asks: [], updated_at: '' });
      } finally {
        if (alive) setOrderbookLoading(false);
      }
    };
    run();
    const t = setInterval(run, 3000);
    return () => { alive = false; clearInterval(t); };
  }, [active, spotSection, orderbookSymbol]);

  const visibleMarkets = useMemo(() => {
    const q = marketSearch.trim().toUpperCase();
    if (!q) return marketRows;
    return marketRows.filter((m) => String(m.symbol || '').toUpperCase().includes(q));
  }, [marketRows, marketSearch]);

  const openCreatePair = () => {
    setPairForm({ symbol: '', base_asset: '', quote_asset: 'USDT', maker_fee_rate: '0.001', taker_fee_rate: '0.001', is_active: true });
    setPairModal({ open: true, mode: 'create', pair: null });
  };
  const openEditPair = (p) => {
    setPairForm({
      symbol: p.symbol || '',
      base_asset: p.base_asset || '',
      quote_asset: p.quote_asset || 'USDT',
      maker_fee_rate: String(p.maker_fee_rate ?? 0.001),
      taker_fee_rate: String(p.taker_fee_rate ?? 0.001),
      is_active: p.is_active !== false,
    });
    setPairModal({ open: true, mode: 'edit', pair: p });
  };

  const isCircuitBreakerOpen = Boolean(controls?.binance_kill_switch) || Boolean(health?.circuit_breaker?.open) || Boolean(health?.controls?.binance_kill_switch);

  return (
    <div className="admin-page">
      <h1 className="admin-title mb-2 flex items-center gap-2">
        <Activity className="text-cyan-400 shrink-0" size={28} />
        Spot Trading
      </h1>
      <p className="admin-page-lead mb-6">
        Unified trading operations workspace for trades, orders, and live risk positions.
      </p>

      {active === 'spot' ? (
        <div className="mb-5 adm-table-x scrollbar-thin">
          <div className="flex gap-3 min-w-[920px]">
            <SpotKpi
              label="Active pairs"
              value={spotSummary.loading ? '—' : String(spotSummary.activePairs)}
              tone="cyan"
            />
            <SpotKpi
              label="24h volume"
              value={spotSummary.loading ? '—' : spotSummary.volume24h.toFixed(4)}
              tone="green"
              mono
            />
            <SpotKpi
              label="Open orders"
              value={spotSummary.loading ? '—' : String(spotSummary.openOrders)}
              tone="blue"
            />
            <SpotKpi
              label="Risk alerts"
              value={spotSummary.loading ? '—' : String(spotSummary.riskAlerts)}
              tone="yellow"
            />
          </div>
        </div>
      ) : null}

      <div className="mb-6 adm-table-x scrollbar-thin">
        <div className="admin-tabs w-max min-w-full">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`admin-tab-btn shrink-0 ${active === id ? 'active' : ''}`}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </div>
      </div>

      {active === 'spot' ? (
        <>
          <div className="mb-5 adm-table-x scrollbar-thin">
            <div className="inline-flex min-w-full rounded-2xl border border-surface-border/80 bg-surface-card/70 p-1.5 backdrop-blur-sm">
              {[
                ['markets', 'Markets'],
                ['orderbook', 'Order Book (Live)'],
                ['orders', 'Orders'],
                ['trades', 'Trades'],
                ['liquidity', 'Liquidity'],
                ['risk_alerts', 'Risk & Alerts'],
                ['audit_logs', 'Audit Logs'],
              ].map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setSpotSection(id)}
                  className={`shrink-0 rounded-xl px-4 py-2.5 text-sm font-bold transition-colors ${
                    spotSection === id
                      ? 'bg-gold/20 text-gold-light border border-gold/30'
                      : 'text-white/70 hover:text-white hover:bg-white/[.05] border border-transparent'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="mb-3 text-xs text-white/55">
            Spot Trading shows operational trading overview (orders + positions + trade flow), while `Liquidity Activity` focuses on counterparty liquidity trace.
          </div>
          {spotSection === 'markets' ? (
            <div className="rounded-2xl border border-surface-border/90 bg-gradient-to-br from-surface-card to-surface-card/80 p-4 sm:p-5 shadow-[0_8px_30px_rgba(0,0,0,0.25)]">
              <div className="mb-3 adm-table-x scrollbar-thin">
                <div className="inline-flex min-w-full rounded-xl border border-surface-border/80 bg-surface-dark/40 p-1">
                  {[
                    ['pairs', 'All Pairs'],
                    ['health', 'Market Health'],
                    ['fees', 'Fees & Commissions'],
                  ].map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setSpotMarketTab(id)}
                      className={`shrink-0 rounded-lg px-3 py-2 text-xs sm:text-sm font-bold transition-colors ${
                        spotMarketTab === id
                          ? 'bg-cyan-500/15 text-cyan-200 border border-cyan-400/30'
                          : 'text-white/65 hover:text-white hover:bg-white/[.05] border border-transparent'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {spotMarketTab === 'pairs' ? (
                <>
              <div className="flex items-center justify-between gap-3 mb-3">
                <input
                  value={marketSearch}
                  onChange={(e) => setMarketSearch(e.target.value)}
                  placeholder="Search pair"
                  className="rounded-xl bg-surface-dark/80 border border-surface-border px-4 py-2.5 text-white text-sm font-mono focus:border-gold/45 outline-none"
                />
                <button
                  type="button"
                  onClick={openCreatePair}
                  className="rounded-xl border border-gold/35 bg-gold/15 px-3 py-2 text-sm font-bold text-gold-light hover:bg-gold/20"
                >
                  New Pair
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      setMarketErr('');
                      const r = await api.adminMarketPairs();
                      const rows = await r.json().catch(() => ({}));
                      if (!r.ok) throw new Error('Markets refresh failed');
                      setMarketRows(Array.isArray(rows?.items) ? rows.items : []);
                    } catch (e) {
                      setMarketErr(e.message || 'Markets refresh failed');
                    }
                  }}
                  className="rounded-xl border border-surface-border px-3 py-2 text-sm font-bold text-white/85 hover:bg-white/[.05]"
                >
                  Refresh
                </button>
              </div>
              {marketErr ? <p className="text-red-300 text-xs mb-2">{marketErr}</p> : null}
              <div className="adm-table-x scrollbar-thin">
                <table className="w-full min-w-[760px] text-sm">
                  <thead>
                    <tr className="text-left text-[11px] font-extrabold text-white/50 uppercase tracking-wider border-b border-surface-border">
                      <th className="px-3 py-2">Pair</th>
                      <th className="px-3 py-2 text-right">Price</th>
                      <th className="px-3 py-2 text-right">24h Vol</th>
                      <th className="px-3 py-2 text-right">Maker Fee</th>
                      <th className="px-3 py-2 text-right">Taker Fee</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleMarkets.map((m) => (
                      <tr key={m.symbol} className="border-b border-surface-border/60 hover:bg-white/[.03] transition-colors">
                        <td className="px-3 py-2 font-mono text-gold-light/90">{m.symbol}</td>
                        <td className="px-3 py-2 text-right font-mono">{Number(m.price || 0).toFixed(8)}</td>
                        <td className="px-3 py-2 text-right font-mono">{Number(m.quoteVolume || 0).toFixed(2)}</td>
                        <td className="px-3 py-2 text-right font-mono text-emerald-300">{Number(m.maker_fee_rate || 0).toFixed(6)}</td>
                        <td className="px-3 py-2 text-right font-mono text-cyan-300">{Number(m.taker_fee_rate || 0).toFixed(6)}</td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-bold border ${m.is_active !== false ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' : 'bg-red-500/15 text-red-300 border-red-500/30'}`}>
                            {m.is_active !== false ? 'active' : 'inactive'}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            onClick={() => openEditPair(m)}
                            className="text-xs font-bold text-gold-light hover:underline"
                          >
                            Edit pair
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
                </>
              ) : null}
              {spotMarketTab === 'health' ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`inline-flex items-center rounded-md border px-2 py-1 text-xs font-bold ${isCircuitBreakerOpen ? 'border-red-500/35 bg-red-500/15 text-red-300' : 'border-emerald-500/35 bg-emerald-500/15 text-emerald-300'}`}>
                      Circuit breaker: {isCircuitBreakerOpen ? 'OPEN' : 'CLOSED'}
                    </span>
                    <span className="inline-flex items-center rounded-md border border-surface-border px-2 py-1 text-xs font-bold text-white/75">
                      Live updated: {opsLastUpdated || '—'}
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
                          setMarketErr(e.message || 'Failed to toggle circuit breaker');
                        } finally {
                          setSavingControls(false);
                        }
                      }}
                      className="rounded-lg border border-surface-border px-3 py-1.5 text-xs font-bold text-white/85 hover:bg-white/[.05]"
                    >
                      {savingControls ? 'Saving…' : (controls?.binance_kill_switch ? 'Disable circuit breaker' : 'Enable circuit breaker')}
                    </button>
                  </div>
                  <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <MetricBox label="Spread bps p50" value={health?.metrics?.spread_bps_p50} />
                    <MetricBox label="Spread bps p95" value={health?.metrics?.spread_bps_p95} />
                    <MetricBox label="Depth USD p50" value={health?.metrics?.depth_usd_p50} />
                    <MetricBox label="Depth USD p95" value={health?.metrics?.depth_usd_p95} />
                    <MetricBox label="Latency p95 (ms)" value={health?.metrics?.latency_p95_ms} />
                    <MetricBox label="Fallback hit %" value={health?.metrics?.fallback_hit_pct} />
                    <MetricBox label="Circuit breaker" value={isCircuitBreakerOpen ? 'OPEN' : 'CLOSED'} />
                    <MetricBox label="Mode" value={health?.liquidity_mode || '—'} />
                  </div>
                </div>
              ) : null}
              {spotMarketTab === 'fees' ? (
                <div className="space-y-4">
                  <div className="rounded-xl border border-surface-border bg-surface-dark/40 p-4 shadow-[0_6px_18px_rgba(0,0,0,0.2)]">
                    <p className="text-sm font-bold text-white mb-1">Edit fees</p>
                    <p className="text-xs text-white/55 mb-3">Fees are global and apply to all pairs.</p>
                    <div className="space-y-3">
                      <label className="block text-xs text-white/70">
                        Maker fee rate
                          <input value={feeForm.maker_fee_rate} onChange={(e) => setFeeForm((v) => ({ ...v, maker_fee_rate: e.target.value }))} className="mt-1 w-full rounded-lg bg-surface-dark border border-surface-border px-3 py-2 text-white font-mono focus:border-gold/45 outline-none" />
                      </label>
                      <label className="block text-xs text-white/70">
                        Taker fee rate
                          <input value={feeForm.taker_fee_rate} onChange={(e) => setFeeForm((v) => ({ ...v, taker_fee_rate: e.target.value }))} className="mt-1 w-full rounded-lg bg-surface-dark border border-surface-border px-3 py-2 text-white font-mono focus:border-gold/45 outline-none" />
                      </label>
                      <label className="block text-xs text-white/70">
                        Withdraw fee rate
                          <input value={feeForm.withdraw_fee_rate} onChange={(e) => setFeeForm((v) => ({ ...v, withdraw_fee_rate: e.target.value }))} className="mt-1 w-full rounded-lg bg-surface-dark border border-surface-border px-3 py-2 text-white font-mono focus:border-gold/45 outline-none" />
                      </label>
                      <label className="block text-xs text-white/70">
                        Gas fee (IBO per withdrawal)
                          <input value={feeForm.withdraw_gas_fee_ibo} onChange={(e) => setFeeForm((v) => ({ ...v, withdraw_gas_fee_ibo: e.target.value }))} className="mt-1 w-full rounded-lg bg-surface-dark border border-surface-border px-3 py-2 text-white font-mono focus:border-gold/45 outline-none" />
                      </label>
                      <button
                        type="button"
                        disabled={savingControls}
                        onClick={async () => {
                          try {
                            setSavingControls(true);
                            const payload = {
                              maker_fee_rate: Number(feeForm.maker_fee_rate),
                              taker_fee_rate: Number(feeForm.taker_fee_rate),
                              withdraw_fee_rate: Number(feeForm.withdraw_fee_rate),
                              withdraw_gas_fee_ibo: Number(feeForm.withdraw_gas_fee_ibo),
                            };
                            const r = await api.patchPlatformControls(payload);
                            const j = await r.json().catch(() => ({}));
                            if (!r.ok) throw new Error(j.detail || 'Fee update failed');
                            setControls(j);
                          } catch (e) {
                            setMarketErr(e.message || 'Fee update failed');
                          } finally {
                            setSavingControls(false);
                          }
                        }}
                        className="rounded-lg border border-gold/35 bg-gold/15 px-4 py-2 text-sm font-bold text-gold-light hover:bg-gold/20"
                      >
                        {savingControls ? 'Saving…' : 'Save fee settings'}
                      </button>
                    </div>
                  </div>
                  <div className="rounded-xl border border-surface-border bg-surface-dark/40 p-4 shadow-[0_6px_18px_rgba(0,0,0,0.2)]">
                    <p className="text-sm font-bold text-white mb-3">All pairs with fees</p>
                    <div className="adm-table-x scrollbar-thin">
                      <table className="w-full min-w-[760px] text-sm">
                        <thead>
                          <tr className="text-left text-[11px] font-extrabold text-white/50 uppercase tracking-wider border-b border-surface-border">
                            <th className="px-3 py-2">Pair</th>
                            <th className="px-3 py-2">Status</th>
                            <th className="px-3 py-2 text-right">Maker fee</th>
                            <th className="px-3 py-2 text-right">Taker fee</th>
                            <th className="px-3 py-2 text-right">Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {marketRows.length === 0 ? (
                            <tr><td colSpan={5} className="px-3 py-8 text-center text-white/45">No pairs available.</td></tr>
                          ) : marketRows.map((m) => (
                            <tr key={m.symbol} className="border-b border-surface-border/50">
                              <td className="px-3 py-2 font-mono text-gold-light/90">{m.symbol}</td>
                              <td className="px-3 py-2">
                                <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-bold border ${m.is_active !== false ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' : 'bg-red-500/15 text-red-300 border-red-500/30'}`}>
                                  {m.is_active !== false ? 'active' : 'inactive'}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-right font-mono">{Number(feeForm.maker_fee_rate || 0).toFixed(6)}</td>
                              <td className="px-3 py-2 text-right font-mono">{Number(feeForm.taker_fee_rate || 0).toFixed(6)}</td>
                              <td className="px-3 py-2 text-right">
                                <button
                                  type="button"
                                  onClick={() => setSpotMarketTab('fees')}
                                  className="text-xs font-bold text-gold-light hover:underline"
                                >
                                  Edit fees
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <div className="rounded-xl border border-surface-border bg-surface-dark/40 p-4">
                    <p className="text-sm font-bold text-white mb-3">Real-time fee totals by asset</p>
                    <div className="space-y-2">
                      {feesStats.length === 0 ? (
                        <p className="text-white/50 text-sm">No fee records available.</p>
                      ) : feesStats.map((r) => (
                        <div key={r.asset} className="flex items-center justify-between rounded-lg border border-surface-border px-3 py-2">
                          <span className="text-white/80 font-semibold">{r.asset}</span>
                          <span className="font-mono text-emerald-300">{Number(r.total || 0).toFixed(8)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
          {spotSection === 'orderbook' ? (
            <div className="rounded-2xl border border-surface-border bg-surface-card p-4">
              <div className="flex items-center justify-between gap-3 mb-3">
                <select
                  value={orderbookSymbol}
                  onChange={(e) => setOrderbookSymbol(e.target.value)}
                  className="rounded-xl bg-surface-dark border border-surface-border px-4 py-2.5 text-white text-sm font-mono"
                >
                  {marketRows.map((m) => <option key={m.symbol} value={m.symbol}>{m.symbol}</option>)}
                </select>
                <p className="text-xs text-white/55">{orderbook.updated_at ? `Updated ${new Date(orderbook.updated_at).toLocaleTimeString()}` : 'Waiting live feed…'}</p>
              </div>
              {orderbookLoading ? <p className="text-white/60 text-sm">Loading order book…</p> : null}
              <div className="grid md:grid-cols-2 gap-3">
                <OrderBookTable title="Bids" rows={orderbook.bids} tone="green" />
                <OrderBookTable title="Asks" rows={orderbook.asks} tone="red" />
              </div>
            </div>
          ) : null}
          {spotSection === 'orders' ? <OrdersPage embedded compact /> : null}
          {spotSection === 'trades' ? <TradingActivityPage embedded /> : null}
          {spotSection === 'liquidity' ? <LiquidityOpsPage /> : null}
          {spotSection === 'risk_alerts' ? <AlertsPage /> : null}
          {spotSection === 'audit_logs' ? <AuditPage /> : null}
        </>
      ) : null}
      {active === 'orders' ? <OrdersPage embedded /> : null}
      {active === 'positions' ? <LivePositionsPage embedded /> : null}

      {pairModal.open ? (
        <div className="fixed inset-0 z-[120] bg-black/70 backdrop-blur-sm p-4 flex items-center justify-center" onClick={() => setPairModal({ open: false, mode: 'create', pair: null })}>
          <div className="w-full max-w-md rounded-2xl border border-surface-border bg-surface-card p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-extrabold text-white mb-3">{pairModal.mode === 'create' ? 'Create Pair' : 'Edit Pair'}</h3>
            <div className="space-y-3">
              <input value={pairForm.symbol} onChange={(e) => setPairForm((v) => ({ ...v, symbol: e.target.value.toUpperCase() }))} placeholder="Symbol (e.g. BTCUSDT)" disabled={pairModal.mode === 'edit'} className="w-full rounded-xl bg-surface-dark border border-surface-border px-4 py-2.5 text-white font-mono disabled:opacity-60" />
              <div className="grid grid-cols-2 gap-2">
                <input value={pairForm.base_asset} onChange={(e) => setPairForm((v) => ({ ...v, base_asset: e.target.value.toUpperCase() }))} placeholder="Base" className="rounded-xl bg-surface-dark border border-surface-border px-3 py-2.5 text-white font-mono" />
                <input value={pairForm.quote_asset} onChange={(e) => setPairForm((v) => ({ ...v, quote_asset: e.target.value.toUpperCase() }))} placeholder="Quote" className="rounded-xl bg-surface-dark border border-surface-border px-3 py-2.5 text-white font-mono" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input value={pairForm.maker_fee_rate} onChange={(e) => setPairForm((v) => ({ ...v, maker_fee_rate: e.target.value }))} placeholder="Maker fee" className="rounded-xl bg-surface-dark border border-surface-border px-3 py-2.5 text-white font-mono" />
                <input value={pairForm.taker_fee_rate} onChange={(e) => setPairForm((v) => ({ ...v, taker_fee_rate: e.target.value }))} placeholder="Taker fee" className="rounded-xl bg-surface-dark border border-surface-border px-3 py-2.5 text-white font-mono" />
              </div>
              <label className="inline-flex items-center gap-2 text-sm text-white/80">
                <input type="checkbox" checked={pairForm.is_active} onChange={(e) => setPairForm((v) => ({ ...v, is_active: e.target.checked }))} />
                Active pair
              </label>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const body = {
                        symbol: pairForm.symbol.trim(),
                        base_asset: pairForm.base_asset.trim(),
                        quote_asset: pairForm.quote_asset.trim() || 'USDT',
                        maker_fee_rate: Number(pairForm.maker_fee_rate),
                        taker_fee_rate: Number(pairForm.taker_fee_rate),
                        is_active: Boolean(pairForm.is_active),
                      };
                      const r = pairModal.mode === 'create'
                        ? await api.createMarketPair(body)
                        : await api.patchMarketPair(body.symbol, {
                            maker_fee_rate: body.maker_fee_rate,
                            taker_fee_rate: body.taker_fee_rate,
                            is_active: body.is_active,
                          });
                      const j = await r.json().catch(() => ({}));
                      if (!r.ok) throw new Error(j.detail || 'Failed to save pair');
                      const listRes = await api.adminMarketPairs();
                      const listJson = await listRes.json().catch(() => ({}));
                      if (listRes.ok) setMarketRows(Array.isArray(listJson?.items) ? listJson.items : []);
                      setPairModal({ open: false, mode: 'create', pair: null });
                    } catch (e) {
                      setMarketErr(e.message || 'Failed to save pair');
                    }
                  }}
                  className="flex-1 rounded-xl border border-gold/35 bg-gold/15 py-2.5 font-bold text-gold-light"
                >
                  Save
                </button>
                <button type="button" onClick={() => setPairModal({ open: false, mode: 'create', pair: null })} className="flex-1 rounded-xl border border-surface-border py-2.5 font-bold text-white/85">Cancel</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SpotKpi({ label, value, tone = 'blue', mono = false }) {
  const tones = {
    blue: 'from-[#FE6C02]/35 via-[#E76202]/18 border-[#FE6C02]/45 shadow-[0_0_36px_rgba(254,108,2,0.2)]',
    cyan: 'from-[#FE9D55]/35 via-[#FE6C02]/18 border-[#FE6C02]/45 shadow-[0_0_36px_rgba(254,108,2,0.2)]',
    yellow: 'from-[#FE9D55]/35 via-[#B44D01]/18 border-[#FE6C02]/45 shadow-[0_0_36px_rgba(254,108,2,0.2)]',
    green: 'from-[#00A876]/35 via-[#00A876]/18 border-[#00A876]/45 shadow-[0_0_36px_rgba(0,168,118,0.2)]',
  };
  return (
    <div className={`relative overflow-hidden rounded-xl border bg-gradient-to-br to-transparent p-4 flex-1 min-w-[210px] transition-transform duration-200 hover:-translate-y-0.5 hover:scale-[1.01] ${tones[tone] || tones.blue}`}>
      <div className="pointer-events-none absolute -top-8 -right-8 h-24 w-24 rounded-full bg-white/10 blur-2xl" />
      <p className="text-xs font-bold uppercase tracking-wide text-white/70">{label}</p>
      <p className={`text-2xl font-extrabold text-white mt-1 drop-shadow-[0_1px_10px_rgba(0,0,0,0.45)] ${mono ? 'font-mono text-lg' : ''}`}>{value}</p>
    </div>
  );
}

function MetricBox({ label, value }) {
  const val = value == null || value === '' ? '—' : String(value);
  return (
    <div className="rounded-xl border border-surface-border bg-surface-dark/50 p-3">
      <p className="text-[11px] font-bold uppercase tracking-wide text-white/55">{label}</p>
      <p className="text-lg font-extrabold text-white mt-1 font-mono">{val}</p>
    </div>
  );
}

function OrderBookTable({ title, rows, tone }) {
  const toneCls = tone === 'green' ? 'text-emerald-300' : 'text-red-300';
  return (
    <div className="rounded-xl border border-surface-border bg-surface-dark/50 overflow-hidden">
      <p className={`px-3 py-2 text-xs font-extrabold uppercase tracking-wide border-b border-surface-border ${toneCls}`}>{title}</p>
      <div className="adm-table-x scrollbar-thin">
        <table className="w-full min-w-[300px] text-xs">
          <thead>
            <tr className="text-white/55 border-b border-surface-border/60">
              <th className="px-3 py-2 text-left">Price</th>
              <th className="px-3 py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {(rows || []).slice(0, 20).map((r, i) => (
              <tr key={`${title}-${i}`} className="border-b border-surface-border/40">
                <td className="px-3 py-1.5 font-mono">{Number(r?.[0] || 0).toFixed(8)}</td>
                <td className="px-3 py-1.5 text-right font-mono">{Number(r?.[1] || 0).toFixed(8)}</td>
              </tr>
            ))}
            {(!rows || rows.length === 0) ? (
              <tr><td colSpan={2} className="px-3 py-4 text-white/45 text-center">No rows.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
