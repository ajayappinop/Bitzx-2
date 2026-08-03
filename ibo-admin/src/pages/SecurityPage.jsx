import { useCallback, useEffect, useMemo, useState } from 'react';
import { ShieldAlert, Plus, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import FormModal from '@/components/FormModal';

export default function SecurityPage() {
  const [dash, setDash] = useState(null);
  const [blocks, setBlocks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');
  const [blockStatus, setBlockStatus] = useState('active');
  const [blockType, setBlockType] = useState('all');

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const [rd, rb] = await Promise.all([
        api.securityDashboard(),
        api.securityBlocks({ limit: '200', skip: '0' }),
      ]);
      const jd = await rd.json().catch(() => ({}));
      const jb = await rb.json().catch(() => ({}));
      if (!rd.ok) throw new Error(jd.detail || 'Failed to load security dashboard');
      if (!rb.ok) throw new Error(jb.detail || 'Failed to load security blocks');
      setDash(jd);
      setBlocks(jb.items || []);
    } catch (e) {
      setErr(e.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function addBlock(values) {
    const res = await api.createSecurityBlock({
      type: String(values.type || '').trim(),
      value: String(values.value || '').trim(),
      reason: String(values.reason || '').trim(),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErr(j.detail || 'Could not create block');
      return;
    }
    setAddOpen(false);
    load();
  }

  async function toggleBlock(row) {
    const res = await api.patchSecurityBlock(row.id, { is_active: !row.is_active });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErr(j.detail || 'Could not update block');
      return;
    }
    load();
  }

  const rateHits = dash?.rate_limit_hits_by_scope || [];
  const visibleBlocks = useMemo(() => {
    return (blocks || []).filter((b) => {
      if (blockStatus === 'active' && !b.is_active) return false;
      if (blockStatus === 'inactive' && b.is_active) return false;
      if (blockType !== 'all' && String(b.type) !== blockType) return false;
      return true;
    });
  }, [blocks, blockStatus, blockType]);

  return (
    <div className="admin-page">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="admin-title mb-2 flex items-center gap-2">
            <ShieldAlert className="text-rose-300" size={26} /> Security Controls
          </h1>
          <p className="admin-page-lead">Monitor authentication abuse, rate-limit pressure, and enforce IP/country access controls.</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setAddOpen(true)} className="inline-flex items-center gap-2 rounded-xl border border-rose-500/30 px-3 py-2 text-rose-200 text-sm font-bold">
            <Plus size={14} /> Add block
          </button>
          <button type="button" onClick={load} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border border-surface-border px-3 py-2 text-white/80 text-sm font-bold disabled:opacity-40">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      {err ? <p className="text-red-400 text-sm">{err}</p> : null}

      <div className="adm-table-x scrollbar-thin">
        <div className="admin-tabs w-max min-w-full">
          <button type="button" onClick={() => setActiveTab('overview')} className={`admin-tab-btn shrink-0 ${activeTab === 'overview' ? 'active' : ''}`}>Overview</button>
          <button type="button" onClick={() => setActiveTab('rate-limits')} className={`admin-tab-btn shrink-0 ${activeTab === 'rate-limits' ? 'active' : ''}`}>Rate-limit Hits</button>
          <button type="button" onClick={() => setActiveTab('blocks')} className={`admin-tab-btn shrink-0 ${activeTab === 'blocks' ? 'active' : ''}`}>IP/Country Blocks</button>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat title="Failed user logins (24h)" value={dash?.failed_user_logins ?? 0} tone="red" />
        <Stat title="Failed admin logins (24h)" value={dash?.failed_admin_logins ?? 0} tone="rose" />
        <Stat title="Active geo/IP blocks" value={dash?.active_blocks ?? 0} tone="yellow" />
        <Stat title="Rate-limit scopes hit (24h)" value={dash?.rate_limit_hits_by_scope?.length ?? 0} tone="blue" />
      </div>

      {activeTab === 'overview' ? (
        <div className="rounded-2xl border border-surface-border bg-surface-card overflow-hidden">
          <div className="px-4 py-3 border-b border-surface-border text-sm font-semibold text-white/85">Security summary (last 24 hours)</div>
          <div className="p-4 text-sm text-white/70 space-y-2">
            <p><strong className="text-white">Failed user logins:</strong> {dash?.failed_user_logins ?? 0}</p>
            <p><strong className="text-white">Failed admin logins:</strong> {dash?.failed_admin_logins ?? 0}</p>
            <p><strong className="text-white">Active blocks:</strong> {dash?.active_blocks ?? 0}</p>
            <p><strong className="text-white">Rate-limit scopes hit:</strong> {rateHits.length}</p>
          </div>
        </div>
      ) : null}

      {activeTab === 'rate-limits' ? (
        <div className="rounded-2xl border border-surface-border bg-surface-card overflow-hidden">
          <div className="px-4 py-3 border-b border-surface-border text-sm font-semibold text-white/85">Traffic limits hit in the last 24 hours</div>
          <div className="adm-table-x">
            <table className="w-full text-sm min-w-[500px]">
              <thead><tr className="text-left text-[11px] text-white/45 border-b border-surface-border"><th className="px-4 py-3">Scope</th><th className="px-4 py-3 text-right">Hits</th></tr></thead>
              <tbody>
                {rateHits.length === 0 ? (
                  <tr><td colSpan={2} className="px-4 py-10 text-center text-white/50">No rate-limit hits in this window.</td></tr>
                ) : (
                  rateHits.map((r) => (
                    <tr key={r.scope} className="border-b border-surface-border/50"><td className="px-4 py-3 font-mono text-xs">{r.scope}</td><td className="px-4 py-3 text-right font-mono">{r.hits}</td></tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {activeTab === 'blocks' ? (
        <div className="rounded-2xl border border-surface-border bg-surface-card overflow-hidden">
          <div className="px-4 py-3 border-b border-surface-border">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-semibold text-white/85">Blocked IPs and countries</p>
              <div className="flex flex-wrap items-center gap-2">
                <div className="admin-tabs">
                  {[
                    { id: 'active', label: 'Active' },
                    { id: 'inactive', label: 'Inactive' },
                    { id: 'all', label: 'All' },
                  ].map((s) => (
                    <button key={s.id} type="button" onClick={() => setBlockStatus(s.id)} className={`admin-tab-btn text-xs ${blockStatus === s.id ? 'active' : ''}`}>{s.label}</button>
                  ))}
                </div>
                <div className="admin-tabs">
                  {[
                    { id: 'all', label: 'All Types' },
                    { id: 'ip', label: 'IP' },
                    { id: 'country', label: 'Country' },
                  ].map((t) => (
                    <button key={t.id} type="button" onClick={() => setBlockType(t.id)} className={`admin-tab-btn text-xs ${blockType === t.id ? 'active' : ''}`}>{t.label}</button>
                  ))}
                </div>
              </div>
            </div>
          </div>
          <div className="adm-table-x">
            <table className="w-full text-sm min-w-[700px]">
              <thead>
                <tr className="text-left text-[11px] text-white/45 border-b border-surface-border">
                  <th className="px-4 py-3">Type</th><th className="px-4 py-3">Value</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Reason</th><th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {visibleBlocks.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-10 text-center text-white/50">No blocks found for selected filters.</td></tr>
                ) : (
                  visibleBlocks.map((b) => (
                    <tr key={b.id} className="border-b border-surface-border/50">
                      <td className="px-4 py-3 text-xs uppercase font-bold">{b.type}</td>
                      <td className="px-4 py-3 font-mono text-xs">{b.value}</td>
                      <td className="px-4 py-3 text-xs">{b.is_active ? 'active' : 'inactive'}</td>
                      <td className="px-4 py-3 text-xs text-white/60">{b.reason || '—'}</td>
                      <td className="px-4 py-3 text-right">
                        <button type="button" onClick={() => toggleBlock(b)} className="text-xs font-bold text-gold-light hover:underline">
                          {b.is_active ? 'Disable' : 'Enable'}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <FormModal
        open={addOpen}
        title="Add a block"
        subtitle="Stop sign-in attempts from one IP address or from an entire country code (for example IN)."
        confirmText="Create block"
        onClose={() => setAddOpen(false)}
        onConfirm={addBlock}
        fields={[
          { id: 'type', label: 'Type', type: 'select', value: 'ip', required: true, options: [{ value: 'ip', label: 'ip' }, { value: 'country', label: 'country' }] },
          { id: 'value', label: 'Value', value: '', required: true, placeholder: 'e.g. 1.2.3.4 or IN' },
          { id: 'reason', label: 'Reason', type: 'textarea', value: '', rows: 3 },
        ]}
      />
    </div>
  );
}

function Stat({ title, value, tone = 'blue' }) {
  const tones = {
    blue: 'bg-gradient-to-br from-[#3B82F6]/18 to-transparent border-[#3B82F6]/28',
    yellow: 'bg-gradient-to-br from-[#0EA4AB]/18 to-transparent border-[#0EA4AB]/28',
    red: 'bg-gradient-to-br from-[#F6465D]/18 to-transparent border-[#F6465D]/28',
    rose: 'bg-gradient-to-br from-[#EF4444]/18 to-transparent border-[#EF4444]/28',
  };
  return (
    <div className={`rounded-xl border p-4 ${tones[tone] || tones.blue}`}>
      <p className="text-sm font-semibold text-white/80">{title}</p>
      <p className="text-2xl font-extrabold text-white mt-1">{value}</p>
    </div>
  );
}
