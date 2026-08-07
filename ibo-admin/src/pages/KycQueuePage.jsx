import { useCallback, useEffect, useState, Fragment } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, UserCheck, FileText } from 'lucide-react';
import { api } from '@/lib/api';
import { useListSort } from '@/lib/useListSort';
import SortableTh from '@/components/SortableTh';
import ConfirmModal from '@/components/ConfirmModal';

const API_BASE = (import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000').replace(/\/$/, '');

function mediaUrl(rel) {
  if (!rel || typeof rel !== 'string') return null;
  if (rel.startsWith('http')) return rel;
  return `${API_BASE}${rel.startsWith('/') ? '' : '/'}${rel}`;
}

export default function KycQueuePage() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [skip, setSkip] = useState(0);
  const [limit, setLimit] = useState(25);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [busyUid, setBusyUid] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [confirm, setConfirm] = useState({ open: false, uid: '', kind: 'approve' });
  const { sortBy, sortDir, sortParams, toggleSort: _toggleSort } = useListSort('submitted_at', 'desc');
  const toggleSort = useCallback((key) => {
    setSkip(0);
    _toggleSort(key);
  }, [_toggleSort]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { skip: String(skip), limit: String(limit) };
      if (q.trim()) params.q = q.trim();
      if (dateFrom) params.date_from = `${dateFrom}T00:00:00`;
      if (dateTo) params.date_to = `${dateTo}T23:59:59`;
      Object.assign(params, sortParams);
      const r = await api.kycPending(params);
      if (!r.ok) throw new Error('Failed to load KYC queue');
      const data = await r.json();
      setItems(data.items || []);
      setTotal(data.total ?? 0);
    } catch {
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [skip, limit, q, dateFrom, dateTo, sortParams]);

  useEffect(() => {
    load();
  }, [load]);

  const approve = async uid => {
    setBusyUid(uid);
    setErr('');
    try {
      const r = await api.approveKyc(uid);
      if (!r.ok) throw new Error('Approve failed');
      await load();
    } catch (e) {
      setErr(e.message || 'Approve failed');
    } finally {
      setBusyUid(null);
    }
  };

  const reject = async (uid, reason) => {
    setBusyUid(uid);
    setErr('');
    try {
      const r = await api.rejectKyc(uid, reason);
      if (!r.ok) throw new Error('Reject failed');
      await load();
    } catch (e) {
      setErr(e.message || 'Reject failed');
    } finally {
      setBusyUid(null);
    }
  };

  const pages = Math.max(1, Math.ceil(total / limit));
  const page = Math.floor(skip / limit) + 1;

  return (
    <div className="admin-page">
      <h1 className="admin-title mb-2 flex flex-wrap items-center gap-2">
        <UserCheck className="text-gold shrink-0" size={28} />
        KYC
      </h1>
      <p className="admin-page-lead mb-6">Queue of users awaiting identity verification. Approve complete submissions or reject with a clear reason.</p>
      {err ? <p className="text-red-400 text-sm mb-4">{err}</p> : null}
      <div className="admin-filter-bar mb-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <input
          value={q}
          onChange={e => { setSkip(0); setQ(e.target.value); }}
          placeholder="Filter by uid/email/name"
          className="rounded-xl bg-surface-card border border-surface-border px-4 py-3 text-white placeholder:text-white/35 text-sm font-mono sm:col-span-2"
        />
        <input
          type="date"
          value={dateFrom}
          onChange={e => { setSkip(0); setDateFrom(e.target.value); }}
          className="rounded-xl bg-surface-card border border-surface-border px-4 py-3 text-white text-sm"
        />
        <input
          type="date"
          value={dateTo}
          onChange={e => { setSkip(0); setDateTo(e.target.value); }}
          className="rounded-xl bg-surface-card border border-surface-border px-4 py-3 text-white text-sm"
        />
        </div>
        <div className="mt-3">
          <button
            type="button"
            onClick={() => {
              setSkip(0);
              setQ('');
              setDateFrom('');
              setDateTo('');
            }}
            className="rounded-xl border border-surface-border px-3 py-2 text-xs font-bold text-white/80 hover:bg-white/[.04]"
          >
            Clear filters
          </button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3 mb-4 text-sm text-white/65">
        <span>Total records: <strong className="text-white">{total}</strong></span>
        <span>Amount: <strong className="text-white/80">N/A (KYC queue)</strong></span>
      </div>

      <div className="rounded-2xl border border-surface-border bg-surface-card overflow-hidden min-w-0">
        <div className="adm-table-x scrollbar-thin">
          <table className="w-full text-sm min-w-[800px]">
            <thead>
              <tr className="text-left text-[11px] font-extrabold text-white/50 uppercase tracking-wider border-b border-surface-border bg-white/[.02]">
                <th className="px-4 py-3 w-10" />
                <SortableTh className="px-4 py-3" sortKey="uid" activeKey={sortBy} dir={sortDir} onSort={toggleSort}>User</SortableTh>
                <SortableTh className="px-4 py-3" sortKey="submitted_at" activeKey={sortBy} dir={sortDir} onSort={toggleSort}>Submitted</SortableTh>
                <th className="px-4 py-3">Document</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-16 text-center text-white/50">Loading…</td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-16 text-center text-white/50">No pending KYC submissions.</td>
                </tr>
              ) : (
                items.map(row => {
                  const uid = row.uid;
                  const doc = row.document_info || {};
                  const open = expanded === uid;
                  return (
                    <Fragment key={uid}>
                      <tr className="border-b border-surface-border/60 hover:bg-white/[.03]">
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => setExpanded(open ? null : uid)}
                            className="p-1.5 rounded-lg border border-surface-border text-white/70 hover:text-gold-light"
                            aria-label="Toggle details"
                          >
                            <FileText size={16} />
                          </button>
                        </td>
                        <td className="px-4 py-3">
                          <Link to={`/users/${uid}`} className="font-bold text-white hover:text-gold-light">{row.user_name || '—'}</Link>
                          <p className="text-xs text-white/50">{row.user_email}</p>
                          <p className="text-[11px] font-mono text-white/35">{uid}</p>
                        </td>
                        <td className="px-4 py-3 text-white/55 text-xs whitespace-nowrap">
                          {row.submitted_at ? new Date(row.submitted_at).toLocaleString() : '—'}
                        </td>
                        <td className="px-4 py-3 text-xs">
                          <span className="text-white/80">{doc.document_type || '—'}</span>
                          <p className="text-white/45 font-mono truncate max-w-[180px]" title={doc.document_number}>#{doc.document_number}</p>
                          {row.pan_info?.linked && (
                            <p className="text-white/45 font-mono truncate max-w-[180px] mt-0.5" title={row.pan_info.number}>
                              PAN {row.pan_info.number}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex justify-end gap-2 flex-wrap">
                            <button
                              type="button"
                              disabled={busyUid === uid}
                              onClick={() => setConfirm({ open: true, uid, kind: 'approve' })}
                              className="text-xs font-bold px-3 py-1.5 rounded-lg bg-green-500/15 text-green-400 border border-green-500/25 disabled:opacity-40"
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              disabled={busyUid === uid}
                              onClick={() => setConfirm({ open: true, uid, kind: 'reject' })}
                              className="text-xs font-bold px-3 py-1.5 rounded-lg bg-red-500/15 text-red-400 border border-red-500/25 disabled:opacity-40"
                            >
                              Reject
                            </button>
                          </div>
                        </td>
                      </tr>
                      {open && (
                        <tr className="bg-white/[.02] border-b border-surface-border/60">
                          <td colSpan={5} className="px-4 py-4 text-xs text-white/80">
                            <div className="grid lg:grid-cols-2 gap-4">
                              <div className="rounded-xl border border-surface-border bg-surface-dark/60 p-4 space-y-2">
                                <p className="text-[10px] font-extrabold text-white/45 uppercase tracking-wider">Personal</p>
                                {(row.personal_info && typeof row.personal_info === 'object')
                                  ? Object.entries(row.personal_info).map(([k, v]) => (
                                    <div key={k} className="flex justify-between gap-2 border-b border-white/5 pb-1.5 last:border-0">
                                      <span className="text-white/50 capitalize">{k.replace(/_/g, ' ')}</span>
                                      <span className="font-mono text-white text-right break-all max-w-[60%]">{String(v ?? '—')}</span>
                                    </div>
                                  ))
                                  : <p className="text-white/40">No personal info stored.</p>}
                              </div>
                              <div className="rounded-xl border border-surface-border bg-surface-dark/60 p-4 space-y-2">
                                <p className="text-[10px] font-extrabold text-white/45 uppercase tracking-wider">Document</p>
                                {(row.document_info && typeof row.document_info === 'object')
                                  ? Object.entries(row.document_info).map(([k, v]) => (
                                    <div key={k} className="flex justify-between gap-2 border-b border-white/5 pb-1.5 last:border-0">
                                      <span className="text-white/50 capitalize">{k.replace(/_/g, ' ')}</span>
                                      <span className="font-mono text-white text-right break-all max-w-[60%]">{String(v ?? '—')}</span>
                                    </div>
                                  ))
                                  : <p className="text-white/40">No document metadata.</p>}
                              </div>
                              <div className="rounded-xl border border-surface-border bg-surface-dark/60 p-4 space-y-2">
                                <p className="text-[10px] font-extrabold text-white/45 uppercase tracking-wider">PAN (DigiLocker)</p>
                                {row.pan_info?.linked ? (
                                  <>
                                    <div className="flex justify-between gap-2 border-b border-white/5 pb-1.5">
                                      <span className="text-white/50">Number</span>
                                      <span className="font-mono text-white text-right break-all max-w-[60%]">{row.pan_info.number}</span>
                                    </div>
                                    {row.pan_info.issuer && (
                                      <div className="flex justify-between gap-2 border-b border-white/5 pb-1.5">
                                        <span className="text-white/50">Issuer</span>
                                        <span className="text-white text-right max-w-[60%]">{row.pan_info.issuer}</span>
                                      </div>
                                    )}
                                  </>
                                ) : (
                                  <p className="text-white/40">PAN not linked in DigiLocker for this user.</p>
                                )}
                              </div>
                            </div>
                            <div className="mt-4 flex flex-wrap gap-4">
                              {row.document_front_url && (
                                <div className="rounded-xl border border-surface-border bg-surface-dark p-3 max-w-md">
                                  <p className="text-[10px] font-extrabold text-white/45 uppercase mb-2">ID front</p>
                                  {/\.(jpe?g|png|webp)$/i.test(row.document_front_url) ? (
                                    <a href={mediaUrl(row.document_front_url)} target="_blank" rel="noreferrer" className="block">
                                      <img src={mediaUrl(row.document_front_url)} alt="KYC front" className="max-h-56 rounded-lg object-contain border border-white/10" />
                                    </a>
                                  ) : (
                                    <a href={mediaUrl(row.document_front_url)} target="_blank" rel="noreferrer" className="text-gold-light font-bold hover:underline">
                                      Open file
                                    </a>
                                  )}
                                </div>
                              )}
                              {row.document_back_url && (
                                <div className="rounded-xl border border-surface-border bg-surface-dark p-3 max-w-md">
                                  <p className="text-[10px] font-extrabold text-white/45 uppercase mb-2">ID back</p>
                                  {/\.(jpe?g|png|webp)$/i.test(row.document_back_url) ? (
                                    <a href={mediaUrl(row.document_back_url)} target="_blank" rel="noreferrer" className="block">
                                      <img src={mediaUrl(row.document_back_url)} alt="KYC back" className="max-h-56 rounded-lg object-contain border border-white/10" />
                                    </a>
                                  ) : (
                                    <a href={mediaUrl(row.document_back_url)} target="_blank" rel="noreferrer" className="text-gold-light font-bold hover:underline">
                                      Open file
                                    </a>
                                  )}
                                </div>
                              )}
                              {!row.document_front_url && !row.document_back_url && (
                                <p className="text-white/40 text-sm">No document files attached for this submission.</p>
                              )}
                              {row.selfie_url && (
                                <div className="rounded-xl border border-surface-border bg-surface-dark p-3 max-w-md">
                                  <p className="text-[10px] font-extrabold text-white/45 uppercase mb-2">Selfie</p>
                                  {/\.(jpe?g|png|webp)$/i.test(row.selfie_url) ? (
                                    <a href={mediaUrl(row.selfie_url)} target="_blank" rel="noreferrer" className="block">
                                      <img src={mediaUrl(row.selfie_url)} alt="KYC selfie" className="max-h-56 rounded-lg object-contain border border-white/10" />
                                    </a>
                                  ) : (
                                    <a href={mediaUrl(row.selfie_url)} target="_blank" rel="noreferrer" className="text-gold-light font-bold hover:underline">
                                      Open file
                                    </a>
                                  )}
                                </div>
                              )}
                              {row.face_match && (
                                <div className="rounded-xl border border-surface-border bg-surface-dark p-3 min-w-[200px]">
                                  <p className="text-[10px] font-extrabold text-white/45 uppercase mb-2">Face match</p>
                                  <p className={`text-sm font-bold ${row.face_match.verified ? 'text-green-400' : 'text-red-400'}`}>
                                    {row.face_match.verified ? 'Verified' : 'Failed'}
                                  </p>
                                  {row.face_match.match_percentage && (
                                    <p className="text-xs text-white/55 mt-1">Match: {row.face_match.match_percentage}</p>
                                  )}
                                  {row.face_match.message && (
                                    <p className="text-xs text-white/45 mt-1">{row.face_match.message}</p>
                                  )}
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center justify-between mt-4 flex-wrap gap-3">
          <p className="text-white/50 text-sm">{total} pending · page {page} / {pages}</p>
          <div className="flex items-center gap-2">
            <select
              value={String(limit)}
              onChange={e => { setSkip(0); setLimit(Number(e.target.value)); }}
              className="rounded-xl bg-surface-card border border-surface-border px-3 py-2 text-white text-sm font-semibold"
            >
              {[10, 25, 50, 100].map(n => <option key={n} value={n}>{n}/page</option>)}
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
      <ConfirmModal
        open={confirm.open}
        title={confirm.kind === 'approve' ? 'Approve KYC submission' : 'Reject KYC submission'}
        message={confirm.kind === 'approve'
          ? 'Confirm KYC approval for this user.'
          : 'Confirm KYC rejection and provide reason visible to admin/user workflows.'}
        inputLabel={confirm.kind === 'reject' ? 'Rejection reason' : ''}
        inputPlaceholder="Documents insufficient or unclear"
        initialValue="Documents insufficient or unclear"
        required={confirm.kind === 'reject'}
        danger={confirm.kind === 'reject'}
        confirmText={confirm.kind === 'approve' ? 'Approve' : 'Reject'}
        busy={!!busyUid}
        onClose={() => { if (!busyUid) setConfirm({ open: false, uid: '', kind: 'approve' }); }}
        onConfirm={async (value) => {
          const uid = confirm.uid;
          const kind = confirm.kind;
          setConfirm({ open: false, uid: '', kind: 'approve' });
          if (!uid) return;
          if (kind === 'approve') await approve(uid);
          else await reject(uid, value || 'Rejected');
        }}
      />
    </div>
  );
}
