import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardList, ChevronLeft, ChevronRight } from 'lucide-react';
import { api } from '@/lib/api';
import UserUidSuggestInput from '@/components/UserUidSuggestInput';
import CoinAvatar from '@/components/CoinAvatar';
import { useListSort } from '@/lib/useListSort';
import SortableTh from '@/components/SortableTh';
import { AdminDataTable } from '@/components/AdminPrimitives';

export default function OrdersPage({ embedded = false, compact = false }) {
  const [uid, setUid] = useState('');
  const [symbol, setSymbol] = useState('');
  const [status, setStatus] = useState('');
  const [side, setSide] = useState('');
  const [type, setType] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [skip, setSkip] = useState(0);
  const [limit, setLimit] = useState(40);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const { sortBy, sortDir, sortParams, toggleSort: _toggleSort } = useListSort('created_at', 'desc');
  const toggleSort = useCallback((key) => {
    setSkip(0);
    _toggleSort(key);
  }, [_toggleSort]);

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const params = { skip: String(skip), limit: String(limit), ...sortParams };
      if (uid.trim()) params.uid = uid.trim();
      if (symbol.trim()) params.symbol = symbol.trim().toUpperCase();
      if (status) params.status = status;
      if (side) params.side = side;
      if (type) params.type = type;
      if (dateFrom) params.date_from = `${dateFrom}T00:00:00`;
      if (dateTo) params.date_to = `${dateTo}T23:59:59`;
      const r = await api.orders(params);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail || 'Failed to load orders');
      setItems(j.items || []);
      setTotal(j.total ?? 0);
    } catch (e) {
      setErr(e.message || 'Failed to load orders');
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [uid, symbol, status, side, type, dateFrom, dateTo, skip, limit, sortParams]);

  useEffect(() => {
    load();
  }, [load]);

  const pages = Math.max(1, Math.ceil(total / limit));
  const page = Math.floor(skip / limit) + 1;

  return (
    <div className="admin-page">
      {!embedded ? (
        <>
          <h1 className="admin-title mb-2 flex items-center gap-2">
            <ClipboardList className="text-gold-light shrink-0" size={28} />
            Order Management
          </h1>
          <p className="admin-page-lead mb-6">Unified order ledger for open and historical orders. Filter by user, symbol, side, and status.</p>
        </>
      ) : null}

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <UserUidSuggestInput
          value={uid}
          onChange={(v) => { setSkip(0); setUid(v); }}
          placeholder="User UID"
          className="w-full rounded-xl bg-surface-card border border-surface-border px-4 py-3 text-white placeholder:text-white/35 font-mono text-sm"
        />
        <input
          value={symbol}
          onChange={(e) => { setSkip(0); setSymbol(e.target.value); }}
          placeholder="Symbol (e.g. BTCUSDT)"
          className="rounded-xl bg-surface-card border border-surface-border px-4 py-3 text-white placeholder:text-white/35 font-mono text-sm uppercase"
        />
        <select
          value={status}
          onChange={(e) => { setSkip(0); setStatus(e.target.value); }}
          className="rounded-xl bg-surface-card border border-surface-border px-4 py-3 text-white text-sm"
        >
          <option value="">All status</option>
          <option value="open,partially_filled">open + partially_filled</option>
          {['open', 'partially_filled', 'filled', 'cancelled', 'rejected'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select
          value={side}
          onChange={(e) => { setSkip(0); setSide(e.target.value); }}
          className="rounded-xl bg-surface-card border border-surface-border px-4 py-3 text-white text-sm"
        >
          <option value="">All sides</option>
          <option value="buy">buy</option>
          <option value="sell">sell</option>
        </select>
        <select
          value={type}
          onChange={(e) => { setSkip(0); setType(e.target.value); }}
          className="rounded-xl bg-surface-card border border-surface-border px-4 py-3 text-white text-sm"
        >
          <option value="">All types</option>
          <option value="market">market</option>
          <option value="limit">limit</option>
        </select>
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => { setSkip(0); setDateFrom(e.target.value); }}
          className="rounded-xl bg-surface-card border border-surface-border px-4 py-3 text-white text-sm"
        />
        <input
          type="date"
          value={dateTo}
          onChange={(e) => { setSkip(0); setDateTo(e.target.value); }}
          className="rounded-xl bg-surface-card border border-surface-border px-4 py-3 text-white text-sm"
        />
        <button
          type="button"
          onClick={() => { setSkip(0); setUid(''); setSymbol(''); setStatus(''); setSide(''); setType(''); setDateFrom(''); setDateTo(''); }}
          className="rounded-xl border border-surface-border px-4 py-3 text-white/85 text-sm font-bold"
        >
          Clear
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        {compact ? (
          <>
            <button
              type="button"
              onClick={() => { setSkip(0); setStatus('open,partially_filled'); }}
              className={`px-3 py-1.5 rounded-lg border text-xs font-bold ${status === 'open,partially_filled' ? 'border-gold/45 bg-gold/15 text-gold-light' : 'border-surface-border text-white/75'}`}
            >
              Open orders
            </button>
            <button
              type="button"
              onClick={() => { setSkip(0); setStatus('cancelled'); }}
              className={`px-3 py-1.5 rounded-lg border text-xs font-bold ${status === 'cancelled' ? 'border-gold/45 bg-gold/15 text-gold-light' : 'border-surface-border text-white/75'}`}
            >
              Cancelled orders
            </button>
            <button
              type="button"
              onClick={() => load()}
              className="px-3 py-1.5 rounded-lg border border-surface-border text-xs font-bold text-white/85"
            >
              Refresh
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={async () => {
                try {
                  const r = await api.bulkCancelOrdersAdmin({ symbol: symbol.trim().toUpperCase(), uid: uid.trim(), limit: '500' });
                  const j = await r.json().catch(() => ({}));
                  if (!r.ok) throw new Error(j.detail || 'Bulk cancel failed');
                  await load();
                } catch (e) {
                  setErr(e.message || 'Bulk cancel failed');
                }
              }}
              className="px-3 py-1.5 rounded-lg border border-red-500/35 bg-red-500/10 text-xs font-bold text-red-300 disabled:opacity-50"
            >
              Bulk cancel
            </button>
          </>
        ) : null}
      </div>

      {err ? <p className="text-red-400 text-sm mb-4">{err}</p> : null}

      <AdminDataTable minWidth="1080px">
            <thead>
              <tr>
                <SortableTh sortKey="created_at" activeKey={sortBy} dir={sortDir} onSort={toggleSort}>Time</SortableTh>
                <SortableTh sortKey="id" activeKey={sortBy} dir={sortDir} onSort={toggleSort}>Order</SortableTh>
                <SortableTh sortKey="uid" activeKey={sortBy} dir={sortDir} onSort={toggleSort}>UID</SortableTh>
                <SortableTh sortKey="symbol" activeKey={sortBy} dir={sortDir} onSort={toggleSort}>Symbol</SortableTh>
                <SortableTh sortKey="side" activeKey={sortBy} dir={sortDir} onSort={toggleSort}>Side</SortableTh>
                <SortableTh sortKey="type" activeKey={sortBy} dir={sortDir} onSort={toggleSort}>Type</SortableTh>
                <SortableTh sortKey="price" activeKey={sortBy} dir={sortDir} onSort={toggleSort}>Price</SortableTh>
                <SortableTh sortKey="amount" activeKey={sortBy} dir={sortDir} onSort={toggleSort}>Amount</SortableTh>
                <SortableTh sortKey="status" activeKey={sortBy} dir={sortDir} onSort={toggleSort}>Status</SortableTh>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="text-center text-white/50 !py-16">Loading…</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={9} className="text-center text-white/50 !py-16">No orders match.</td></tr>
              ) : (
                items.map((o, idx) => (
                  <tr key={o.id || `${o.uid}-${o.created_at}-${idx}`}>
                    <td className="text-white/55 text-xs whitespace-nowrap">{o.created_at ? new Date(o.created_at).toLocaleString() : '—'}</td>
                    <td className="font-mono text-xs text-gold-light/90">{o.id}</td>
                    <td className="text-xs font-mono">
                      <Link to={`/users/${o.uid}`} className="text-blue-300 hover:underline">{o.uid}</Link>
                    </td>
                    <td>
                      <span className="inline-flex items-center gap-2 font-mono font-bold text-white/90">
                        <CoinAvatar symbol={o.symbol} className="h-6 w-6" />
                        {o.symbol}
                      </span>
                    </td>
                    <td className={`text-xs font-bold uppercase ${String(o.side).toLowerCase() === 'buy' ? 'text-green-400' : 'text-red-300'}`}>{o.side}</td>
                    <td className="text-xs uppercase text-white/75">{o.type}</td>
                    <td className="text-right font-mono">{Number(o.price || 0).toFixed(8)}</td>
                    <td className="text-right font-mono">{Number(o.amount || 0).toFixed(8)}</td>
                    <td className="text-xs font-mono text-white/70">{o.status}</td>
                  </tr>
                ))
              )}
            </tbody>
      </AdminDataTable>

      <div className="flex items-center justify-between mt-4 flex-wrap gap-3">
        <p className="text-white/50 text-sm">{total} orders · page {page} / {pages}</p>
        <div className="flex items-center gap-2">
          <select
            value={String(limit)}
            onChange={e => { setSkip(0); setLimit(Number(e.target.value)); }}
            className="rounded-xl bg-surface-card border border-surface-border px-3 py-2 text-white text-sm font-semibold"
          >
            {[10, 25, 40, 50, 100].map(n => <option key={n} value={n}>{n}/page</option>)}
          </select>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={skip <= 0}
              onClick={() => setSkip(s => Math.max(0, s - limit))}
              className="flex items-center gap-1 px-4 py-2 rounded-xl border border-surface-border text-sm font-bold disabled:opacity-40"
            >
              <ChevronLeft size={18} /> Prev
            </button>
            <button
              type="button"
              disabled={skip + limit >= total}
              onClick={() => setSkip(s => s + limit)}
              className="flex items-center gap-1 px-4 py-2 rounded-xl border border-surface-border text-sm font-bold disabled:opacity-40"
            >
              Next <ChevronRight size={18} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
