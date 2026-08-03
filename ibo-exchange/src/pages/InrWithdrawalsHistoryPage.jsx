import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, IndianRupee } from 'lucide-react';
import { cancelInrWithdrawal, fetchInrWithdrawals } from '@/services/inrApi';
import { INR_CONTAINER, INR_PAGE_BG } from '@/components/inr/deposit/styles';

function fmtTs(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function fmtInr(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return `₹${v.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
}

function statusBadge(status) {
  const s = (status || '').toLowerCase();
  if (s === 'approved') return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
  if (s === 'cancelled') return 'bg-zinc-500/20 text-zinc-200 border-zinc-500/30';
  if (s === 'rejected') return 'bg-red-500/15 text-red-300 border-red-500/30';
  return 'bg-gold/15 text-gold-light border-gold/30';
}

function effectiveStatus(row) {
  const st = String(row?.status || '').toLowerCase();
  const reason = String(row?.rejection_reason || '').trim().toLowerCase();
  if (st === 'rejected' && reason === 'cancelled by user') return 'cancelled';
  return st || 'pending';
}

export default function InrWithdrawalsHistoryPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cancellingId, setCancellingId] = useState('');
  const [confirmRow, setConfirmRow] = useState(null);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const data = await fetchInrWithdrawals({ limit: 50 });
      setItems(data.items || []);
    } catch (e) {
      setErr(e.message || 'Could not load withdrawals');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onCancel = async (row) => {
    const id = String(row?.id || '');
    if (!id) return;
    setErr('');
    setCancellingId(id);
    try {
      await cancelInrWithdrawal(id);
      await load();
    } catch (e) {
      setErr(e.message || 'Could not cancel withdrawal');
    } finally {
      setCancellingId('');
    }
  };

  return (
    <div className={INR_PAGE_BG}>
      <div className={INR_CONTAINER}>
        <Link
          to="/wallet/withdraw/inr"
          className="inline-flex items-center gap-2 text-sm font-bold text-gold-light hover:text-gold mb-6"
        >
          <ArrowLeft size={18} /> Back to INR withdraw
        </Link>

        <h1 className="text-2xl font-extrabold text-white flex items-center gap-2 mb-6">
          <IndianRupee className="text-gold-light" />
          INR withdrawal history
        </h1>

        {err && (
          <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {err}
          </div>
        )}

        <div className="rounded-2xl border border-surface-border bg-surface-card overflow-hidden">
          {loading ? (
            <p className="p-8 text-center text-white/45">Loading…</p>
          ) : items.length === 0 ? (
            <p className="p-8 text-center text-white/45">No INR withdrawals yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-surface-border text-left text-white/45 text-xs uppercase">
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Amount</th>
                    <th className="px-4 py-3">Payout</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((row) => {
                    const st = effectiveStatus(row);
                    return (
                    <tr key={row.id} className="border-b border-surface-border/60 hover:bg-white/[0.02]">
                      <td className="px-4 py-3 text-white/70 whitespace-nowrap">{fmtTs(row.created_at)}</td>
                      <td className="px-4 py-3 text-white font-mono">{fmtInr(row.amount_inr)}</td>
                      <td className="px-4 py-3 text-white/70">
                        <span className="uppercase text-[10px] text-white/40">{row.payout_type}</span>
                        <div className="text-white/80">{row.payout_label || '—'}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-block px-2 py-0.5 rounded-lg border text-xs font-bold capitalize ${statusBadge(st)}`}>
                          {st}
                        </span>
                        {st === 'rejected' && row.rejection_reason && (
                          <p className="text-xs text-red-300/80 mt-1 max-w-xs">{row.rejection_reason}</p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {st === 'pending' ? (
                          <button
                            type="button"
                            onClick={() => setConfirmRow(row)}
                            disabled={cancellingId === row.id}
                            className="px-3 py-1.5 rounded-lg border border-red-500/40 bg-red-500/10 text-xs font-bold text-red-200 hover:bg-red-500/20 disabled:opacity-60"
                          >
                            {cancellingId === row.id ? 'Cancelling…' : 'Cancel request'}
                          </button>
                        ) : (
                          <span className="text-xs text-white/35">—</span>
                        )}
                      </td>
                    </tr>
                  );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {confirmRow ? (
          <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="w-full max-w-md rounded-2xl border border-surface-border bg-surface-card shadow-2xl">
              <div className="px-5 py-4 border-b border-surface-border">
                <h3 className="text-white font-bold text-lg">Cancel withdrawal request?</h3>
                <p className="text-white/60 text-sm mt-1">
                  This will cancel your pending INR withdrawal request and unlock reserved IBO.
                </p>
              </div>
              <div className="px-5 py-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmRow(null)}
                  disabled={!!cancellingId}
                  className="px-4 py-2 rounded-xl border border-surface-border text-sm font-semibold text-white/80 hover:bg-white/5 disabled:opacity-50"
                >
                  Keep request
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const row = confirmRow;
                    setConfirmRow(null);
                    await onCancel(row);
                  }}
                  disabled={!!cancellingId}
                  className="px-4 py-2 rounded-xl border border-red-500/40 bg-red-500/15 text-sm font-semibold text-red-200 hover:bg-red-500/25 disabled:opacity-50"
                >
                  Yes, cancel
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
