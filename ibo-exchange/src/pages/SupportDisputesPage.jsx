import { useEffect, useMemo, useState } from 'react';
import { HelpCircle, RefreshCw, Send, MessageSquare, Clock, CheckCircle, Zap } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { exchangeApiOrigin } from '@/lib/apiBase';

const API = exchangeApiOrigin(import.meta.env.VITE_BACKEND_URL);

function token() {
  return localStorage.getItem('ibo_ex_token') || '';
}

async function authJson(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  const t = token();
  if (t) headers.Authorization = `Bearer ${t}`;
  const res = await fetch(`${API}${path}`, { ...options, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.detail || `Request failed (${res.status})`);
  return body;
}

export default function SupportDisputesPage() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ subject: '', category: 'general', priority: 'normal', message: '' });
  const [reply, setReply] = useState('');
  const [saving, setSaving] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await authJson('/api/support/tickets?limit=100');
      const rows = Array.isArray(data.items) ? data.items : [];
      setItems(rows);
      if (rows.length && !selected) setSelected(rows[0]);
    } catch (e) {
      setError(e.message || 'Failed to load support tickets');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function createTicket(e) {
    e.preventDefault();
    if (!form.subject.trim() || !form.message.trim()) return;
    setSaving(true);
    try {
      const created = await authJson('/api/support/tickets', {
        method: 'POST',
        body: JSON.stringify({
          subject: form.subject.trim(),
          category: form.category,
          priority: form.priority,
          message: form.message.trim(),
        }),
      });
      setForm({ subject: '', category: 'general', priority: 'normal', message: '' });
      setItems((prev) => [created, ...prev]);
      setSelected(created);
    } catch (e2) {
      setError(e2.message || 'Failed to create ticket');
    } finally {
      setSaving(false);
    }
  }

  async function sendReply() {
    if (!selected?.id || !reply.trim()) return;
    setSaving(true);
    try {
      const updated = await authJson(`/api/support/tickets/${encodeURIComponent(selected.id)}/messages`, {
        method: 'POST',
        body: JSON.stringify({ message: reply.trim() }),
      });
      setReply('');
      setSelected(updated);
      setItems((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
    } catch (e) {
      setError(e.message || 'Failed to send message');
    } finally {
      setSaving(false);
    }
  }

  const openCount = useMemo(
    () => items.filter((x) => x.status !== 'resolved' && x.status !== 'closed').length,
    [items],
  );
  const inProgressCount = useMemo(() => items.filter((x) => x.status === 'in_progress').length, [items]);
  const resolvedCount = useMemo(() => items.filter((x) => x.status === 'resolved' || x.status === 'closed').length, [items]);
  const visibleItems = useMemo(
    () => (statusFilter === 'all' ? items : items.filter((x) => x.status === statusFilter)),
    [items, statusFilter],
  );

  return (
    <div className="ibo-page font-ui">
      <div className="w-full max-w-[1300px] mx-auto px-4 sm:px-6 py-8 space-y-6">
        <div className="ibo-account-hero">
          <p className="ibo-eyebrow mb-2">Help</p>
          <h1 className="ibo-account-title inline-flex items-center gap-2.5">
            <HelpCircle size={26} className="text-gold shrink-0" />
            Support &amp; Disputes
          </h1>
          <p className="ibo-account-subtitle max-w-xl">
            Raise support cases, track dispute progress, and chat with our team.
          </p>
          <p className="mt-2 text-sm text-gold font-medium">
            {user?.email || 'Logged in user'} · Open tickets: {openCount}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
          <StatCard title="Open Tickets" value={openCount} icon={MessageSquare} tone="cyan" />
          <StatCard title="In Progress" value={inProgressCount} icon={Clock} tone="blue" />
          <StatCard title="Resolved" value={resolvedCount} icon={CheckCircle} tone="green" />
          <StatCard title="Avg Response Time" value="2.5h" icon={Zap} tone="lime" />
        </div>

        {error ? (
          <div className="ibo-notice-danger text-sm font-medium">{error}</div>
        ) : null}

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 lg:gap-5">
          <div className="ibo-account-panel space-y-4">
            <div>
              <h2 className="font-display text-base font-bold text-ink mb-1">New ticket</h2>
              <p className="text-xs text-ink-muted mb-3">Describe the issue and we will follow up in-thread.</p>
            </div>
            <form onSubmit={createTicket} className="space-y-2.5">
              <input
                className="ibo-input"
                placeholder="Subject"
                value={form.subject}
                onChange={(e) => setForm((p) => ({ ...p, subject: e.target.value }))}
              />
              <div className="grid grid-cols-2 gap-2">
                <select
                  className="ibo-input py-2.5"
                  value={form.category}
                  onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))}
                >
                  <option value="general">General</option>
                  <option value="deposit">Deposit</option>
                  <option value="withdrawal">Withdrawal</option>
                  <option value="trade">Trade</option>
                  <option value="dispute">Dispute</option>
                  <option value="security">Security</option>
                </select>
                <select
                  className="ibo-input py-2.5"
                  value={form.priority}
                  onChange={(e) => setForm((p) => ({ ...p, priority: e.target.value }))}
                >
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
              <textarea
                className="ibo-input min-h-[96px] resize-y"
                placeholder="Describe your issue..."
                value={form.message}
                onChange={(e) => setForm((p) => ({ ...p, message: e.target.value }))}
              />
              <button type="submit" disabled={saving} className="ibo-btn-primary w-full disabled:opacity-50">
                Create Ticket
              </button>
            </form>

            <div className="h-px bg-[color:var(--ibo-border)]" />

            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-ink">My Tickets</p>
              <button
                type="button"
                onClick={load}
                className="ibo-btn-outline !px-3 !py-1.5 text-xs"
              >
                <RefreshCw size={13} /> Refresh
              </button>
            </div>
            <div className="flex gap-2 flex-wrap">
              {['all', 'open', 'in_progress', 'resolved'].map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setStatusFilter(f)}
                  className={`ibo-mode-chip ${statusFilter === f ? 'ibo-mode-chip-active' : ''}`}
                >
                  {f === 'in_progress' ? 'In Progress' : f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
            <div className="space-y-2 max-h-[420px] overflow-auto pr-1">
              {!loading && visibleItems.length === 0 ? (
                <p className="text-sm text-ink-muted py-4 text-center">No tickets yet.</p>
              ) : null}
              {visibleItems.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setSelected(t)}
                  className={`w-full text-left rounded-xl border p-3.5 transition-colors ${
                    selected?.id === t.id
                      ? 'border-gold/40 bg-gold/10'
                      : 'border-[color:var(--ibo-border)] bg-[color:var(--ibo-elevated)] hover:border-gold/25'
                  }`}
                >
                  <p className="text-[11px] text-gold font-mono tracking-wide">{t.id}</p>
                  <p className="text-sm font-semibold text-ink mt-1 leading-snug">{t.subject}</p>
                  <p className="text-xs text-ink-muted mt-1.5 capitalize">
                    {String(t.status || '').replace(/_/g, ' ')} · {t.priority}
                  </p>
                </button>
              ))}
            </div>
          </div>

          <div className="xl:col-span-2 ibo-account-panel">
            {!selected ? (
              <div className="flex flex-col items-center justify-center min-h-[280px] text-center px-4">
                <MessageSquare size={28} className="text-gold/70 mb-3" />
                <p className="text-ink-secondary text-sm">Select a ticket to view the conversation.</p>
              </div>
            ) : (
              <div className="space-y-4 h-full flex flex-col">
                <div className="pb-3 border-b border-[color:var(--ibo-border)]">
                  <h3 className="font-display text-lg sm:text-xl font-bold text-ink">{selected.subject}</h3>
                  <p className="text-sm text-ink-muted mt-1">
                    <span className="font-mono text-gold/90">{selected.id}</span>
                    {' · '}
                    {selected.category}
                    {' · '}
                    <span className="capitalize">{String(selected.status || '').replace(/_/g, ' ')}</span>
                  </p>
                </div>
                <div className="rounded-xl border border-[color:var(--ibo-border)] bg-[color:var(--ibo-elevated)] p-3 sm:p-4 space-y-2.5 max-h-[450px] overflow-auto flex-1">
                  {(selected.messages || []).map((m) => (
                    <div
                      key={m.id}
                      className={`rounded-xl p-3 border ${
                        m.from_type === 'admin'
                          ? 'border-gold/30 bg-gold/10'
                          : 'border-[color:var(--ibo-border)] bg-[color:var(--ibo-card)]'
                      }`}
                    >
                      <p className="text-[11px] text-ink-muted font-medium">
                        {m.from_type === 'admin' ? 'Support Team' : 'You'} · {m.created_at}
                      </p>
                      <p className="text-sm text-ink whitespace-pre-wrap mt-1.5 leading-relaxed">{m.message}</p>
                    </div>
                  ))}
                </div>
                <div className="flex flex-col sm:flex-row gap-2 pt-1">
                  <textarea
                    className="ibo-input flex-1 min-h-[74px] resize-y"
                    placeholder="Write a message..."
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                  />
                  <button
                    type="button"
                    disabled={saving || !reply.trim()}
                    onClick={sendReply}
                    className="ibo-btn-primary self-stretch sm:self-end disabled:opacity-50"
                  >
                    <Send size={14} /> Send
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ title, value, icon: Icon, tone = 'cyan' }) {
  const map = {
    cyan: 'from-gold/20 to-gold/5 border-gold/30',
    blue: 'from-[#B44D01]/20 to-[#B44D01]/5 border-[#B44D01]/30',
    green: 'from-[#0ECB81]/20 to-[#0ECB81]/5 border-[#0ECB81]/30',
    lime: 'from-gold-light/20 to-gold-light/5 border-gold-light/30',
  };
  return (
    <div className={`rounded-2xl border bg-gradient-to-br p-4 ${map[tone] || map.cyan}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-ink-muted text-xs sm:text-sm font-medium">{title}</p>
        <Icon size={17} className="text-ink/70 shrink-0" />
      </div>
      <p className="text-2xl font-display font-bold text-ink mt-2 tabular-nums">{value}</p>
    </div>
  );
}
