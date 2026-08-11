import { useEffect, useState, useCallback, useMemo } from 'react';
import { Loader2, AlertCircle, RefreshCw, Search, X, CheckCircle2, Flag } from 'lucide-react';
import { api } from '@/lib/api';
import { AdminDataTable } from '@/components/AdminPrimitives';

const STATUS_PILL = {
  open:      'inline-flex items-center rounded-full border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[10px] font-extrabold uppercase text-rose-300',
  resolved:  'inline-flex items-center rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-extrabold uppercase text-emerald-300',
  escalated: 'inline-flex items-center rounded-full border border-gold/30 bg-gold/10 px-2 py-0.5 text-[10px] font-extrabold uppercase text-gold-light',
};

const fmtDate = (s) => {
  try { return new Date(s).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  catch { return s || '—'; }
};

export default function P2PDisputesTab() {
  const [items, setItems]       = useState([]);
  const [total, setTotal]       = useState(0);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [selected, setSelected] = useState(null);

  /* Filters */
  const [statusFilter, setStatusFilter] = useState('open');
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
      if (statusFilter) params.status = statusFilter;
      if (search.trim()) params.q = search.trim();
      const res  = await api.p2p.listDisputes(params);
      const data = await res.json();
      setItems(data.disputes || []);
      setTotal(data.total ?? data.disputes?.length ?? 0);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [limit, skip, statusFilter, search]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="rounded-2xl border border-surface-border bg-surface-card p-4">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <select
            value={statusFilter}
            onChange={(e) => { setSkip(0); setStatusFilter(e.target.value); }}
            className="rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white"
          >
            <option value="">All statuses</option>
            <option value="open">Open</option>
            <option value="escalated">Escalated</option>
            <option value="resolved">Resolved</option>
          </select>
          <div className="relative lg:col-span-2">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/35 pointer-events-none" />
            <input
              value={search}
              onChange={(e) => { setSkip(0); setSearch(e.target.value); }}
              placeholder="Search dispute ID, order ID, or UID…"
              className="w-full rounded-xl bg-surface-dark border border-surface-border pl-8 pr-3 py-2 text-sm text-white"
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

      {/* Count */}
      <div className="text-sm text-white/60">
        Total: <strong className="text-white">{total}</strong>
        {total > 0 && <span className="ml-2 text-white/40">— page {page} of {pages}</span>}
      </div>

      <AdminDataTable minWidth="900px">
            <thead>
              <tr>
                <Th>Dispute ID</Th>
                <Th>Order ID</Th>
                <Th>Raised By</Th>
                <Th>Reason</Th>
                <Th>Date</Th>
                <Th>Status</Th>
                <Th right>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="text-center text-white/50 !py-16"><Loader2 size={14} className="inline animate-spin mr-1" />Loading…</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={7} className="text-center text-white/50 !py-16">No disputes found.</td></tr>
              ) : items.map((d) => (
                <tr key={d.dispute_id}>
                  <td className="font-mono text-[11px] text-white/70">{d.dispute_id}</td>
                  <td className="font-mono text-[11px] text-white/70">{d.order_id}</td>
                  <td className="font-mono text-[11px] text-white/80">{d.raised_by_uid}</td>
                  <td className="text-[12px] text-white/60 max-w-xs truncate">{d.reason}</td>
                  <td className="text-[11px] text-white/50 whitespace-nowrap">{fmtDate(d.created_at)}</td>
                  <td>
                    <span className={STATUS_PILL[d.status] || STATUS_PILL.open}>{d.status}</span>
                  </td>
                  <td className="text-right">
                    <button
                      type="button"
                      onClick={() => setSelected(d)}
                      className="inline-flex items-center gap-1 rounded-lg border border-surface-border px-2.5 py-1 text-[11px] font-bold text-white/70 hover:bg-white/[.05]"
                    >
                      Review
                    </button>
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

      {selected && (
        <DisputeModal dispute={selected} onClose={(r) => { setSelected(null); if (r) load(); }} />
      )}
    </div>
  );
}

/* ── Dispute resolution modal ────────────────────────────────────────────── */
function DisputeModal({ dispute, onClose }) {
  const [detail, setDetail] = useState(null);
  const [winner, setWinner] = useState('buyer');
  const [notes, setNotes]   = useState('');
  const [busy, setBusy]     = useState(false);
  const [error, setError]   = useState('');

  useEffect(() => {
    api.p2p.disputeDetail(dispute.dispute_id)
      .then((r) => r.json())
      .then(setDetail)
      .catch((e) => setError(e.message));
  }, [dispute.dispute_id]);

  const resolve = async () => {
    if (!notes.trim()) { setError('Admin notes are required.'); return; }
    setBusy(true); setError('');
    try {
      const resolution = winner === 'buyer' ? 'release_to_buyer' : 'refund_to_seller';
      const res = await api.p2p.resolveDispute(dispute.dispute_id, { resolution, note: notes });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.detail || 'Failed'); }
      onClose(true);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const d = detail || dispute;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => onClose(false)}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl rounded-2xl border border-surface-border bg-surface-card shadow-2xl max-h-[92vh] overflow-y-auto"
      >
        <div className="px-6 py-4 border-b border-surface-border flex items-center justify-between">
          <div className="flex items-center gap-2 text-white font-bold">
            <Flag size={16} className="text-rose-300" /> Dispute {d.dispute_id}
          </div>
          <button type="button" onClick={() => onClose(false)} className="text-white/40 hover:text-white"><X size={18} /></button>
        </div>

        {!detail && !error ? (
          <div className="p-12 text-center text-white/50 text-sm"><Loader2 size={14} className="animate-spin inline mr-1" />Loading…</div>
        ) : (
          <div className="p-6 space-y-5">
            <div className="grid grid-cols-2 gap-3">
              <InfoBox label="Order ID"   value={d.order_id}                         mono />
              <InfoBox label="Status"     value={d.status} />
              <InfoBox label="Buyer UID"  value={d.buyer_id  || d.buyer_uid}         mono />
              <InfoBox label="Seller UID" value={d.seller_id || d.seller_uid}        mono />
              <InfoBox label="Amount"     value={`${d.crypto_amount ?? '—'} ${d.asset ?? ''}`} />
              <InfoBox label="Fiat"       value={d.fiat_amount != null ? `₹${Number(d.fiat_amount).toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : '—'} />
            </div>

            <div>
              <p className="text-[11px] font-extrabold uppercase tracking-wider text-white/45 mb-1.5">Reason</p>
              <p className="text-sm text-white/80 p-3 rounded-xl bg-surface-dark border border-surface-border">{d.reason || '—'}</p>
            </div>

            {(d.description || d.evidence_description) && (
              <div>
                <p className="text-[11px] font-extrabold uppercase tracking-wider text-white/45 mb-1.5">Description / Evidence</p>
                <p className="text-sm text-white/80 p-3 rounded-xl bg-surface-dark border border-surface-border">{d.description || d.evidence_description}</p>
              </div>
            )}

            {d.evidence_images?.length > 0 && (
              <div>
                <p className="text-[11px] font-extrabold uppercase tracking-wider text-white/45 mb-2">Evidence Images</p>
                <div className="flex flex-wrap gap-2">
                  {d.evidence_images.map((url, i) => (
                    <a key={i} href={url} target="_blank" rel="noreferrer">
                      <img src={url} alt={`ev-${i}`} className="w-20 h-20 object-cover rounded-lg border border-surface-border hover:opacity-80" />
                    </a>
                  ))}
                </div>
              </div>
            )}

            {d.status === 'open' && (
              <>
                <div>
                  <p className="text-[11px] font-extrabold uppercase tracking-wider text-white/45 mb-2">Award Funds To</p>
                  <div className="grid grid-cols-2 gap-2">
                    {['buyer', 'seller'].map((w) => (
                      <button
                        key={w}
                        type="button"
                        onClick={() => setWinner(w)}
                        className={`px-4 py-2.5 rounded-xl border text-sm font-bold transition-colors ${
                          winner === w
                            ? w === 'buyer'
                              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                              : 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                            : 'border-surface-border text-white/50 hover:text-white hover:bg-white/[.05]'
                        }`}
                      >
                        {w === 'buyer' ? 'Buyer (release funds)' : 'Seller (return funds)'}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="text-[11px] font-extrabold uppercase tracking-wider text-white/45 mb-1.5">Admin Notes</p>
                  <textarea
                    rows={2}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Reason for decision (visible to platform ops, not users)…"
                    className="w-full rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white placeholder:text-white/30 resize-none focus:outline-none focus:border-white/25"
                  />
                </div>

                {error && <p className="text-red-400 text-sm flex items-center gap-1.5"><AlertCircle size={13} />{error}</p>}
              </>
            )}
          </div>
        )}

        {d.status === 'open' && (
          <div className="px-6 py-4 border-t border-surface-border flex justify-end gap-2">
            <button type="button" onClick={() => onClose(false)}
              className="rounded-xl border border-surface-border px-4 py-2 text-white/70 text-sm font-bold hover:bg-white/[.05]">
              Cancel
            </button>
            <button
              type="button"
              onClick={resolve}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-xl border border-gold/30 bg-gold/10 px-5 py-2 text-gold-light text-sm font-bold disabled:opacity-50"
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={14} />}
              Resolve → {winner === 'buyer' ? 'Buyer' : 'Seller'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Th({ children, right }) {
  return <th className={right ? 'text-right' : undefined}>{children}</th>;
}

function InfoBox({ label, value, mono }) {
  return (
    <div className="rounded-xl border border-surface-border bg-surface-dark p-3">
      <p className="text-[10px] font-extrabold uppercase tracking-wider text-white/40">{label}</p>
      <p className={`text-sm font-semibold mt-0.5 text-white/90 ${mono ? 'font-mono' : ''}`}>{value ?? '—'}</p>
    </div>
  );
}
