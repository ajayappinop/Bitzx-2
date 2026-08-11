import { useEffect, useState, useCallback, useMemo } from 'react';
import { Loader2, AlertCircle, RefreshCw, Search } from 'lucide-react';
import { api } from '@/lib/api';
import { AdminDataTable } from '@/components/AdminPrimitives';

const STATUS_PILL = {
  in_progress: 'inline-flex items-center rounded-full border border-gold/30 bg-gold/10 px-2 py-0.5 text-[10px] font-extrabold uppercase text-gold-light',
  paid_marked: 'inline-flex items-center rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[10px] font-extrabold uppercase text-sky-300',
  completed:   'inline-flex items-center rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-extrabold uppercase text-emerald-300',
  cancelled:   'inline-flex items-center rounded-full border border-white/20 bg-white/5 px-2 py-0.5 text-[10px] font-extrabold uppercase text-white/50',
  disputed:    'inline-flex items-center rounded-full border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[10px] font-extrabold uppercase text-rose-300',
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

export default function P2POrdersTab() {
  const [items, setItems]     = useState([]);
  const [total, setTotal]     = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  /* Filters */
  const [statusFilter, setStatusFilter] = useState('');
  const [assetFilter, setAssetFilter]   = useState('');
  const [uidFilter, setUidFilter]       = useState('');
  const [search, setSearch]             = useState('');

  /* Pagination */
  const [skip, setSkip]   = useState(0);
  const [limit, setLimit] = useState(25);
  const pages = useMemo(() => Math.max(1, Math.ceil(total / limit)), [total, limit]);
  const page  = useMemo(() => Math.floor(skip / limit) + 1, [skip, limit]);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const params = { limit: String(limit), skip: String(skip) };
      if (statusFilter)   params.status = statusFilter;
      if (assetFilter)    params.asset  = assetFilter;
      if (uidFilter.trim()) params.user_id = uidFilter.trim();
      const res  = await api.p2p.listOrders(params);
      const data = await res.json();
      setItems(data.orders || []);
      setTotal(data.total ?? data.orders?.length ?? 0);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [limit, skip, statusFilter, assetFilter, uidFilter, search]);

  useEffect(() => { load(); }, [load]);

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
            <option value="in_progress">In Progress</option>
            <option value="paid_marked">Awaiting Release</option>
            <option value="disputed">Disputed</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
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
            placeholder="Filter by UID (buyer/seller)"
            className="rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white font-mono"
          />

          <div className="relative lg:col-span-1">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/35 pointer-events-none" />
            <input
              value={search}
              onChange={(e) => { setSkip(0); setSearch(e.target.value); }}
              placeholder="Order ID…"
              className="w-full rounded-xl bg-surface-dark border border-surface-border pl-8 pr-3 py-2 text-sm text-white font-mono"
            />
          </div>

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

      <AdminDataTable minWidth="1100px">
            <thead>
              <tr>
                <Th>Order ID</Th>
                <Th>Side</Th>
                <Th right>Crypto</Th>
                <Th right>Fiat (₹)</Th>
                <Th right>Price</Th>
                <Th>Buyer UID</Th>
                <Th>Seller UID</Th>
                <Th>Method</Th>
                <Th>Date</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={10} className="text-center text-white/50 !py-16"><Loader2 size={14} className="inline animate-spin mr-1" />Loading…</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={10} className="text-center text-white/50 !py-16">No orders found.</td></tr>
              ) : items.map((o) => (
                <tr key={o.order_id}>
                  <td className="font-mono text-[11px] text-white/70">{o.order_id}</td>
                  <td>
                    <span className={SIDE_PILL[o.side] || SIDE_PILL.buy}>
                      {o.side ?? (o.buyer_id === o.maker_id ? 'buy' : 'sell')} {o.asset}
                    </span>
                  </td>
                  <td className="text-right font-mono text-[12px] text-white/90 tabular-nums">
                    {Number(o.crypto_amount || 0).toFixed(6)}
                  </td>
                  <td className="text-right font-mono text-[12px] text-white/90 tabular-nums">
                    {Number(o.fiat_amount || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                  </td>
                  <td className="text-right font-mono text-[12px] text-white/60 tabular-nums">
                    {Number(o.price || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                  </td>
                  <td className="font-mono text-[11px] text-white/60 max-w-[130px] truncate">{o.buyer_id}</td>
                  <td className="font-mono text-[11px] text-white/60 max-w-[130px] truncate">{o.seller_id}</td>
                  <td className="text-[11px] text-white/50">{o.payment_method_snapshot?.type || '—'}</td>
                  <td className="text-[11px] text-white/50 whitespace-nowrap">{fmtDate(o.created_at)}</td>
                  <td>
                    <span className={STATUS_PILL[o.status] || STATUS_PILL.cancelled}>{o.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
      </AdminDataTable>

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
  return <th className={right ? 'text-right' : undefined}>{children}</th>;
}
