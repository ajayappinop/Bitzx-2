import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, AlertTriangle, Plus, Minus, Search } from 'lucide-react';
import { api } from '@/lib/api';
import { AdminDataTable } from '@/components/AdminPrimitives';

const fmt = (v, dp = 2) => Number.isFinite(Number(v)) ? Number(v).toLocaleString(undefined, { maximumFractionDigits: dp }) : '—';

export default function FuturesWalletAdjustmentsPage() {
  const [wallets, setWallets] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [filterUid, setFilterUid] = useState('');
  const [skip, setSkip] = useState(0);
  const [error, setError] = useState(null);

  // Adjust form
  const [uid, setUid] = useState('');
  const [direction, setDirection] = useState('credit');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(null);

  // User detail (txns + snapshot)
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadList = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const params = { limit: 100, skip };
      if (filterUid) params.uid = filterUid;
      const res = await api.futures.listWallets(params);
      const j = await res.json();
      if (!res.ok) throw new Error(j.detail || 'load failed');
      setWallets(j.wallets || []); setTotal(j.total || 0);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [filterUid, skip]);

  useEffect(() => { loadList(); }, [loadList]);

  const loadDetail = async (target) => {
    setDetailLoading(true); setError(null);
    try {
      const [snapRes, txnRes] = await Promise.all([
        api.futures.walletSnapshot(target),
        api.futures.walletTxns(target, { limit: 50 }),
      ]);
      const s = await snapRes.json(); const t = await txnRes.json();
      if (!snapRes.ok) throw new Error(s.detail || 'snapshot failed');
      if (!txnRes.ok) throw new Error(t.detail || 'txns failed');
      setDetail({ uid: target, snapshot: s, txns: t.txns || [] });
    } catch (e) { setError(e.message); }
    finally { setDetailLoading(false); }
  };

  const submit = async () => {
    if (!uid || !amount || !reason) {
      setError('uid, amount and reason are required');
      return;
    }
    setSubmitting(true); setError(null); setSubmitted(null);
    try {
      const res = await api.futures.adjustWallet({
        uid, direction, amount: Number(amount), reason, note,
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.detail || 'adjustment failed');
      setSubmitted(j);
      setAmount(''); setNote('');
      loadList();
      if (detail?.uid === uid) loadDetail(uid);
    } catch (e) { setError(e.message); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <p className="text-[12px] text-white/50">Inspect, audit, and adjust per-user margin balances.</p>
        <div className="flex items-center gap-2">
          <input placeholder="Filter by UID" value={filterUid}
            onChange={(e) => { setFilterUid(e.target.value); setSkip(0); }}
            className="bg-surface-card border border-surface-border rounded-lg px-3 py-1.5 text-sm" />
          <button onClick={loadList} className="text-white/60 hover:text-white">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 text-rose-300 px-4 py-2 text-sm flex items-center gap-2">
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      {/* Adjust */}
      <div className="rounded-2xl border border-surface-border bg-surface-card p-4">
        <div className="text-sm font-bold text-white mb-2">Adjust wallet</div>
        <p className="text-[12px] text-white/50 mb-3">
          Credit or debit a user's <strong>futures</strong> available balance. All adjustments are logged with your admin email.
        </p>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
          <input placeholder="User UID" value={uid} onChange={(e) => setUid(e.target.value)}
            className="bg-surface-dark border border-white/10 rounded px-3 py-2 text-sm font-mono text-white col-span-2" />
          <select value={direction} onChange={(e) => setDirection(e.target.value)}
            className="bg-surface-dark border border-white/10 rounded px-3 py-2 text-sm">
            <option value="credit">Credit (+)</option>
            <option value="debit">Debit (−)</option>
          </select>
          <input type="number" step="0.01" placeholder="Amount" value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="bg-surface-dark border border-white/10 rounded px-3 py-2 text-sm font-mono" />
          <input placeholder="Reason (e.g. compensation)" value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="bg-surface-dark border border-white/10 rounded px-3 py-2 text-sm" />
          <textarea placeholder="Note (optional)" value={note}
            onChange={(e) => setNote(e.target.value)}
            className="bg-surface-dark border border-white/10 rounded px-3 py-2 text-sm col-span-5" rows={2} />
        </div>
        <div className="flex items-center gap-3 mt-3">
          <button disabled={submitting} onClick={submit}
            className={`px-4 py-2 rounded-lg text-sm font-bold inline-flex items-center gap-2 ${
              direction === 'credit'
                ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-400/30 hover:bg-emerald-500/25'
                : 'bg-rose-500/15 text-rose-300 border border-rose-400/30 hover:bg-rose-500/25'
            } disabled:opacity-40`}>
            {direction === 'credit' ? <Plus size={14} /> : <Minus size={14} />}
            {submitting ? 'Submitting…' : `${direction === 'credit' ? 'Credit' : 'Debit'} ${amount || '0'} USDT`}
          </button>
          {submitted && (
            <span className="text-[12px] text-emerald-300">
              Done · {submitted.id?.slice(0, 14)}… · new available {fmt(submitted.balance_after?.available)} USDT
            </span>
          )}
        </div>
      </div>

      {/* Wallet list */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="lg:col-span-2 space-y-0">
          <div className="px-4 py-3 text-sm font-bold text-white">Top wallets</div>
          <AdminDataTable>
            <thead>
              <tr>
                <th>User</th>
                <th className="text-right">Available</th>
                <th className="text-right">Locked</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {wallets.length === 0 && !loading && (
                <tr><td colSpan={4} className="text-center text-white/40">No wallets.</td></tr>
              )}
              {wallets.map((w) => (
                <tr key={`${w.uid}_${w.asset}`}>
                  <td className="text-[12px] font-mono text-white/80">{w.uid}</td>
                  <td className="text-right font-mono">{fmt(w.available)}</td>
                  <td className="text-right font-mono">{fmt(w.locked)}</td>
                  <td className="text-right space-x-2">
                    <button onClick={() => { setUid(w.uid); }}
                      className="px-2 py-0.5 text-[12px] rounded bg-gold-light/15 text-gold-light border border-gold-light/30">
                      Adjust
                    </button>
                    <button onClick={() => loadDetail(w.uid)}
                      className="px-2 py-0.5 text-[12px] rounded bg-white/5 hover:bg-white/10 text-white/80">
                      <Search size={12} className="inline mr-1" />Inspect
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </AdminDataTable>
          <div className="px-4 py-2 flex items-center justify-between text-[12px] text-white/55">
            <span>{total} total · {skip + 1}–{Math.min(skip + wallets.length, total)}</span>
            <div className="flex gap-2">
              <button disabled={skip === 0} onClick={() => setSkip((s) => Math.max(0, s - 100))}
                className="px-2 py-0.5 rounded bg-white/5 disabled:opacity-30">Prev</button>
              <button disabled={skip + wallets.length >= total} onClick={() => setSkip((s) => s + 100)}
                className="px-2 py-0.5 rounded bg-white/5 disabled:opacity-30">Next</button>
            </div>
          </div>
        </div>

        {/* Detail panel */}
        <div className="rounded-2xl border border-surface-border bg-surface-card overflow-hidden">
          <div className="px-4 py-3 border-b border-white/10 text-sm font-bold text-white">User detail</div>
          <div className="p-4">
            {!detail ? (
              <div className="text-[12px] text-white/40">Click <strong>Inspect</strong> on a wallet row to load snapshot + recent ledger.</div>
            ) : (
              <>
                <div className="text-[12px] font-mono text-white/80 mb-2">UID: {detail.uid}</div>
                <div className="text-[11px] text-white/50">Margin balance</div>
                <div className="text-2xl font-mono font-extrabold text-white mb-1">{fmt(detail.snapshot?.margin_balance)} USDT</div>
                <div className="grid grid-cols-2 gap-2 text-[11px] text-white/55 mb-3">
                  <div>Available <span className="text-white font-mono float-right">{fmt(detail.snapshot?.available)}</span></div>
                  <div>Locked    <span className="text-white font-mono float-right">{fmt(detail.snapshot?.locked)}</span></div>
                  <div>Free margin <span className="text-gold-light font-mono float-right">{fmt(detail.snapshot?.free_margin)}</span></div>
                  <div>Unrealized PnL <span className={`float-right font-mono ${Number(detail.snapshot?.unrealized_pnl) >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>{fmt(detail.snapshot?.unrealized_pnl)}</span></div>
                </div>
                <div className="text-[11px] uppercase tracking-wider text-white/45 mb-1">Recent txns</div>
                <div className="max-h-72 overflow-y-auto divide-y divide-white/5 text-[12px]">
                  {detail.txns.map((t) => (
                    <div key={t.id} className="py-1.5">
                      <div className="flex items-center justify-between">
                        <span className="capitalize text-white/70">{t.type}</span>
                        <span className={`font-mono ${t.direction === 'credit' ? 'text-emerald-300' : 'text-rose-300'}`}>
                          {t.direction === 'credit' ? '+' : '−'}{fmt(t.amount, 4)}
                        </span>
                      </div>
                      <div className="text-[10px] text-white/40">{(t.created_at || '').slice(0, 19).replace('T', ' ')} · {t.ref_type || ''}</div>
                    </div>
                  ))}
                  {detail.txns.length === 0 && <div className="text-white/40 py-4 text-center">No transactions.</div>}
                </div>
                {detailLoading && <div className="text-[11px] text-white/45 mt-2">loading…</div>}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
