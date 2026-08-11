import { useEffect, useMemo, useState } from 'react';
import { HelpCircle, RefreshCw, Send, Eye, CheckCircle, Clock, MessageSquare, Zap, X } from 'lucide-react';
import { api } from '@/lib/api';
import { AdminPageHeader, AdminDataTable } from '@/components/AdminPrimitives';

const STATUS = ['all', 'open', 'in_progress', 'waiting_user', 'resolved', 'closed'];
const PRIORITY = ['low', 'normal', 'high', 'urgent'];

function statusLabel(status) {
  if (status === 'in_progress') return 'In Progress';
  if (status === 'waiting_user') return 'Waiting User';
  if (!status) return '—';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function statusChipClass(status) {
  if (status === 'resolved' || status === 'closed') return 'bg-[#00A876]/20 text-[#00A876]';
  if (status === 'in_progress') return 'bg-[#FE6C02]/20 text-[#FE6C02]';
  if (status === 'waiting_user') return 'bg-[#B44D01]/20 text-[#FE9D55]';
  return 'bg-[#FE6C02]/20 text-[#FE9D55]';
}

function priorityChipClass(priority) {
  if (priority === 'urgent') return 'bg-[#EB5454] text-white';
  if (priority === 'high') return 'bg-[#EB5454]/20 text-[#EB5454]';
  if (priority === 'normal') return 'bg-[#FE6C02]/20 text-[#FE6C02]';
  return 'bg-[#848E9C]/20 text-[color:var(--ibo-ink-secondary)]';
}

export default function SupportDisputesPage() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [ticket, setTicket] = useState(null);
  const [showTicketModal, setShowTicketModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [filters, setFilters] = useState({ q: '', status: 'all', priority: '' });
  const [skip, setSkip] = useState(0);
  const [limit, setLimit] = useState(25);
  const [reply, setReply] = useState('');
  const [internalNote, setInternalNote] = useState(false);

  async function loadList(override) {
    const active = { ...filters, ...(override || {}) };
    const nextSkip = override?.skip ?? skip;
    const nextLimit = override?.limit ?? limit;
    setLoading(true);
    setError('');
    try {
      const q = {
        status: active.status,
        priority: active.priority,
        q: active.q,
        skip: String(nextSkip),
        limit: String(nextLimit),
      };
      if (q.status === 'all') delete q.status;
      if (!q.priority) delete q.priority;
      if (!q.q?.trim()) delete q.q;
      else q.q = q.q.trim();
      const res = await api.supportTickets(q);
      const body = await res.json();
      if (!res.ok) throw new Error(body?.detail || 'Failed to load support tickets');
      const nextItems = Array.isArray(body.items) ? body.items : [];
      setItems(nextItems);
      setTotal(Number.isFinite(body.total) ? body.total : nextItems.length);
      if (!selectedId && nextItems.length) setSelectedId(nextItems[0].id);
    } catch (e) {
      setError(e.message || 'Failed to load support tickets');
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }

  async function loadTicket(id) {
    if (!id) {
      setTicket(null);
      return;
    }
    try {
      const res = await api.supportTicket(id);
      const body = await res.json();
      if (!res.ok) throw new Error(body?.detail || 'Failed to load ticket');
      setTicket(body);
      setShowTicketModal(true);
    } catch (e) {
      setError(e.message || 'Failed to load ticket');
    }
  }

  useEffect(() => {
    loadList();
  }, [filters.status, filters.priority, skip, limit]); // eslint-disable-line react-hooks/exhaustive-deps

  function clearFilters() {
    const next = { q: '', status: 'all', priority: '' };
    setFilters(next);
    setSkip(0);
    loadList({ ...next, skip: 0 });
  }

  const pages = useMemo(() => Math.max(1, Math.ceil(total / limit)), [total, limit]);
  const page = useMemo(() => Math.floor(skip / limit) + 1, [skip, limit]);

  const stats = useMemo(() => {
    const s = { total, open: 0, inProgress: 0, resolved: 0, avgResponse: '2.5h' };
    for (const t of items) {
      if (t.status === 'open' || t.status === 'in_progress' || t.status === 'waiting_user') s.open += 1;
      if (t.status === 'in_progress') s.inProgress += 1;
      if (t.status === 'resolved' || t.status === 'closed') s.resolved += 1;
    }
    return s;
  }, [items, total]);

  async function updateTicket(patch) {
    if (!ticket?.id) return;
    setSaving(true);
    try {
      const res = await api.patchSupportTicket(ticket.id, patch);
      const body = await res.json();
      if (!res.ok) throw new Error(body?.detail || 'Update failed');
      setTicket(body);
      setItems((prev) => prev.map((x) => (x.id === body.id ? body : x)));
    } catch (e) {
      setError(e.message || 'Update failed');
    } finally {
      setSaving(false);
    }
  }

  async function sendReply() {
    if (!ticket?.id || !reply.trim()) return;
    setSaving(true);
    try {
      const res = await api.supportTicketMessage(ticket.id, { message: reply.trim(), internal_note: internalNote });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.detail || 'Reply failed');
      setReply('');
      setInternalNote(false);
      setTicket(body);
      setItems((prev) => prev.map((x) => (x.id === body.id ? body : x)));
    } catch (e) {
      setError(e.message || 'Reply failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="admin-page space-y-6">
      <AdminPageHeader
        icon={HelpCircle}
        title="Support & Disputes"
        subtitle="Manage user tickets and dispute resolution."
      />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard title="Open Tickets" value={stats.open} icon={MessageSquare} color="yellow" />
        <StatCard title="In Progress" value={stats.inProgress} icon={Clock} color="blue" />
        <StatCard title="Resolved" value={stats.resolved} icon={CheckCircle} color="green" />
        <StatCard title="Avg Response Time" value={stats.avgResponse} icon={Zap} color="purple" />
      </div>

      {error ? <div className="rounded-lg border border-[#EB5454]/40 bg-[#EB5454]/10 p-3 text-sm text-[#EB5454]">{error}</div> : null}

      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between rounded-xl border border-surface-border bg-surface-card px-3 py-2.5">
        <h3 className="text-sm font-extrabold text-white shrink-0">Support Tickets</h3>
        <div className="flex flex-wrap items-center gap-2 min-w-0 sm:justify-end">
          <input
            className="h-9 min-w-0 w-full sm:w-56 rounded-lg bg-surface-dark border border-surface-border px-3 text-sm text-white placeholder:text-white/35 outline-none focus:border-gold/40"
            placeholder="Search ticket, uid, subject…"
            value={filters.q}
            onChange={(e) => setFilters((p) => ({ ...p, q: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                setSkip(0);
                loadList({ ...filters, q: e.currentTarget.value, skip: 0 });
              }
            }}
          />
          <select
            className="h-9 rounded-lg bg-surface-dark border border-surface-border px-3 text-sm font-semibold text-white"
            value={filters.status}
            onChange={(e) => {
              setSkip(0);
              setFilters((p) => ({ ...p, status: e.target.value }));
            }}
            aria-label="Filter by status"
          >
            {STATUS.map((f) => (
              <option key={f} value={f}>{statusLabel(f)}</option>
            ))}
          </select>
          <select
            className="h-9 rounded-lg bg-surface-dark border border-surface-border px-3 text-sm font-semibold text-white"
            value={filters.priority}
            onChange={(e) => {
              setSkip(0);
              setFilters((p) => ({ ...p, priority: e.target.value }));
            }}
            aria-label="Filter by priority"
          >
            <option value="">All priority</option>
            {PRIORITY.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <button
            type="button"
            onClick={clearFilters}
            className="h-9 px-4 rounded-lg border border-surface-border text-sm font-bold text-white/90 shrink-0"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={() => loadList()}
            className="inline-flex h-9 items-center gap-2 px-3 rounded-lg border border-surface-border text-sm font-bold text-white/90 shrink-0"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      <AdminDataTable>
        <thead>
          <tr>
            <th>Ticket ID</th>
            <th>Subject</th>
            <th>User</th>
            <th className="text-center">Priority</th>
            <th className="text-center">Status</th>
            <th>Updated</th>
            <th className="text-center">Actions</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td className="text-center text-white/50 !py-16" colSpan={7}>Loading…</td>
            </tr>
          ) : items.length === 0 ? (
            <tr>
              <td className="text-center text-white/50 !py-16" colSpan={7}>No tickets found.</td>
            </tr>
          ) : (
            items.map((t) => (
              <tr key={t.id}>
                <td className="font-mono text-white">{t.id}</td>
                <td className="text-white">{t.subject}</td>
                <td className="text-white/60">{t.user_email || t.uid}</td>
                <td className="text-center">
                  <span className={`px-2 py-1 rounded text-xs ${priorityChipClass(t.priority)}`}>{t.priority}</span>
                </td>
                <td className="text-center">
                  <span className={`px-2 py-1 rounded text-xs ${statusChipClass(t.status)}`}>
                    {statusLabel(t.status)}
                  </span>
                </td>
                <td className="text-white/55 text-sm whitespace-nowrap">{t.updated_at || t.created_at}</td>
                <td className="text-center">
                  <div className="flex justify-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedId(t.id);
                        loadTicket(t.id);
                      }}
                      className="p-1.5 bg-[#FE6C02]/20 text-[#FE6C02] rounded hover:bg-[#FE6C02]/30"
                    >
                      <Eye size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedId(t.id);
                        setTicket(t);
                        updateTicket({ status: 'resolved' });
                      }}
                      className="p-1.5 bg-[#00A876]/20 text-[#00A876] rounded hover:bg-[#00A876]/30"
                    >
                      <CheckCircle size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </AdminDataTable>

      <div className="flex items-center justify-between flex-wrap gap-3">
        <p className="text-white/50 text-sm">{total} rows · page {page} / {pages}</p>
        <div className="flex items-center gap-2">
          <select
            value={String(limit)}
            onChange={(e) => { setSkip(0); setLimit(Number(e.target.value)); }}
            className="rounded-xl bg-surface-card border border-surface-border px-3 py-2 text-white text-sm font-semibold"
          >
            {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n}/page</option>)}
          </select>
          <button
            type="button"
            disabled={skip <= 0 || loading}
            onClick={() => setSkip((s) => Math.max(0, s - limit))}
            className="px-4 py-2 rounded-xl border border-surface-border text-sm font-bold disabled:opacity-40"
          >
            Prev
          </button>
          <button
            type="button"
            disabled={skip + limit >= total || loading}
            onClick={() => setSkip((s) => s + limit)}
            className="px-4 py-2 rounded-xl border border-surface-border text-sm font-bold disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>

      {showTicketModal && ticket ? (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[70] p-4">
          <div className="bg-surface-card rounded-xl w-full max-w-2xl max-h-[80vh] overflow-hidden border border-surface-border">
            <div className="p-4 border-b border-surface-border flex items-center justify-between">
              <div>
                <h3 className="text-white font-semibold">{ticket.id}: {ticket.subject}</h3>
                <p className="text-sm text-[color:var(--ibo-ink-secondary)]">{ticket.user_email || ticket.uid}</p>
              </div>
              <button type="button" onClick={() => setShowTicketModal(false)} className="text-[color:var(--ibo-ink-secondary)] hover:text-white"><X size={20} /></button>
            </div>
            <div className="p-4 flex gap-2">
              <select className="px-3 py-2 bg-surface-dark border border-surface-border rounded-lg text-white text-sm" value={ticket.status || 'open'} onChange={(e) => updateTicket({ status: e.target.value })} disabled={saving}>
                {STATUS.filter((s) => s !== 'all').map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
              </select>
              <select className="px-3 py-2 bg-surface-dark border border-surface-border rounded-lg text-white text-sm" value={ticket.priority || 'normal'} onChange={(e) => updateTicket({ priority: e.target.value })} disabled={saving}>
                {PRIORITY.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="p-4 max-h-[44vh] overflow-y-auto space-y-4">
              {(ticket.messages || []).map((m) => (
                <div key={m.id} className={`flex ${m.from_type === 'admin' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] p-3 rounded-lg ${m.from_type === 'admin' ? 'bg-[#FE6C02]/20 text-white' : 'bg-surface-dark text-[color:var(--ibo-ink)]'}`}>
                    <p className="text-sm whitespace-pre-wrap">{m.message}</p>
                    <p className="text-xs text-[#5E6673] mt-1">
                      {m.from_type === 'admin' ? (m.from_email || 'admin') : 'user'} • {m.created_at} {m.internal_note ? ' • internal' : ''}
                    </p>
                  </div>
                </div>
              ))}
            </div>
            <div className="p-4 border-t border-surface-border space-y-2">
              <div className="flex gap-2">
                <input type="text" value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Type your reply..." className="flex-1 px-4 py-2 bg-surface-dark border border-surface-border rounded-lg text-white placeholder:text-[color:var(--ibo-muted)]" />
                <button type="button" onClick={sendReply} disabled={saving || !reply.trim()} className="px-4 py-2 bg-[#FE6C02] text-[#101013] rounded-lg font-medium inline-flex items-center gap-2">
                  <Send size={14} /> Send
                </button>
              </div>
              <label className="inline-flex items-center gap-2 text-sm text-[color:var(--ibo-ink-secondary)]">
                <input type="checkbox" checked={internalNote} onChange={(e) => setInternalNote(e.target.checked)} />
                Internal note only
              </label>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function StatCard({ title, value, icon: Icon, color = 'yellow' }) {
  const map = {
    yellow: 'bg-gradient-to-br from-[#FE6C02]/20 to-[#FE6C02]/5 border-[#FE6C02]/30',
    blue: 'bg-gradient-to-br from-[#FE6C02]/20 to-[#FE6C02]/5 border-[#FE6C02]/30',
    green: 'bg-gradient-to-br from-[#00A876]/20 to-[#00A876]/5 border-[#00A876]/30',
    purple: 'bg-gradient-to-br from-[#B44D01]/20 to-[#B44D01]/5 border-[#B44D01]/30',
  };
  return (
    <div className={`rounded-xl border p-4 ${map[color] || map.yellow}`}>
      <div className="flex items-center justify-between">
        <p className="text-[color:var(--ibo-ink-secondary)] text-sm">{title}</p>
        <Icon size={18} className="text-white/80" />
      </div>
      <p className="text-2xl font-bold text-white mt-2">{value}</p>
    </div>
  );
}
