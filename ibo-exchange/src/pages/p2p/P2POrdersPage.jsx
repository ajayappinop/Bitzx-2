import { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Search, ExternalLink, AlertCircle, RefreshCw, ArrowLeftRight } from 'lucide-react';
import { p2pApi } from '@/services/p2pApi';
import { useAuth } from '@/context/AuthContext';

const TABS = [
  { key: 'all',         label: 'All',              status: null },
  { key: 'in_progress', label: 'In Progress',      status: 'in_progress' },
  { key: 'paid_marked', label: 'Awaiting Release', status: 'paid_marked' },
  { key: 'completed',   label: 'Completed',        status: 'completed' },
  { key: 'cancelled',   label: 'Cancelled',        status: 'cancelled' },
  { key: 'disputed',    label: 'Disputed',         status: 'disputed' },
];

const STATUS = {
  in_progress: { label: 'Awaiting Payment', cls: 'border-gold/30 bg-[rgba(91,184,255,0.1)] text-gold' },
  paid_marked: { label: 'Awaiting Release', cls: 'border-[#0EA4AB]/30 bg-[#0EA4AB]/10 text-[#5BB8FF]' },
  completed:   { label: 'Completed',        cls: 'border-green-400/30 bg-green-400/10 text-green-400' },
  cancelled:   { label: 'Cancelled',        cls: 'border-white/15 bg-white/5 text-white/45' },
  disputed:    { label: 'Disputed',         cls: 'border-red-400/30 bg-red-400/10 text-red-400' },
  refunded:    { label: 'Refunded',         cls: 'border-white/15 bg-white/5 text-white/45' },
};

const fmtDate = (s) => {
  try { return new Date(s).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); }
  catch { return s || '—'; }
};

export default function P2POrdersPage() {
  const { user }   = useAuth();
  const [tab, setTab]         = useState('all');
  const [orders, setOrders]   = useState(null);
  const [search, setSearch]   = useState('');
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true); setError('');
    try {
      const status = TABS.find((t) => t.key === tab)?.status;
      const data = await p2pApi.listOrders({ ...(status ? { status } : {}), limit: 200 });
      setOrders(data.orders || []);
    } catch (e) { setError(e.message); setOrders([]); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [tab]); // eslint-disable-line

  const filtered = useMemo(() => {
    if (!orders) return [];
    if (!search.trim()) return orders;
    const q = search.toLowerCase();
    return orders.filter((o) =>
      o.order_id.toLowerCase().includes(q) ||
      String(o.fiat_amount).includes(q) ||
      (o.payment_method_snapshot?.type || '').toLowerCase().includes(q),
    );
  }, [orders, search]);

  return (
    <div className="ibo-page font-ui">
      <div className="w-full px-4 sm:px-5 md:px-6 lg:px-8 xl:px-10 2xl:px-12 py-6 sm:py-8 pb-16">

        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-[color:var(--ibo-ink)] tracking-tight" style={{ fontFamily: "Inter, 'Plus Jakarta Sans', system-ui, sans-serif" }}>
              My P2P Orders
            </h1>
            <p className="text-[color:var(--ibo-muted)] text-sm mt-1">Track all your active and historical P2P trades.</p>
          </div>
          <Link to="/p2p"
            className="ibo-hover-border inline-flex items-center gap-2 rounded-xl border border-[color:var(--ibo-border-solid)] bg-[color:var(--ibo-card)] px-4 py-2.5 text-sm font-semibold text-white/70 hover:text-white">
            <ArrowLeftRight size={14} /> Marketplace
          </Link>
        </div>

        {/* Status tabs */}
        <div className="mb-5 grid grid-cols-2 gap-1 rounded-xl border border-[color:var(--ibo-border-solid)] bg-[color:var(--ibo-card)] p-1 sm:grid-cols-3 xl:grid-cols-6">
          {TABS.map((t) => (
            <button key={t.key} type="button" onClick={() => setTab(t.key)}
              className={`w-full rounded-lg px-3 py-2.5 text-center text-sm font-bold whitespace-nowrap transition-colors ${
                tab === t.key
                  ? 'bg-[#0EA4AB]/15 text-[#5BB8FF] border border-[#0EA4AB]/30'
                  : 'border border-transparent text-white/55 hover:text-white/85 hover:bg-white/[.04]'
              }`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Search + refresh bar */}
        <div className="flex items-center gap-3 mb-5 flex-wrap">
          <div className="relative min-w-[220px] flex-1">
            <Search size={13} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by order ID or method…"
              className="w-full rounded-xl bg-[color:var(--ibo-card)] border border-[color:var(--ibo-border-solid)] pl-9 pr-3.5 py-2.5 text-sm text-[color:var(--ibo-ink)] placeholder:text-[color:var(--ibo-muted)] focus:outline-none focus:border-[rgba(91,184,255,0.55)] transition-colors"
            />
          </div>
          <button type="button" onClick={load} disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-xl border border-[color:var(--ibo-border-solid)] bg-[color:var(--ibo-card)] px-4 py-2.5 text-sm font-semibold text-[color:var(--ibo-ink-secondary)] hover:bg-[color:var(--ibo-hover)] hover:text-[color:var(--ibo-ink)] transition-colors disabled:opacity-40">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
          {orders !== null && (
            <span className="ml-auto text-sm text-white/40 font-mono">{filtered.length} order{filtered.length !== 1 ? 's' : ''}</span>
          )}
        </div>

        {error && (
          <div className="flex items-center gap-2.5 rounded-xl border border-red-500/25 bg-red-500/10 p-3.5 text-red-400 text-sm mb-4">
            <AlertCircle size={14} className="shrink-0" />{error}
          </div>
        )}

        {/* Orders table */}
        <div className="rounded-2xl border border-[color:var(--ibo-border-solid)] bg-[color:var(--ibo-card)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[700px]">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--ibo-border-solid)', background: 'var(--ibo-elevated)' }}>
                  {['Order ID', 'Type', 'Crypto', 'Fiat (₹)', 'Method', 'Date', 'Status', ''].map((h, i) => (
                    <th key={h+i} className="px-5 py-3.5 text-left text-[10px] font-bold uppercase tracking-widest text-white/35">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8} className="px-5 py-16 text-center">
                    <Loader2 size={18} className="animate-spin inline text-[#5BB8FF]" />
                    <p className="text-white/40 text-xs mt-2">Loading orders…</p>
                  </td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={8} className="px-5 py-16 text-center">
                    <p className="text-white/50 font-semibold text-sm">No orders found</p>
                    <Link to="/p2p" className="inline-flex items-center gap-1.5 mt-3 text-[#5BB8FF] text-sm hover:underline">
                      Browse marketplace
                    </Link>
                  </td></tr>
                ) : filtered.map((o) => {
                  const isBuyer = o.buyer_id === user?.uid;
                  const st = STATUS[o.status] || STATUS.cancelled;
                  return (
                    <tr key={o.order_id} className="ibo-hover-table-row" style={{ borderBottom: '1px solid var(--ibo-border-solid)' }}>
                      <td className="px-5 py-4 font-mono text-[11px] text-white/45">{o.order_id}</td>
                      <td className="px-5 py-4">
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${
                          isBuyer ? 'border-green-400/30 bg-green-400/10 text-green-400' : 'border-red-400/30 bg-red-400/10 text-red-400'
                        }`}>
                          {isBuyer ? 'Buy' : 'Sell'} {o.asset}
                        </span>
                      </td>
                      <td className="px-5 py-4 font-mono text-sm text-white tabular-nums">{Number(o.crypto_amount).toFixed(4)}</td>
                      <td className="px-5 py-4 font-mono text-sm text-white tabular-nums">₹{Number(o.fiat_amount).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                      <td className="px-5 py-4 text-white/55 text-xs">{o.payment_method_snapshot?.type || '—'}</td>
                      <td className="px-5 py-4 text-white/40 text-xs whitespace-nowrap">{fmtDate(o.created_at)}</td>
                      <td className="px-5 py-4">
                        <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase ${st.cls}`}>
                          {st.label}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <Link to={`/p2p/orders/${o.order_id}`}
                          className="inline-flex items-center gap-1 rounded-lg border border-[color:var(--ibo-border-solid)] px-3 py-1.5 text-xs font-semibold text-white/60 hover:bg-[color:var(--ibo-hover)] hover:text-white transition-colors">
                          View <ExternalLink size={10} />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
