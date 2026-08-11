import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, UserPlus, Eye, EyeOff } from 'lucide-react';
import { api } from '@/lib/api';
import { useListSort } from '@/lib/useListSort';
import SortableTh from '@/components/SortableTh';
import ConfirmModal from '@/components/ConfirmModal';
import { ROLE_OPTIONS, ROLE_PERMISSIONS, PERMISSION_GROUPS } from '@/lib/adminAccess';
import { AdminDataTable } from '@/components/AdminPrimitives';

function normalizePermissions(perms = []) {
  return [...new Set((perms || []).map((p) => String(p || '').trim()).filter(Boolean))];
}

export default function AdminCreatePage() {
  const [activeTab, setActiveTab] = useState('create');
  const [showPassword, setShowPassword] = useState(false);
  const [form, setForm] = useState({
    email: '',
    password: '',
    name: '',
    role: 'support',
    permissions: [...(ROLE_PERMISSIONS.support || [])],
  });
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [okMsg, setOkMsg] = useState('');
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [roleFilterInput, setRoleFilterInput] = useState('all');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilterInput, setStatusFilterInput] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [fromInput, setFromInput] = useState('');
  const [toInput, setToInput] = useState('');
  const [createdFrom, setCreatedFrom] = useState('');
  const [createdTo, setCreatedTo] = useState('');
  const [skip, setSkip] = useState(0);
  const [limit, setLimit] = useState(25);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState({ active: 0, disabled: 0 });
  const [confirm, setConfirm] = useState({ open: false, type: '', aid: '', nextRole: '', nextActive: null, email: '' });
  const { sortBy, sortDir, sortParams, toggleSort: _toggleSort, resetSort } = useListSort('created_at', 'desc');
  const toggleSort = useCallback((key) => {
    setSkip(0);
    _toggleSort(key);
  }, [_toggleSort]);

  const load = async () => {
    setLoading(true);
    setErr('');
    try {
      const params = {
        skip: String(skip),
        limit: String(limit),
      };
      if (q.trim()) params.q = q.trim();
      if (roleFilter !== 'all') params.role = roleFilter;
      if (statusFilter === 'active') params.is_active = 'true';
      if (statusFilter === 'disabled') params.is_active = 'false';
      if (createdFrom) params.created_from = createdFrom;
      if (createdTo) params.created_to = createdTo;
      Object.assign(params, sortParams);
      const r = await api.adminUsers(params);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail || 'Could not load admin users');
      setItems(j.items || []);
      setTotal(j.total ?? 0);
      setStats(j.stats || { active: 0, disabled: 0 });
    } catch (e) {
      setErr(e.message);
      setItems([]);
      setTotal(0);
      setStats({ active: 0, disabled: 0 });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [skip, limit, q, roleFilter, statusFilter, createdFrom, createdTo, sortBy, sortDir]);

  const createAdmin = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    setOkMsg('');
    try {
      const r = await api.createAdminUser(form);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail || 'Could not create admin');
      setForm({
        email: '',
        password: '',
        name: '',
        role: 'support',
        permissions: [...(ROLE_PERMISSIONS.support || [])],
      });
      setOkMsg(`Admin created: ${j?.email || form.email}`);
      setSkip(0);
      await load();
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  };

  const patchAdmin = async (aid, payload) => {
    setBusy(true);
    setErr('');
    setOkMsg('');
    try {
      const r = await api.patchAdminUser(aid, payload);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail || 'Update failed');
      await load();
      setOkMsg('Admin updated successfully');
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  };

  const onAskCreate = (e) => {
    e.preventDefault();
    setConfirm({ open: true, type: 'create', aid: '', nextRole: '', nextActive: null, email: form.email });
  };

  const applyFilters = () => {
    setSkip(0);
    setQ(qInput.trim());
    setRoleFilter(roleFilterInput);
    setStatusFilter(statusFilterInput);
    setCreatedFrom(fromInput ? new Date(`${fromInput}T00:00:00.000Z`).toISOString() : '');
    setCreatedTo(toInput ? new Date(`${toInput}T23:59:59.999Z`).toISOString() : '');
  };

  const resetFilters = () => {
    setQInput('');
    setRoleFilterInput('all');
    setStatusFilterInput('all');
    setFromInput('');
    setToInput('');
    setSkip(0);
    setQ('');
    setRoleFilter('all');
    setStatusFilter('all');
    setCreatedFrom('');
    setCreatedTo('');
    resetSort();
  };

  return (
    <div className="admin-page">
      <Link to="/settings" className="text-gold-light text-sm font-bold inline-flex items-center gap-1 mb-4 hover:underline">
        <ArrowLeft size={16} /> Back to platform settings
      </Link>

      <div className="mb-5 adm-table-x scrollbar-thin">
        <div className="admin-tabs w-max min-w-full">
          <button
            type="button"
            onClick={() => setActiveTab('create')}
            className={`admin-tab-btn shrink-0 ${activeTab === 'create' ? 'active' : ''}`}
          >
            Create Admin
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('manage')}
            className={`admin-tab-btn shrink-0 ${activeTab === 'manage' ? 'active' : ''}`}
          >
            Manage Admins
          </button>
        </div>
      </div>

      {activeTab === 'create' ? (
      <div className="rounded-2xl border border-surface-border bg-surface-card p-4 sm:p-5 min-w-0">
        <h1 className="admin-title flex flex-wrap items-center gap-2 mb-2">
          <UserPlus size={24} className="text-gold-light shrink-0" />
          Create Admin
        </h1>
        <p className="admin-page-lead mb-4">Create a dashboard account by email, assign a role, and set an initial password they should change after first sign-in.</p>
        {err && <p className="text-red-400 text-sm mb-3">{err}</p>}
        {okMsg && <p className="text-green-400 text-sm mb-3">{okMsg}</p>}
        <form onSubmit={onAskCreate}>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <input
              required
              type="email"
              placeholder="Email"
              value={form.email}
              onChange={(e) => setForm((v) => ({ ...v, email: e.target.value }))}
              className="rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white"
            />
            <div className="relative">
              <input
                required
                minLength={8}
                type={showPassword ? 'text' : 'password'}
                placeholder="Password (min 8)"
                value={form.password}
                onChange={(e) => setForm((v) => ({ ...v, password: e.target.value }))}
                className="w-full rounded-xl bg-surface-dark border border-surface-border px-3 pr-10 py-2 text-sm text-white"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-lg text-white/65 hover:text-white"
                title={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <input
              placeholder="Name"
              value={form.name}
              onChange={(e) => setForm((v) => ({ ...v, name: e.target.value }))}
              className="rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white"
            />
            <select
              value={form.role}
              onChange={(e) => {
                const role = e.target.value;
                setForm((v) => ({
                  ...v,
                  role,
                  permissions: [...(ROLE_PERMISSIONS[role] || [])],
                }));
              }}
              className="rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white"
            >
              {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="mt-4 rounded-xl border border-surface-border bg-surface-card p-4 shadow-[0_12px_30px_rgba(0,0,0,0.25)]">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div>
                <p className="text-base font-extrabold text-white mb-1">Module permissions</p>
                <p className="text-sm text-white/75">Admin sees and accesses only assigned modules.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setForm((v) => ({ ...v, permissions: [...(ROLE_PERMISSIONS[v.role] || [])] }))}
                  className="px-3 py-1.5 rounded-lg border border-surface-border bg-surface-dark text-xs font-bold text-white/90 hover:border-white/35"
                >
                  Role defaults
                </button>
                <button
                  type="button"
                  onClick={() => setForm((v) => ({ ...v, permissions: normalizePermissions(PERMISSION_GROUPS.flatMap((g) => g.items)) }))}
                  className="px-3 py-1.5 rounded-lg border border-surface-border bg-surface-dark text-xs font-bold text-white/90 hover:border-white/35"
                >
                  Select all
                </button>
                <button
                  type="button"
                  onClick={() => setForm((v) => ({ ...v, permissions: [] }))}
                  className="px-3 py-1.5 rounded-lg border border-rose-500/45 bg-rose-500/10 text-xs font-bold text-rose-200 hover:bg-rose-500/15"
                >
                  Clear all
                </button>
              </div>
            </div>
            <div className="grid lg:grid-cols-2 gap-4">
              {PERMISSION_GROUPS.map((group) => (
                <div key={group.title} className="rounded-xl border border-surface-border bg-surface-dark/70 p-3">
                  <p className="text-xs font-extrabold text-cyan-200 uppercase tracking-wide mb-3">{group.title}</p>
                  <div className="flex flex-wrap gap-2">
                    {group.items.map((perm) => {
                      const checked = form.permissions.includes(perm);
                      return (
                        <button
                          key={perm}
                          type="button"
                          onClick={() =>
                            setForm((v) => ({
                              ...v,
                              permissions: normalizePermissions(
                                checked
                                  ? v.permissions.filter((p) => p !== perm)
                                  : [...v.permissions, perm],
                              ),
                            }))
                          }
                          className={`px-2.5 py-1.5 rounded-md border text-[12px] font-mono leading-none ${
                            checked
                              ? 'border-gold/60 bg-gold/20 text-gold-light shadow-[0_0_0_1px_rgba(14,164,171,0.15)]'
                              : 'border-surface-border bg-surface-card text-white/90 hover:border-white/35'
                          }`}
                        >
                          {perm}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <p className="text-sm text-cyan-100 mt-4">
              Selected permissions: <strong className="text-gold-light">{form.permissions.length}</strong>
            </p>
          </div>
          <button
            type="submit"
            disabled={busy}
            className="mt-4 px-4 py-2 rounded-xl bg-gold/20 border border-gold/35 text-gold-light text-sm font-bold disabled:opacity-40"
          >
            Create admin
          </button>
        </form>
      </div>
      ) : null}

      {activeTab === 'manage' ? (
      <div className="rounded-2xl border border-surface-border bg-surface-card overflow-hidden mt-6">
        <div className="px-5 pt-5 pb-3 border-b border-surface-border">
          <h2 className="text-lg font-extrabold text-white">Admin listing</h2>
          <p className="text-white/55 text-sm mt-1">Filter and manage existing admin users from here.</p>
          <div className="grid sm:grid-cols-3 lg:grid-cols-6 gap-3 mt-4">
            <input
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
              placeholder="Search by email/name/id"
              className="rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white"
            />
            <select
              value={roleFilterInput}
              onChange={(e) => setRoleFilterInput(e.target.value)}
              className="rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white"
            >
              <option value="all">All roles</option>
              {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <select
              value={statusFilterInput}
              onChange={(e) => setStatusFilterInput(e.target.value)}
              className="rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white"
            >
              <option value="all">All status</option>
              <option value="active">Active</option>
              <option value="disabled">Disabled</option>
            </select>
            <input
              type="date"
              value={fromInput}
              onChange={(e) => setFromInput(e.target.value)}
              className="rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white"
            />
            <input
              type="date"
              value={toInput}
              onChange={(e) => setToInput(e.target.value)}
              className="rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white"
            />
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={applyFilters}
                className="px-3 py-2 rounded-xl bg-gold/20 border border-gold/35 text-gold-light text-xs font-bold disabled:opacity-40"
              >
                Apply
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={resetFilters}
                className="px-3 py-2 rounded-xl border border-surface-border text-white/80 text-xs font-bold disabled:opacity-40"
              >
                Reset
              </button>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-white/60">
            <span>Total records: <strong className="text-white">{total}</strong></span>
            <span>Active: <strong className="text-green-400">{stats.active ?? 0}</strong></span>
            <span>Disabled: <strong className="text-red-400">{stats.disabled ?? 0}</strong></span>
            <span>Amount: <strong className="text-white/80">N/A (admin listing)</strong></span>
          </div>
        </div>
        <AdminDataTable minWidth="860px" className="!rounded-none !border-x-0 !border-b-0">
            <thead>
              <tr>
                <SortableTh sortKey="name" activeKey={sortBy} dir={sortDir} onSort={toggleSort}>Admin</SortableTh>
                <SortableTh sortKey="role" activeKey={sortBy} dir={sortDir} onSort={toggleSort}>Role</SortableTh>
                <SortableTh sortKey="is_active" activeKey={sortBy} dir={sortDir} onSort={toggleSort}>Status</SortableTh>
                <SortableTh sortKey="created_at" activeKey={sortBy} dir={sortDir} onSort={toggleSort}>Created</SortableTh>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="text-center text-white/50 py-16">Loading…</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={5} className="text-center text-white/50 py-16">No admin users match filters.</td></tr>
              ) : (
                items.map((a) => (
                  <tr key={a.aid}>
                    <td>
                      <p className="font-bold text-white">{a.name || a.email}</p>
                      <p className="text-xs text-white/55">{a.email}</p>
                      <p className="text-[11px] text-white/35 font-mono">{a.aid}</p>
                    </td>
                    <td>
                      <select
                        value={a.role}
                        onChange={(e) => setConfirm({ open: true, type: 'role', aid: a.aid, nextRole: e.target.value, nextActive: null, email: a.email })}
                        disabled={busy}
                        className="rounded-lg bg-surface-dark border border-surface-border px-2.5 py-1.5 text-xs text-white"
                      >
                        {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                      <p className="text-[10px] text-white/45 font-mono mt-1">
                        {Array.isArray(a.permissions) && a.permissions.length ? `${a.permissions.length} custom permission(s)` : 'Role defaults'}
                      </p>
                    </td>
                    <td>
                      <span className={`text-xs font-bold uppercase px-2 py-1 rounded-md ${a.is_active ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'}`}>
                        {a.is_active ? 'active' : 'disabled'}
                      </span>
                    </td>
                    <td className="text-xs text-white/55">{a.created_at ? new Date(a.created_at).toLocaleString() : '—'}</td>
                    <td className="text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setConfirm({ open: true, type: 'active', aid: a.aid, nextRole: '', nextActive: !a.is_active, email: a.email })}
                          className="px-3 py-1.5 rounded-lg border border-surface-border text-xs font-bold text-white/85"
                        >
                          {a.is_active ? 'Disable' : 'Enable'}
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setConfirm({ open: true, type: 'password', aid: a.aid, nextRole: '', nextActive: null, email: a.email })}
                          className="px-3 py-1.5 rounded-lg border border-gold/30 text-xs font-bold text-gold-light"
                        >
                          Reset password
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </AdminDataTable>
        <div className="px-5 py-3 border-t border-surface-border flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-white/55">
            Showing {total === 0 ? 0 : skip + 1}–{Math.min(skip + limit, total)} of {total}
          </p>
          <div className="flex items-center gap-2">
            <select
              value={String(limit)}
              onChange={(e) => { setSkip(0); setLimit(Number(e.target.value)); }}
              className="rounded-lg bg-surface-dark border border-surface-border px-2.5 py-1.5 text-xs text-white"
            >
              {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n}/page</option>)}
            </select>
            <button
              type="button"
              disabled={skip <= 0 || loading}
              onClick={() => setSkip((s) => Math.max(0, s - limit))}
              className="px-3 py-1.5 rounded-lg border border-surface-border text-xs font-bold text-white/85 disabled:opacity-40"
            >
              Prev
            </button>
            <button
              type="button"
              disabled={skip + limit >= total || loading}
              onClick={() => setSkip((s) => s + limit)}
              className="px-3 py-1.5 rounded-lg border border-surface-border text-xs font-bold text-white/85 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      </div>
      ) : null}
      <ConfirmModal
        open={confirm.open}
        title={
          confirm.type === 'create' ? 'Create new admin user'
            : confirm.type === 'role' ? 'Change admin role'
              : confirm.type === 'active' ? (confirm.nextActive ? 'Enable admin account' : 'Disable admin account')
                : 'Reset admin password'
        }
        message={
          confirm.type === 'create'
            ? `Create admin account for ${confirm.email || form.email}?`
            : confirm.type === 'role'
              ? `Change role to ${confirm.nextRole} for ${confirm.email}?`
              : confirm.type === 'active'
                ? `${confirm.nextActive ? 'Enable' : 'Disable'} account for ${confirm.email}?`
                : `Set a new password for ${confirm.email}.`
        }
        inputLabel={confirm.type === 'password' ? 'New password (min 8 chars)' : ''}
        inputPlaceholder="Enter new password"
        inputType="password"
        required={confirm.type === 'password'}
        confirmText={
          confirm.type === 'create' ? 'Create'
            : confirm.type === 'role' ? 'Update role'
              : confirm.type === 'active' ? (confirm.nextActive ? 'Enable' : 'Disable')
                : 'Update password'
        }
        danger={confirm.type === 'active' && !confirm.nextActive}
        busy={busy}
        onClose={() => { if (!busy) setConfirm({ open: false, type: '', aid: '', nextRole: '', nextActive: null, email: '' }); }}
        onConfirm={async (value) => {
          const c = confirm;
          setConfirm({ open: false, type: '', aid: '', nextRole: '', nextActive: null, email: '' });
          if (c.type === 'create') await createAdmin({ preventDefault() {} });
          if (c.type === 'role' && c.aid) await patchAdmin(c.aid, { role: c.nextRole });
          if (c.type === 'active' && c.aid && c.nextActive != null) await patchAdmin(c.aid, { is_active: c.nextActive });
          if (c.type === 'password' && c.aid) await patchAdmin(c.aid, { password: value });
        }}
      />
    </div>
  );
}
