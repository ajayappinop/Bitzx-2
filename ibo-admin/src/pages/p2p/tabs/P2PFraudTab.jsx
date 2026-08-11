import { useEffect, useState, useCallback, useMemo } from 'react';
import { Loader2, AlertCircle, RefreshCw, Search, Ban, ShieldAlert } from 'lucide-react';
import { api } from '@/lib/api';
import { AdminDataTable } from '@/components/AdminPrimitives';

const RISK_PILL = {
  low:      'inline-flex items-center rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-extrabold uppercase text-emerald-300',
  medium:   'inline-flex items-center rounded-full border border-gold/30 bg-gold/10 px-2 py-0.5 text-[10px] font-extrabold uppercase text-gold-light',
  high:     'inline-flex items-center rounded-full border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[10px] font-extrabold uppercase text-rose-300',
  critical: 'inline-flex items-center rounded-full border border-rose-600/50 bg-rose-600/20 px-2 py-0.5 text-[10px] font-extrabold uppercase text-rose-200',
};

const fmtDate = (s) => {
  try { return new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return s || '—'; }
};

export default function P2PFraudTab() {
  const [items, setItems]     = useState([]);
  const [total, setTotal]     = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  /* Filters */
  const [riskFilter, setRiskFilter]   = useState('');
  const [bannedFilter, setBannedFilter] = useState('');
  const [uidSearch, setUidSearch]     = useState('');

  /* Pagination */
  const [skip, setSkip]   = useState(0);
  const [limit, setLimit] = useState(25);
  const pages = useMemo(() => Math.max(1, Math.ceil(total / limit)), [total, limit]);
  const page  = useMemo(() => Math.floor(skip / limit) + 1, [skip, limit]);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const params = { limit: String(limit), skip: String(skip) };
      if (riskFilter)   params.risk_level = riskFilter;
      if (bannedFilter) params.is_banned  = bannedFilter;
      if (uidSearch.trim()) params.uid    = uidSearch.trim();
      const res  = await api.p2p.fraudIntel(params);
      const data = await res.json();
      const list = data.users || data.fraud_users || data.results || [];
      setItems(list);
      setTotal(data.total ?? list.length);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [limit, skip, riskFilter, bannedFilter, uidSearch]);

  useEffect(() => { load(); }, [load]);

  const ban = async (uid) => {
    const dur    = window.prompt('Ban duration in hours (0 or blank = permanent):');
    if (dur === null) return;
    const reason = window.prompt('Reason for ban:') || 'P2P fraud';
    try {
      const res = await api.p2p.banUser(uid, { duration_hours: Number(dur) || null, reason });
      if (!res.ok) { const d = await res.json().catch(() => ({})); alert(d.detail || 'Failed'); return; }
      load();
    } catch (e) { alert(e.message); }
  };

  const unban = async (uid) => {
    if (!window.confirm(`Unban user ${uid}?`)) return;
    try {
      const res = await api.p2p.unbanUser(uid);
      if (!res.ok) { const d = await res.json().catch(() => ({})); alert(d.detail || 'Failed'); return; }
      load();
    } catch (e) { alert(e.message); }
  };

  return (
    <div className="space-y-4">
      {/* Info banner */}
      <div className="flex items-start gap-2 rounded-2xl border border-gold/20 bg-gold/5 px-4 py-3 text-sm text-gold-light/80">
        <ShieldAlert size={15} className="shrink-0 mt-0.5 text-gold-light" />
        Users flagged by automated fraud intelligence. High-risk users should be reviewed before banning.
      </div>

      {/* Filters */}
      <div className="rounded-2xl border border-surface-border bg-surface-card p-4">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <select
            value={riskFilter}
            onChange={(e) => { setSkip(0); setRiskFilter(e.target.value); }}
            className="rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white"
          >
            <option value="">All risk levels</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>

          <select
            value={bannedFilter}
            onChange={(e) => { setSkip(0); setBannedFilter(e.target.value); }}
            className="rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white"
          >
            <option value="">All (banned + active)</option>
            <option value="true">Banned only</option>
            <option value="false">Active only</option>
          </select>

          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/35 pointer-events-none" />
            <input
              value={uidSearch}
              onChange={(e) => { setSkip(0); setUidSearch(e.target.value); }}
              placeholder="Search by UID…"
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

      <AdminDataTable minWidth="1050px">
            <thead>
              <tr>
                <Th>UID</Th>
                <Th right>Strikes</Th>
                <Th right>Disputes Lost</Th>
                <Th right>Loss Rate</Th>
                <Th right>Cancel Rate 30d</Th>
                <Th right>Completion 30d</Th>
                <Th>Last Flagged</Th>
                <Th>Risk Level</Th>
                <Th>Banned</Th>
                <Th right>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={10} className="text-center text-white/50 !py-16"><Loader2 size={14} className="inline animate-spin mr-1" />Loading…</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={10} className="text-center text-white/50 !py-16">No fraud intelligence entries found.</td></tr>
              ) : items.map((u) => (
                <tr key={u.uid}>
                  <td className="font-mono text-[11px] text-white/80">{u.uid}</td>
                  <td className="text-right tabular-nums text-[12px] text-white/80">{u.strike_count ?? u.strikes ?? 0}</td>
                  <td className="text-right tabular-nums text-[12px] text-white/80">{u.disputes_lost ?? 0}</td>
                  <td className="text-right tabular-nums text-[12px] text-white/80">
                    <span className={(u.dispute_loss_rate ?? 0) > 50 ? 'text-rose-300' : ''}>{(u.dispute_loss_rate ?? 0).toFixed(0)}%</span>
                  </td>
                  <td className="text-right tabular-nums text-[12px] text-white/80">
                    <span className={(u.cancel_rate_30d ?? 0) > 30 ? 'text-gold-light' : ''}>{(u.cancel_rate_30d ?? 0).toFixed(0)}%</span>
                  </td>
                  <td className="text-right tabular-nums text-[12px] text-white/80">
                    {(u.completion_rate_30d ?? 0).toFixed(0)}%
                  </td>
                  <td className="text-[11px] text-white/50 whitespace-nowrap">{fmtDate(u.last_flag_at || u.updated_at)}</td>
                  <td>
                    <span className={RISK_PILL[u.risk_level] || RISK_PILL.low}>{u.risk_level || 'low'}</span>
                  </td>
                  <td className="text-[12px]">
                    {u.is_banned
                      ? <span className="text-rose-300 font-bold">Yes</span>
                      : <span className="text-white/30">No</span>}
                    {u.ban_expires_at && (
                      <div className="text-[10px] text-white/40">until {fmtDate(u.ban_expires_at)}</div>
                    )}
                  </td>
                  <td className="text-right">
                    {u.is_banned ? (
                      <button
                        type="button"
                        onClick={() => unban(u.uid)}
                        className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/30 px-2.5 py-1 text-[11px] font-bold text-emerald-300 hover:bg-emerald-500/10"
                      >
                        Unban
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => ban(u.uid)}
                        className="inline-flex items-center gap-1 rounded-lg border border-rose-500/30 px-2.5 py-1 text-[11px] font-bold text-rose-300 hover:bg-rose-500/10"
                      >
                        <Ban size={10} /> Ban
                      </button>
                    )}
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
