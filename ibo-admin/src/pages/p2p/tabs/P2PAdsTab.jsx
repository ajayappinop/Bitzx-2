import { useEffect, useState, useCallback, useMemo } from 'react';
import { Loader2, AlertCircle, RefreshCw, Search, Pause } from 'lucide-react';
import { api } from '@/lib/api';

const STATUS_PILL = {
  active:    'inline-flex items-center rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-extrabold uppercase text-emerald-300',
  paused:    'inline-flex items-center rounded-full border border-gold/30 bg-gold/10 px-2 py-0.5 text-[10px] font-extrabold uppercase text-gold-light',
  cancelled: 'inline-flex items-center rounded-full border border-white/20 bg-white/5 px-2 py-0.5 text-[10px] font-extrabold uppercase text-white/50',
  suspended: 'inline-flex items-center rounded-full border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[10px] font-extrabold uppercase text-rose-300',
  completed: 'inline-flex items-center rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[10px] font-extrabold uppercase text-sky-300',
};

const SIDE_PILL = {
  sell: 'inline-flex items-center rounded-full border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[10px] font-extrabold uppercase text-rose-300',
  buy:  'inline-flex items-center rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-extrabold uppercase text-emerald-300',
};

const ASSETS = ['USDT', 'BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'DOGE', 'TRX', 'LTC'];

const fmtDate = (s) => {
  try { return new Date(s).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  catch { return s || '—'; }
};

export default function P2PAdsTab() {
  const [items, setItems]     = useState([]);
  const [total, setTotal]     = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  /* Filters */
  const [statusFilter, setStatusFilter] = useState('active');
  const [sideFilter, setSideFilter]     = useState('');
  const [assetFilter, setAssetFilter]   = useState('');
  const [uidFilter, setUidFilter]       = useState('');

  /* Pagination */
  const [skip, setSkip]   = useState(0);
  const [limit, setLimit] = useState(25);
  const pages = useMemo(() => Math.max(1, Math.ceil(total / limit)), [total, limit]);
  const page  = useMemo(() => Math.floor(skip / limit) + 1, [skip, limit]);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const params = { limit: String(limit), skip: String(skip) };
      if (statusFilter)     params.status = statusFilter;
      if (sideFilter)       params.side   = sideFilter;
      if (assetFilter)      params.asset  = assetFilter;
      if (uidFilter.trim()) params.user_id = uidFilter.trim();
      const res  = await api.p2p.listAds(params);
      const data = await res.json();
      setItems(data.ads || []);
      setTotal(data.total ?? data.ads?.length ?? 0);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [limit, skip, statusFilter, sideFilter, assetFilter, uidFilter]);

  useEffect(() => { load(); }, [load]);

  const suspend = async (adId) => {
    const reason = window.prompt('Reason for suspension (shown in audit log):');
    if (!reason) return;
    try {
      const res = await api.p2p.suspendAd(adId, { reason });
      if (!res.ok) { const d = await res.json().catch(() => ({})); alert(d.detail || 'Failed to suspend.'); return; }
      load();
    } catch (e) { alert(e.message); }
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="rounded-2xl border border-surface-border bg-surface-card p-4">
        <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <select
            value={statusFilter}
            onChange={(e) => { setSkip(0); setStatusFilter(e.target.value); }}
            className="rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white"
          >
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="suspended">Suspended</option>
            <option value="cancelled">Cancelled</option>
            <option value="completed">Completed</option>
          </select>

          <select
            value={sideFilter}
            onChange={(e) => { setSkip(0); setSideFilter(e.target.value); }}
            className="rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white"
          >
            <option value="">Buy & Sell</option>
            <option value="buy">Buy ads</option>
            <option value="sell">Sell ads</option>
          </select>

          <select
            value={assetFilter}
            onChange={(e) => { setSkip(0); setAssetFilter(e.target.value); }}
            className="rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white"
          >
            <option value="">All assets</option>
            {ASSETS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>

          <input
            value={uidFilter}
            onChange={(e) => { setSkip(0); setUidFilter(e.target.value); }}
            placeholder="Filter by maker UID…"
            className="rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white font-mono"
          />

          <button
            type="button"
            onClick={() => load()}
            disabled={loading}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-surface-border px-3 py-2 text-white/80 text-sm font-bold disabled:opacity-40"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      {error && <p className="text-red-400 text-sm flex items-center gap-1.5"><AlertCircle size={13} />{error}</p>}

      <div className="text-sm text-white/60">
        Total: <strong className="text-white">{total}</strong>
        {total > 0 && <span className="ml-2 text-white/40">— page {page} of {pages}</span>}
      </div>

      {/* Table */}
      <div className="rounded-2xl border border-surface-border bg-surface-card overflow-hidden">
        <div className="adm-table-x scrollbar-thin">
          <table className="w-full text-sm min-w-[1050px]">
            <thead>
              <tr className="border-b border-surface-border bg-white/[.02] text-left text-[11px] font-extrabold uppercase tracking-wider text-white/50">
                <Th>Ad ID</Th>
                <Th>Maker UID</Th>
                <Th>Side</Th>
                <Th right>Price (₹)</Th>
                <Th right>Available</Th>
                <Th right>Total</Th>
                <Th>Limits (₹)</Th>
                <Th>Orders</Th>
                <Th>Date</Th>
                <Th>Status</Th>
                <Th right>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={11} className="px-4 py-16 text-center text-white/50"><Loader2 size={14} className="inline animate-spin mr-1" />Loading…</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={11} className="px-4 py-16 text-center text-white/50">No ads found.</td></tr>
              ) : items.map((a) => (
                <tr key={a.ad_id} className="border-b border-surface-border/60 hover:bg-white/[.025]">
                  <td className="px-4 py-3 font-mono text-[11px] text-white/70">{a.ad_id}</td>
                  <td className="px-4 py-3 font-mono text-[11px] text-white/60 max-w-[130px] truncate">{a.maker_id}</td>
                  <td className="px-4 py-3">
                    <span className={SIDE_PILL[a.side] || SIDE_PILL.buy}>{a.side} {a.asset}</span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-[12px] text-white/90 tabular-nums">
                    {Number(a.price || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                    {a.price_type === 'floating' && (
                      <div className="text-[10px] text-white/40">{a.margin_pct}%</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-[12px] text-white/80 tabular-nums">
                    {Number(a.available_amount || 0).toFixed(4)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-[12px] text-white/50 tabular-nums">
                    {Number(a.total_amount || 0).toFixed(4)}
                  </td>
                  <td className="px-4 py-3 text-[11px] text-white/50 whitespace-nowrap">
                    {Number(a.min_order_inr || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                    {' – '}
                    {Number(a.max_order_inr || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                  </td>
                  <td className="px-4 py-3 text-[11px] text-white/50">
                    {a.active_orders_count ?? 0} / {a.completed_orders_count ?? 0}
                  </td>
                  <td className="px-4 py-3 text-[11px] text-white/50 whitespace-nowrap">{fmtDate(a.created_at)}</td>
                  <td className="px-4 py-3">
                    <span className={STATUS_PILL[a.status] || STATUS_PILL.cancelled}>{a.status}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {a.status === 'active' && (
                      <button
                        type="button"
                        onClick={() => suspend(a.ad_id)}
                        className="inline-flex items-center gap-1 rounded-lg border border-rose-500/30 px-2.5 py-1 text-[11px] font-bold text-rose-300 hover:bg-rose-500/10"
                      >
                        <Pause size={10} /> Suspend
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {total > 0 && (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-sm text-white/50">Showing {skip + 1}–{Math.min(skip + limit, total)} of {total}</p>
          <div className="flex items-center gap-2">
            <select
              value={limit}
              onChange={(e) => { setSkip(0); setLimit(Number(e.target.value)); }}
              className="rounded-xl bg-surface-card border border-surface-border px-3 py-2 text-white text-sm font-semibold"
            >
              {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n}/page</option>)}
            </select>
            <button type="button" disabled={skip <= 0} onClick={() => setSkip((s) => Math.max(0, s - limit))}
              className="px-4 py-2 rounded-xl border border-surface-border text-sm font-bold disabled:opacity-40 text-white/80">
              Prev
            </button>
            <button type="button" disabled={skip + limit >= total} onClick={() => setSkip((s) => s + limit)}
              className="px-4 py-2 rounded-xl border border-surface-border text-sm font-bold disabled:opacity-40 text-white/80">
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Th({ children, right }) {
  return <th className={`px-4 py-3 ${right ? 'text-right' : ''}`}>{children}</th>;
}
