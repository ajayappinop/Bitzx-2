import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Filter } from 'lucide-react';
import { api } from '@/lib/api';
import { useListSort } from '@/lib/useListSort';
import SortableTh from '@/components/SortableTh';
import { AdminDataTable } from '@/components/AdminPrimitives';

function normalizeAuditRow(row) {
  const source = row.source
    || (row.actor_type === 'system' ? 'system' : (row.actor_type === 'admin' ? 'jwt' : ''));
  const targetType = row.target_type || row.entity || '';
  const targetId = row.target_id || row.entity_id || '';
  const extra = row.extra || row.payload || {};
  const adminAid = row.admin_aid || row.actor_aid || '';
  return {
    ...row,
    source,
    target_type: targetType,
    target_id: targetId,
    extra,
    admin_aid: adminAid,
  };
}

export default function AuditPage() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [skip, setSkip] = useState(0);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState('');
  const [adminAid, setAdminAid] = useState('');
  const [source, setSource] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [limit, setLimit] = useState(40);
  const [exporting, setExporting] = useState(false);
  const { sortBy, sortDir, sortParams, toggleSort: _toggleSort, resetSort } = useListSort('created_at', 'desc');
  const toggleSort = useCallback((key) => {
    setSkip(0);
    _toggleSort(key);
  }, [_toggleSort]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { skip: String(skip), limit: String(limit) };
      if (action.trim()) params.action = action.trim();
      if (adminAid.trim()) params.admin_aid = adminAid.trim();
      if (source) params.source = source;
      if (dateFrom) params.date_from = `${dateFrom}T00:00:00`;
      if (dateTo) params.date_to = `${dateTo}T23:59:59`;
      Object.assign(params, sortParams);
      const r = await api.auditLogs(params);
      if (!r.ok) throw new Error('Failed to load audit log');
      const data = await r.json();
      setItems((data.items || []).map(normalizeAuditRow));
      setTotal(data.total ?? 0);
    } catch {
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [skip, limit, action, adminAid, source, dateFrom, dateTo, sortParams]);

  useEffect(() => {
    load();
  }, [load]);

  const pages = Math.max(1, Math.ceil(total / limit));
  const page = Math.floor(skip / limit) + 1;

  const targetLink = (row) => {
    const t = row.target_type;
    const id = row.target_id;
    if (!id) return null;
    if (t === 'user') return `/users/${id}`;
    if (t === 'deposit' || t === 'deposit_address') return `/deposits`;
    if (t === 'withdrawal') return `/withdrawals`;
    return null;
  };

  const clearFilters = () => {
    setSkip(0);
    setAction('');
    setAdminAid('');
    setSource('');
    setDateFrom('');
    setDateTo('');
    resetSort();
  };

  const exportAuditExcel = async () => {
    setExporting(true);
    try {
      const rows = [];
      let nextSkip = 0;
      const batchLimit = 200;
      while (true) {
        const params = { skip: String(nextSkip), limit: String(batchLimit), ...sortParams };
        if (action.trim()) params.action = action.trim();
        if (adminAid.trim()) params.admin_aid = adminAid.trim();
        if (source) params.source = source;
        if (dateFrom) params.date_from = `${dateFrom}T00:00:00`;
        if (dateTo) params.date_to = `${dateTo}T23:59:59`;
        const r = await api.auditLogs(params);
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.detail || 'Export failed');
        const batch = Array.isArray(data.items) ? data.items.map(normalizeAuditRow) : [];
        rows.push(...batch);
        nextSkip += batch.length;
        if (batch.length < batchLimit || nextSkip >= (Number(data.total) || 0)) break;
      }
      const header = ['Time', 'Action', 'Admin', 'Source', 'Target Type', 'Target ID', 'Extra'];
      const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const html = `<table><thead><tr>${header.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${
        rows.map((row) => `<tr>${
          [
            row.created_at ? new Date(row.created_at).toLocaleString() : '',
            row.action || '',
            row.admin_email || row.admin_aid || '',
            row.source || '',
            row.target_type || '',
            row.target_id || '',
            JSON.stringify(row.extra || {}),
          ].map((c) => `<td>${esc(c)}</td>`).join('')
        }</tr>`).join('')
      }</tbody></table>`;
      const blob = new Blob([`\ufeff${html}`], { type: 'application/vnd.ms-excel;charset=utf-8;' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `audit_logs_${new Date().toISOString().slice(0, 10)}.xls`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="admin-page">
      <h1 className="admin-title mb-2">Audit Logs</h1>
      <p className="admin-page-lead mb-6">Immutable record of admin actions for governance, incident response, and compliance audit trails.</p>

      <div className="rounded-2xl border border-surface-border bg-surface-card p-4 mb-6">
        <p className="text-base font-semibold text-white mb-3 flex items-center gap-2">
          <Filter size={14} /> Audit filters
        </p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <input
            value={action}
            onChange={e => { setSkip(0); setAction(e.target.value); }}
            placeholder="Action (e.g. user_patch)"
            className="rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white font-mono"
          />
          <input
            value={adminAid}
            onChange={e => { setSkip(0); setAdminAid(e.target.value); }}
            placeholder="Admin AID"
            className="rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white font-mono"
          />
          <select
            value={source}
            onChange={e => { setSkip(0); setSource(e.target.value); }}
            className="rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white"
          >
            <option value="">All sources</option>
            <option value="jwt">JWT</option>
            <option value="api_key">API key</option>
            <option value="system">System</option>
          </select>
          <input
            type="date"
            value={dateFrom}
            onChange={e => { setSkip(0); setDateFrom(e.target.value); }}
            className="rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white"
          />
          <input
            type="date"
            value={dateTo}
            onChange={e => { setSkip(0); setDateTo(e.target.value); }}
            className="rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white"
          />
        </div>
        <button
          type="button"
          onClick={clearFilters}
          className="mt-3 text-xs font-bold text-gold-light hover:underline"
        >
          Clear filters
        </button>
        <button
          type="button"
          onClick={exportAuditExcel}
          disabled={exporting}
          className="mt-3 ml-4 text-xs font-bold text-cyan-300 hover:underline disabled:opacity-50"
        >
          {exporting ? 'Exporting…' : 'Export Excel'}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-3 mb-4 text-sm text-white/65">
        <span>Total records: <strong className="text-white">{total}</strong></span>
        <span>Amount: <strong className="text-white/80">N/A (audit log)</strong></span>
      </div>

      <AdminDataTable minWidth="800px">
            <thead>
              <tr>
                <SortableTh sortKey="created_at" activeKey={sortBy} dir={sortDir} onSort={toggleSort}>Time</SortableTh>
                <SortableTh sortKey="action" activeKey={sortBy} dir={sortDir} onSort={toggleSort}>Action</SortableTh>
                <SortableTh sortKey="admin_aid" activeKey={sortBy} dir={sortDir} onSort={toggleSort}>Admin</SortableTh>
                <th>Source</th>
                <SortableTh sortKey="target_id" activeKey={sortBy} dir={sortDir} onSort={toggleSort}>Target</SortableTh>
                <th>Extra</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="text-center text-white/50 !py-16">Loading…</td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center text-white/50 !py-16">No audit entries match.</td>
                </tr>
              ) : (
                items.map(row => {
                  const href = targetLink(row);
                  return (
                    <tr key={row.id}>
                      <td className="text-white/55 whitespace-nowrap">
                        {row.created_at ? new Date(row.created_at).toLocaleString() : '—'}
                      </td>
                      <td className="font-mono text-gold-light/90">{row.action}</td>
                      <td>
                        <span className="text-white/80">{row.admin_email || row.admin_aid || '—'}</span>
                      </td>
                      <td className="text-white/50">{row.source || '—'}</td>
                      <td>
                        {href ? (
                          <Link to={href} className="text-gold-light hover:underline font-mono">
                            {row.target_type}:{row.target_id}
                          </Link>
                        ) : (
                          <span className="font-mono text-white/60">{row.target_type}:{row.target_id || '—'}</span>
                        )}
                      </td>
                      <td className="text-white/45 max-w-[240px] truncate font-mono" title={JSON.stringify(row.extra || {})}>
                        {Object.keys(row.extra || {}).length ? JSON.stringify(row.extra) : '—'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
      </AdminDataTable>

      <div className="flex items-center justify-between mt-4 flex-wrap gap-3">
          <p className="text-white/50 text-sm">{total} entries · page {page} / {pages}</p>
          <div className="flex items-center gap-2">
            <select
              value={String(limit)}
              onChange={e => { setSkip(0); setLimit(Number(e.target.value)); }}
              className="rounded-xl bg-surface-card border border-surface-border px-3 py-2 text-white text-sm font-semibold"
            >
              {[10, 25, 40, 50, 100].map(n => <option key={n} value={n}>{n}/page</option>)}
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
    </div>
  );
}
