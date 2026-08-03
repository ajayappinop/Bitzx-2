import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, IndianRupee, RefreshCw } from 'lucide-react';
import { fetchInrDeposits } from '@/services/inrApi';

const STATUS_STYLES = {
  pending: 'bg-gold-light/10 text-gold-light border-gold-light/30',
  approving: 'bg-sky-400/10 text-sky-300 border-sky-400/30',
  approved: 'bg-green-400/10 text-green-300 border-green-400/30',
  rejected: 'bg-red-400/10 text-red-300 border-red-400/30',
};

const STATUS_LABELS = {
  pending: 'Pending review',
  approving: 'Processing',
  approved: 'Approved',
  rejected: 'Rejected',
};

function fmtTs(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return String(iso);
  }
}

export default function InrDepositsHistoryPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const data = await fetchInrDeposits({ limit: 100 });
      setItems(data.items || []);
    } catch (e) {
      setErr(e.message || 'Could not load deposit history');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link to="/wallet" className="text-white/70 hover:text-gold-light">
            <ArrowLeft size={20} />
          </Link>
          <div>
            <h1 className="text-2xl font-extrabold text-white flex items-center gap-2">
              <IndianRupee className="text-gold-light" size={26} />
              INR deposit history
            </h1>
            <p className="text-sm text-white/60 mt-1">Track your fiat deposit requests and review outcomes.</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-surface-border text-sm font-bold text-white hover:border-gold/40 disabled:opacity-40"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
          <Link
            to="/wallet/deposit/inr"
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-bold bg-gold/20 text-gold-light border border-gold/30 hover:bg-gold/30"
          >
            New deposit
          </Link>
        </div>
      </div>

      {err && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{err}</div>
      )}

      <div className="bg-surface-DEFAULT border border-surface-border rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] text-white/60 uppercase border-b border-surface-border">
                {['Date', 'INR', 'Delta', 'UTR', 'Status', 'Rejection reason'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-white/50">Loading…</td>
                </tr>
              )}
              {!loading && items.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-white/50">
                    No INR deposits yet.{' '}
                    <Link to="/wallet/deposit/inr" className="text-gold-light underline">Submit one</Link>
                  </td>
                </tr>
              )}
              {!loading && items.map((row) => {
                const st = String(row.status || 'pending').toLowerCase();
                const badge = STATUS_STYLES[st] || STATUS_STYLES.pending;
                const statusLabel = STATUS_LABELS[st] || st;
                return (
                  <tr key={row.id} className="border-b border-surface-border/60 hover:bg-white/[.02]">
                    <td className="px-4 py-3 text-white/80 whitespace-nowrap">{fmtTs(row.created_at)}</td>
                    <td className="px-4 py-3 text-white font-semibold">₹{Number(row.amount_inr).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                    <td className="px-4 py-3 text-gold-light font-mono">
                      {st === 'approved' && row.amount_ibo != null
                        ? Number(row.amount_ibo).toFixed(8)
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-white/70 font-mono text-xs">{row.utr_number || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-bold border ${badge}`}>
                        {statusLabel}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-red-300/90 text-xs max-w-[200px]">
                      {st === 'rejected' ? row.rejection_reason || '—' : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
