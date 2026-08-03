import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Radio } from 'lucide-react';
import { getStoredToken, adminWsPath } from '@/lib/api';
import { useListSort } from '@/lib/useListSort';
import SortableTh from '@/components/SortableTh';
import UserUidSuggestInput from '@/components/UserUidSuggestInput';
import CoinAvatar from '@/components/CoinAvatar';

function StatChip({ label, children, className = '', tone = 'neutral' }) {
  const toneMap = {
    neutral: 'border-surface-border bg-surface-dark/40',
    blue: 'border-[#3B82F6]/28 bg-[#3B82F6]/10',
    cyan: 'border-[#22D3EE]/28 bg-[#22D3EE]/10',
    green: 'border-[#0ECB81]/28 bg-[#0ECB81]/10',
    yellow: 'border-[#0EA4AB]/28 bg-[#0EA4AB]/10',
    rose: 'border-[#F6465D]/28 bg-[#F6465D]/10',
  };
  return (
    <div className={`rounded-xl border px-3 py-2 min-w-0 ${toneMap[tone] || toneMap.neutral} ${className}`}>
      <p className="text-[10px] font-extrabold text-white/45 uppercase tracking-wider">{label}</p>
      <div className="text-sm mt-0.5 break-all">{children}</div>
    </div>
  );
}

function LivePositionCard({ p }) {
  const upnl = Number(p.unrealized_pnl || 0);
  const upnlPct = Number(p.unrealized_pnl_pct || 0);
  const sideBuy = p.last_fill_side && String(p.last_fill_side).toLowerCase() === 'buy';

  return (
    <article className="rounded-2xl border border-surface-border bg-surface-card p-4 shadow-sm space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-white font-semibold leading-tight break-words">{p.user_name || p.user_email || p.uid}</p>
          <p className="text-white/50 text-[11px] font-mono mt-1 break-all">{p.uid}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0 text-right">
          <CoinAvatar symbol={p.symbol} className="w-9 h-9 shrink-0" title={p.symbol} />
          <span className="font-mono font-bold text-gold-light text-sm">{p.symbol}</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center rounded-lg bg-emerald-500/15 text-emerald-300 text-[10px] font-extrabold px-2 py-1 uppercase tracking-wide">
          Spot · Long
        </span>
      </div>

      <div className="rounded-xl bg-white/[.03] border border-surface-border/60 p-3 space-y-1.5">
        <p className="text-[10px] font-extrabold text-white/40 uppercase tracking-wider">Last fill</p>
        {p.last_fill_side ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-md ${
                  sideBuy ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                }`}
              >
                {sideBuy ? 'Buy' : 'Sell'}
              </span>
              <span className="text-white font-mono text-xs">
                {Number(p.last_fill_amount ?? 0).toFixed(8)} @ {Number(p.last_fill_price ?? 0).toFixed(8)}
              </span>
            </div>
            <p className="text-white/45 text-[10px] font-mono">
              {p.last_fill_at ? new Date(p.last_fill_at).toLocaleString() : '—'}
            </p>
          </>
        ) : (
          <span className="text-white/40 text-xs">No fills (e.g. deposit only)</span>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
        <StatChip label="Buy / sell (life)">
          <span className="font-mono text-green-400/90">+{Number(p.lifetime_buy_qty ?? 0).toFixed(8)}</span>
          <span className="text-white/35 mx-0.5">/</span>
          <span className="font-mono text-red-400/90">−{Number(p.lifetime_sell_qty ?? 0).toFixed(8)}</span>
          <p className="text-white/40 text-[10px] mt-1 normal-case">base vol.</p>
        </StatChip>
        <StatChip label="Amount">
          <span className="font-mono text-white">{Number(p.amount || 0).toFixed(8)}</span>
        </StatChip>
        <StatChip label="Available">
          <span className="font-mono text-green-400">{Number(p.available || 0).toFixed(8)}</span>
        </StatChip>
        <StatChip label="Locked">
          <span className="font-mono text-gold-light/85">{Number(p.locked || 0).toFixed(8)}</span>
        </StatChip>
        <StatChip label="Avg cost">
          <span className="font-mono text-white">{Number(p.avg_cost || 0).toFixed(8)}</span>
        </StatChip>
        <StatChip label="Mark">
          <span className="font-mono text-white">{Number(p.current_price || 0).toFixed(8)}</span>
        </StatChip>
        <StatChip label="Market value (USDT)">
          <span className="font-mono text-cyan-200/90">{Number(p.market_value_usdt || 0).toFixed(4)}</span>
        </StatChip>
        <StatChip label="U.P&amp;L">
          <span className={`font-mono ${upnl >= 0 ? 'text-green-400' : 'text-red-300'}`}>{upnl.toFixed(4)}</span>
        </StatChip>
        <StatChip label="U.P&amp;L %">
          <span className={`font-mono ${upnlPct >= 0 ? 'text-green-400' : 'text-red-300'}`}>{upnlPct.toFixed(2)}%</span>
        </StatChip>
      </div>
    </article>
  );
}

export default function LivePositionsPage({ embedded = false }) {
  const [q, setQ] = useState('');
  const [uid, setUid] = useState('');
  const [symbol, setSymbol] = useState('');
  const [asset, setAsset] = useState('');
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState({ market_value_usdt_total: 0, unrealized_pnl_total: 0 });
  const [updatedAt, setUpdatedAt] = useState('');
  const [loading, setLoading] = useState(true);
  const [skip, setSkip] = useState(0);
  const [limit, setLimit] = useState(25);
  const wsRef = useRef(null);
  const { sortBy, sortDir, sortParams, toggleSort: _toggleSort, resetSort } = useListSort('market_value', 'desc');
  const toggleSort = useCallback((key) => {
    setSkip(0);
    _toggleSort(key);
  }, [_toggleSort]);

  useEffect(() => {
    setLoading(true);
    const token = getStoredToken();
    if (!token) {
      setItems([]);
      setTotal(0);
      setStats({ market_value_usdt_total: 0, unrealized_pnl_total: 0 });
      setUpdatedAt('');
      setLoading(false);
      return;
    }
    const qs = new URLSearchParams();
    qs.set('token', token);
    qs.set('skip', String(skip));
    qs.set('limit', String(limit));
    if (q.trim()) qs.set('q', q.trim());
    if (uid.trim()) qs.set('uid', uid.trim());
    if (symbol.trim()) qs.set('symbol', symbol.trim().toUpperCase());
    if (asset.trim()) qs.set('asset', asset.trim().toUpperCase());
    qs.set('sort_by', sortParams.sort_by);
    qs.set('sort_dir', sortParams.sort_dir);
    const url = adminWsPath(`/api/admin/ws/live-positions?${qs.toString()}`);
    let closed = false;
    let reconnectTimer = null;
    const connect = () => {
      if (closed) return;
      try {
        const ws = new WebSocket(url);
        wsRef.current = ws;
        ws.onmessage = (ev) => {
          try {
            const j = JSON.parse(ev.data);
            if (j.type === 'error' && j.detail) {
              setItems([]);
              setTotal(0);
              setStats({ market_value_usdt_total: 0, unrealized_pnl_total: 0 });
              setUpdatedAt('');
              setLoading(false);
              return;
            }
            if (j.type === 'live_positions') {
              setItems(j.items || []);
              setTotal(j.total ?? 0);
              setStats(j.stats || { market_value_usdt_total: 0, unrealized_pnl_total: 0 });
              setUpdatedAt(j.updated_at || '');
              setLoading(false);
            }
          } catch {
            /* ignore */
          }
        };
        ws.onerror = () => {
          setItems([]);
          setTotal(0);
          setStats({ market_value_usdt_total: 0, unrealized_pnl_total: 0 });
          setUpdatedAt('');
          setLoading(false);
        };
        ws.onclose = () => {
          wsRef.current = null;
          if (!closed) reconnectTimer = window.setTimeout(connect, 3000);
        };
      } catch {
        setItems([]);
        setTotal(0);
        setStats({ market_value_usdt_total: 0, unrealized_pnl_total: 0 });
        setUpdatedAt('');
        setLoading(false);
        if (!closed) reconnectTimer = window.setTimeout(connect, 3000);
      }
    };
    connect();
    return () => {
      closed = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {
          /* ignore */
        }
        wsRef.current = null;
      }
    };
  }, [q, uid, symbol, asset, skip, limit, sortParams]);

  const pages = useMemo(() => Math.max(1, Math.ceil(total / limit)), [total, limit]);
  const page = useMemo(() => Math.floor(skip / limit) + 1, [skip, limit]);

  return (
    <div className="admin-page">
      {!embedded ? (
        <>
          <h1 className="admin-title mb-2 flex flex-wrap items-center gap-2">
            <Radio className="text-emerald-400" size={28} />
            Live Risk Positions
          </h1>
          <p className="admin-page-lead mb-6 max-w-3xl">Open spot inventory per user and pair, refreshed in near real time. Unrealized P&amp;L follows live marks.</p>
        </>
      ) : null}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3 mb-4 min-w-0">
        <input
          value={q}
          onChange={(e) => { setSkip(0); setQ(e.target.value); }}
          placeholder="Search by uid / email / name"
          className="min-w-0 rounded-xl bg-surface-card border border-surface-border px-4 py-3 text-white text-sm"
        />
        <UserUidSuggestInput
          value={uid}
          onChange={(v) => { setSkip(0); setUid(v); }}
          placeholder="Filter UID"
          className="min-w-0 w-full rounded-xl bg-surface-card border border-surface-border px-4 py-3 text-white text-sm font-mono"
        />
        <input
          value={symbol}
          onChange={(e) => { setSkip(0); setSymbol(e.target.value); }}
          placeholder="Symbol (e.g. BTCUSDT)"
          className="min-w-0 rounded-xl bg-surface-card border border-surface-border px-4 py-3 text-white text-sm font-mono uppercase"
        />
        <input
          value={asset}
          onChange={(e) => { setSkip(0); setAsset(e.target.value); }}
          placeholder="Asset (e.g. BTC)"
          className="min-w-0 rounded-xl bg-surface-card border border-surface-border px-4 py-3 text-white text-sm font-mono uppercase"
        />
        <button
          type="button"
          onClick={() => { setSkip(0); setQ(''); setUid(''); setSymbol(''); setAsset(''); resetSort(); }}
          className="rounded-xl border border-surface-border px-4 py-3 text-white/85 text-sm font-bold sm:col-span-2 xl:col-span-1"
        >
          Clear filters
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3 mb-4 text-sm text-white/65 min-w-0">
        <StatChip label="Total records" tone="blue">
          <strong className="text-white">{total}</strong>
        </StatChip>
        <StatChip label="Market value total" tone="cyan">
          <strong className="text-cyan-300 font-mono">{Number(stats.market_value_usdt_total || 0).toFixed(4)}</strong>
        </StatChip>
        <StatChip label="U.P&amp;L total" tone={Number(stats.unrealized_pnl_total || 0) >= 0 ? 'green' : 'rose'}>
          <strong className={`${Number(stats.unrealized_pnl_total || 0) >= 0 ? 'text-green-400' : 'text-red-300'} font-mono`}>
            {Number(stats.unrealized_pnl_total || 0).toFixed(4)}
          </strong>
        </StatChip>
        <StatChip label="Last update" tone="yellow" className="col-span-2 lg:col-span-1">
          <strong className="text-white/80 font-normal text-xs sm:text-sm">{updatedAt ? new Date(updatedAt).toLocaleTimeString() : '—'}</strong>
        </StatChip>
      </div>

      {/* Mobile / tablet: card list */}
      <div className="xl:hidden space-y-3 min-w-0">
        {loading ? (
          <div className="rounded-2xl border border-surface-border bg-surface-card px-4 py-16 text-center text-white/50">Loading…</div>
        ) : items.length === 0 ? (
          <div className="rounded-2xl border border-surface-border bg-surface-card px-4 py-16 text-center text-white/50">No live positions found.</div>
        ) : (
          items.map((p, idx) => (
            <LivePositionCard key={`${p.uid}_${p.symbol}_${idx}`} p={p} />
          ))
        )}
      </div>

      {/* Desktop: wide table — scroll container must clip radius; avoid w-full on table so columns don’t collapse */}
      <div className="hidden xl:block rounded-2xl border border-surface-border bg-surface-card min-w-0">
        <p className="px-4 py-2 text-[11px] text-white/40 border-b border-surface-border bg-white/[.02]">
          Wide table — scroll horizontally if columns don’t fit.
        </p>
        <div className="adm-table-x scrollbar-thin touch-pan-x [scrollbar-gutter:stable]">
          <table className="text-sm w-max min-w-[1560px] border-separate border-spacing-0">
            <colgroup>
              <col className="w-[200px]" />
              <col className="w-[140px]" />
              <col className="w-[120px]" />
              <col className="w-[240px]" />
              <col className="w-[200px]" />
              <col className="w-[130px]" />
              <col className="w-[130px]" />
              <col className="w-[130px]" />
              <col className="w-[120px]" />
              <col className="w-[120px]" />
              <col className="w-[120px]" />
              <col className="w-[100px]" />
              <col className="w-[90px]" />
            </colgroup>
            <thead>
              <tr className="text-left text-[11px] font-extrabold text-white/50 uppercase tracking-wider border-b border-surface-border bg-white/[.02]">
                <SortableTh className="px-4 py-3 align-bottom" sortKey="uid" activeKey={sortBy} dir={sortDir} onSort={toggleSort}>User</SortableTh>
                <SortableTh className="px-4 py-3 align-bottom" sortKey="symbol" activeKey={sortBy} dir={sortDir} onSort={toggleSort}>Symbol</SortableTh>
                <th className="px-4 py-3 align-bottom">Position</th>
                <th className="px-4 py-3 align-bottom">Last fill</th>
                <th className="px-4 py-3 text-right align-bottom whitespace-nowrap">Buy / sell (life)</th>
                <SortableTh className="px-4 py-3 align-bottom text-right whitespace-nowrap" sortKey="amount" activeKey={sortBy} dir={sortDir} onSort={toggleSort} align="right">Amount</SortableTh>
                <th className="px-4 py-3 text-right align-bottom whitespace-nowrap">Available</th>
                <th className="px-4 py-3 text-right align-bottom whitespace-nowrap">Locked</th>
                <th className="px-4 py-3 text-right align-bottom whitespace-nowrap">Avg cost</th>
                <th className="px-4 py-3 text-right align-bottom whitespace-nowrap">Mark</th>
                <SortableTh className="px-4 py-3 align-bottom text-right whitespace-nowrap" sortKey="market_value" activeKey={sortBy} dir={sortDir} onSort={toggleSort} align="right">Market value</SortableTh>
                <SortableTh className="px-4 py-3 align-bottom text-right whitespace-nowrap" sortKey="unrealized_pnl" activeKey={sortBy} dir={sortDir} onSort={toggleSort} align="right">U.P&amp;L</SortableTh>
                <th className="px-4 py-3 text-right align-bottom whitespace-nowrap">U.P&amp;L %</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={13} className="px-4 py-16 text-center text-white/50">Loading…</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={13} className="px-4 py-16 text-center text-white/50">No live positions found.</td></tr>
              ) : (
                items.map((p, idx) => (
                  <tr key={`${p.uid}_${p.symbol}_${idx}`} className="border-b border-surface-border/60 hover:bg-white/[.03]">
                    <td className="px-4 py-3 align-top max-w-[220px]">
                      <p className="text-white font-semibold break-words">{p.user_name || p.user_email || p.uid}</p>
                      <p className="text-white/50 text-xs font-mono break-all mt-0.5">{p.uid}</p>
                    </td>
                    <td className="px-4 py-3 align-top whitespace-nowrap">
                      <div className="flex items-center gap-2 min-w-0">
                        <CoinAvatar symbol={p.symbol} className="w-8 h-8 shrink-0" title={p.symbol} />
                        <span className="font-mono font-bold text-gold-light">{p.symbol}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top whitespace-nowrap">
                      <span className="inline-flex items-center rounded-lg bg-emerald-500/15 text-emerald-300 text-[11px] font-extrabold px-2 py-1 uppercase tracking-wide">
                        Spot · Long
                      </span>
                    </td>
                    <td className="px-4 py-3 align-top text-xs">
                      {p.last_fill_side ? (
                        <div className="space-y-1 min-w-0">
                          <span
                            className={`inline-flex text-[11px] font-extrabold uppercase px-2 py-0.5 rounded-md ${
                              String(p.last_fill_side).toLowerCase() === 'buy'
                                ? 'bg-green-500/20 text-green-400'
                                : 'bg-red-500/20 text-red-400'
                            }`}
                          >
                            {String(p.last_fill_side).toLowerCase() === 'buy' ? 'Buy' : 'Sell'}
                          </span>
                          <p className="text-white font-mono text-xs whitespace-nowrap">
                            {Number(p.last_fill_amount ?? 0).toFixed(8)} @ {Number(p.last_fill_price ?? 0).toFixed(8)}
                          </p>
                          <p className="text-white/45 text-[11px] font-mono whitespace-nowrap">
                            {p.last_fill_at ? new Date(p.last_fill_at).toLocaleString() : '—'}
                          </p>
                        </div>
                      ) : (
                        <span className="text-white/40 text-xs">No fills (e.g. deposit only)</span>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top text-right font-mono text-xs">
                      <div className="inline-flex flex-col items-end gap-0.5 whitespace-nowrap">
                        <span>
                          <span className="text-green-400/90">+{Number(p.lifetime_buy_qty ?? 0).toFixed(8)}</span>
                          <span className="text-white/35 mx-1">/</span>
                          <span className="text-red-400/90">−{Number(p.lifetime_sell_qty ?? 0).toFixed(8)}</span>
                        </span>
                        <span className="text-white/40 text-[10px] normal-case">base vol.</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-mono align-top whitespace-nowrap tabular-nums">{Number(p.amount || 0).toFixed(8)}</td>
                    <td className="px-4 py-3 text-right font-mono text-green-400 align-top whitespace-nowrap tabular-nums">{Number(p.available || 0).toFixed(8)}</td>
                    <td className="px-4 py-3 text-right font-mono text-gold-light/85 align-top whitespace-nowrap tabular-nums">{Number(p.locked || 0).toFixed(8)}</td>
                    <td className="px-4 py-3 text-right font-mono align-top whitespace-nowrap tabular-nums">{Number(p.avg_cost || 0).toFixed(8)}</td>
                    <td className="px-4 py-3 text-right font-mono align-top whitespace-nowrap tabular-nums">{Number(p.current_price || 0).toFixed(8)}</td>
                    <td className="px-4 py-3 text-right font-mono align-top whitespace-nowrap tabular-nums">{Number(p.market_value_usdt || 0).toFixed(4)}</td>
                    <td className={`px-4 py-3 text-right font-mono align-top whitespace-nowrap tabular-nums ${Number(p.unrealized_pnl || 0) >= 0 ? 'text-green-400' : 'text-red-300'}`}>{Number(p.unrealized_pnl || 0).toFixed(4)}</td>
                    <td className={`px-4 py-3 text-right font-mono align-top whitespace-nowrap tabular-nums ${Number(p.unrealized_pnl_pct || 0) >= 0 ? 'text-green-400' : 'text-red-300'}`}>{Number(p.unrealized_pnl_pct || 0).toFixed(2)}%</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between mt-4 gap-3 min-w-0">
        <p className="text-white/50 text-sm text-center sm:text-left">{total} rows · page {page} / {pages}</p>
        <div className="flex flex-wrap items-center justify-center sm:justify-end gap-2">
          <select value={String(limit)} onChange={(e) => { setSkip(0); setLimit(Number(e.target.value)); }} className="min-w-0 max-w-full rounded-xl bg-surface-card border border-surface-border px-3 py-2 text-white text-sm font-semibold">
            {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n}/page</option>)}
          </select>
          <button type="button" disabled={skip <= 0} onClick={() => setSkip((s) => Math.max(0, s - limit))} className="flex-1 sm:flex-none min-w-[5rem] px-4 py-2 rounded-xl border border-surface-border text-sm font-bold disabled:opacity-40">Prev</button>
          <button type="button" disabled={skip + limit >= total} onClick={() => setSkip((s) => s + limit)} className="flex-1 sm:flex-none min-w-[5rem] px-4 py-2 rounded-xl border border-surface-border text-sm font-bold disabled:opacity-40">Next</button>
        </div>
      </div>
    </div>
  );
}
