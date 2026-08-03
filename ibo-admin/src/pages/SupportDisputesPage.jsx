import { useEffect, useMemo, useState } from 'react';
import { HelpCircle, RefreshCw, Send, Eye, CheckCircle, Clock, MessageSquare, Zap, X } from 'lucide-react';
import { api } from '@/lib/api';
import { AdminPageHeader } from '@/components/AdminPrimitives';

const STATUS = ['all', 'open', 'in_progress', 'waiting_user', 'resolved', 'closed'];
const PRIORITY = ['low', 'normal', 'high', 'urgent'];

function statusChipClass(status) {
  if (status === 'resolved' || status === 'closed') return 'bg-[#0ECB81]/20 text-[#0ECB81]';
  if (status === 'in_progress') return 'bg-[#3B82F6]/20 text-[#3B82F6]';
  if (status === 'waiting_user') return 'bg-[#8B5CF6]/20 text-[#8B5CF6]';
  return 'bg-[#0EA4AB]/20 text-[#0EA4AB]';
}

function priorityChipClass(priority) {
  if (priority === 'urgent') return 'bg-[#F6465D] text-white';
  if (priority === 'high') return 'bg-[#F6465D]/20 text-[#F6465D]';
  if (priority === 'normal') return 'bg-[#0EA4AB]/20 text-[#0EA4AB]';
  return 'bg-[#848E9C]/20 text-[#848E9C]';
}

export default function SupportDisputesPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [ticket, setTicket] = useState(null);
  const [showTicketModal, setShowTicketModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [filters, setFilters] = useState({ q: '', status: 'all', priority: '' });
  const [reply, setReply] = useState('');
  const [internalNote, setInternalNote] = useState(false);

  async function loadList() {
    setLoading(true);
    setError('');
    try {
      const q = { ...filters, limit: 100 };
      if (q.status === 'all') delete q.status;
      const res = await api.supportTickets(q);
      const body = await res.json();
      if (!res.ok) throw new Error(body?.detail || 'Failed to load support tickets');
      setItems(Array.isArray(body.items) ? body.items : []);
      if (!selectedId && body.items?.length) setSelectedId(body.items[0].id);
    } catch (e) {
      setError(e.message || 'Failed to load support tickets');
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
  }, [filters.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const stats = useMemo(() => {
    const s = { total: items.length, open: 0, inProgress: 0, resolved: 0, avgResponse: '2.5h' };
    for (const t of items) {
      if (t.status === 'open' || t.status === 'in_progress' || t.status === 'waiting_user') s.open += 1;
      if (t.status === 'in_progress') s.inProgress += 1;
      if (t.status === 'resolved' || t.status === 'closed') s.resolved += 1;
    }
    return s;
  }, [items]);

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
    <div className="space-y-6">
      <AdminPageHeader
        icon={HelpCircle}
        title="Support & Disputes"
        subtitle="Manage user tickets and dispute resolution in Coinzii-aligned layout."
      />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard title="Open Tickets" value={stats.open} icon={MessageSquare} color="yellow" />
        <StatCard title="In Progress" value={stats.inProgress} icon={Clock} color="blue" />
        <StatCard title="Resolved" value={stats.resolved} icon={CheckCircle} color="green" />
        <StatCard title="Avg Response Time" value={stats.avgResponse} icon={Zap} color="purple" />
      </div>

      {error ? <div className="rounded-lg border border-[#F6465D]/40 bg-[#F6465D]/10 p-3 text-sm text-[#F6465D]">{error}</div> : null}

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-2 flex-wrap">
          {STATUS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilters((p) => ({ ...p, status: f }))}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${
                filters.status === f ? 'bg-[#0EA4AB] text-[#0B0E11]' : 'bg-[#1E2329] text-[#848E9C] hover:text-white'
              }`}
            >
              {f === 'in_progress' ? 'In Progress' : f === 'waiting_user' ? 'Waiting User' : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        <button type="button" onClick={loadList} className="px-3 py-2 rounded-lg bg-[#1E2329] text-[#848E9C] hover:text-white inline-flex items-center gap-2">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      <div className="bg-[#1E2329] rounded-xl border border-[#2B3139]">
        <div className="p-4 border-b border-[#2B3139] flex items-center justify-between gap-3">
          <h3 className="text-white font-semibold">Support Tickets</h3>
          <div className="flex gap-2">
            <input
              className="px-3 py-2 bg-[#0B0E11] border border-[#2B3139] rounded-lg text-white placeholder-[#5E6673] text-sm"
              placeholder="Search by ticket, uid, subject"
              value={filters.q}
              onChange={(e) => setFilters((p) => ({ ...p, q: e.target.value }))}
            />
            <select
              className="px-3 py-2 bg-[#0B0E11] border border-[#2B3139] rounded-lg text-white text-sm"
              value={filters.priority}
              onChange={(e) => setFilters((p) => ({ ...p, priority: e.target.value }))}
            >
              <option value="">All Priority</option>
              {PRIORITY.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <button type="button" onClick={loadList} className="px-3 py-2 bg-[#0EA4AB] text-[#0B0E11] rounded-lg text-sm font-semibold">
              Apply
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-[#848E9C] text-xs border-b border-[#2B3139]">
                <th className="text-left p-4">Ticket ID</th>
                <th className="text-left p-4">Subject</th>
                <th className="text-left p-4">User</th>
                <th className="text-center p-4">Priority</th>
                <th className="text-center p-4">Status</th>
                <th className="text-left p-4">Updated</th>
                <th className="text-center p-4">Actions</th>
              </tr>
            </thead>
            <tbody>
              {!loading && items.length === 0 ? (
                <tr>
                  <td className="p-6 text-center text-[#848E9C]" colSpan={7}>No tickets found.</td>
                </tr>
              ) : null}
              {items.map((t) => (
                <tr key={t.id} className="border-b border-[#2B3139] hover:bg-[#0B0E11]/50">
                  <td className="p-4 text-white font-mono">{t.id}</td>
                  <td className="p-4 text-white">{t.subject}</td>
                  <td className="p-4 text-[#848E9C]">{t.user_email || t.uid}</td>
                  <td className="p-4 text-center">
                    <span className={`px-2 py-1 rounded text-xs ${priorityChipClass(t.priority)}`}>{t.priority}</span>
                  </td>
                  <td className="p-4 text-center">
                    <span className={`px-2 py-1 rounded text-xs ${statusChipClass(t.status)}`}>
                      {t.status === 'in_progress' ? 'In Progress' : t.status}
                    </span>
                  </td>
                  <td className="p-4 text-[#848E9C] text-sm">{t.updated_at || t.created_at}</td>
                  <td className="p-4 text-center">
                    <div className="flex justify-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedId(t.id);
                          loadTicket(t.id);
                        }}
                        className="p-1.5 bg-[#3B82F6]/20 text-[#3B82F6] rounded hover:bg-[#3B82F6]/30"
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
                        className="p-1.5 bg-[#0ECB81]/20 text-[#0ECB81] rounded hover:bg-[#0ECB81]/30"
                      >
                        <CheckCircle size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showTicketModal && ticket ? (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[70] p-4">
          <div className="bg-[#1E2329] rounded-xl w-full max-w-2xl max-h-[80vh] overflow-hidden border border-[#2B3139]">
            <div className="p-4 border-b border-[#2B3139] flex items-center justify-between">
              <div>
                <h3 className="text-white font-semibold">{ticket.id}: {ticket.subject}</h3>
                <p className="text-sm text-[#848E9C]">{ticket.user_email || ticket.uid}</p>
              </div>
              <button type="button" onClick={() => setShowTicketModal(false)} className="text-[#848E9C] hover:text-white"><X size={20} /></button>
            </div>
            <div className="p-4 flex gap-2">
              <select className="px-3 py-2 bg-[#0B0E11] border border-[#2B3139] rounded-lg text-white text-sm" value={ticket.status || 'open'} onChange={(e) => updateTicket({ status: e.target.value })} disabled={saving}>
                {STATUS.filter((s) => s !== 'all').map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <select className="px-3 py-2 bg-[#0B0E11] border border-[#2B3139] rounded-lg text-white text-sm" value={ticket.priority || 'normal'} onChange={(e) => updateTicket({ priority: e.target.value })} disabled={saving}>
                {PRIORITY.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="p-4 max-h-[44vh] overflow-y-auto space-y-4">
              {(ticket.messages || []).map((m) => (
                <div key={m.id} className={`flex ${m.from_type === 'admin' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] p-3 rounded-lg ${m.from_type === 'admin' ? 'bg-[#0EA4AB]/20 text-white' : 'bg-[#0B0E11] text-[#D1D5DB]'}`}>
                    <p className="text-sm whitespace-pre-wrap">{m.message}</p>
                    <p className="text-xs text-[#5E6673] mt-1">
                      {m.from_type === 'admin' ? (m.from_email || 'admin') : 'user'} • {m.created_at} {m.internal_note ? ' • internal' : ''}
                    </p>
                  </div>
                </div>
              ))}
            </div>
            <div className="p-4 border-t border-[#2B3139] space-y-2">
              <div className="flex gap-2">
                <input type="text" value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Type your reply..." className="flex-1 px-4 py-2 bg-[#0B0E11] border border-[#2B3139] rounded-lg text-white placeholder-[#5E6673]" />
                <button type="button" onClick={sendReply} disabled={saving || !reply.trim()} className="px-4 py-2 bg-[#0EA4AB] text-[#0B0E11] rounded-lg font-medium inline-flex items-center gap-2">
                  <Send size={14} /> Send
                </button>
              </div>
              <label className="inline-flex items-center gap-2 text-sm text-[#848E9C]">
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
    yellow: 'bg-gradient-to-br from-[#0EA4AB]/20 to-[#0EA4AB]/5 border-[#0EA4AB]/30',
    blue: 'bg-gradient-to-br from-[#3B82F6]/20 to-[#3B82F6]/5 border-[#3B82F6]/30',
    green: 'bg-gradient-to-br from-[#0ECB81]/20 to-[#0ECB81]/5 border-[#0ECB81]/30',
    purple: 'bg-gradient-to-br from-[#8B5CF6]/20 to-[#8B5CF6]/5 border-[#8B5CF6]/30',
  };
  return (
    <div className={`rounded-xl border p-4 ${map[color] || map.yellow}`}>
      <div className="flex items-center justify-between">
        <p className="text-[#848E9C] text-sm">{title}</p>
        <Icon size={18} className="text-white/80" />
      </div>
      <p className="text-2xl font-bold text-white mt-2">{value}</p>
    </div>
  );
}
