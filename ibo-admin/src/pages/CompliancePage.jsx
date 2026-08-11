import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ShieldCheck,
  Plus,
  RefreshCw,
  Paperclip,
  Briefcase,
  FolderOpen,
  AlertTriangle,
  UserCheck,
  Users,
  ShieldAlert,
  FileText,
  CheckCircle2,
  Clock3,
  FileSearch,
  Landmark,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import { useAdminAuth } from '@/context/AdminAuthContext';
import UserUidSuggestInput from '@/components/UserUidSuggestInput';
import FormModal from '@/components/FormModal';
import ConfirmModal from '@/components/ConfirmModal';
import { AdminDataTable } from '@/components/AdminPrimitives';

export default function CompliancePage({ mode = 'aml' }) {
  const { admin } = useAdminAuth();
  const adminRole = String(admin?.role || '').toLowerCase();
  const adminPerms = Array.isArray(admin?.permissions)
    ? admin.permissions.map((p) => String(p || '').trim())
    : [];
  const canManageCompliance = !!admin && (
    ['superadmin', 'finance'].includes(adminRole)
    || adminPerms.includes('*')
    || adminPerms.includes('manage_compliance')
  );
  const [dash, setDash] = useState(null);
  const [cases, setCases] = useState([]);
  const [total, setTotal] = useState(0);
  const [skip, setSkip] = useState(0);
  const [limit, setLimit] = useState(40);
  const [status, setStatus] = useState('');
  const [caseType, setCaseType] = useState('');
  const [risk, setRisk] = useState('');
  const [uid, setUid] = useState('');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editCase, setEditCase] = useState(null);
  const [attachCase, setAttachCase] = useState(null);
  const [kycRiskOpen, setKycRiskOpen] = useState(false);
  const [rerequestOpen, setRerequestOpen] = useState(false);
  const [monitoring, setMonitoring] = useState([]);
  const [reports, setReports] = useState([]);
  const [walletBlacklist, setWalletBlacklist] = useState([]);
  const [sanctions, setSanctions] = useState([]);
  const [syncStatus, setSyncStatus] = useState(null);
  const [screeningConfig, setScreeningConfig] = useState(null);
  const [addWalletOpen, setAddWalletOpen] = useState(false);
  const [addSanctionOpen, setAddSanctionOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [monitorRunOpen, setMonitorRunOpen] = useState(false);
  const [screeningOpen, setScreeningOpen] = useState(false);
  const [monitorSource, setMonitorSource] = useState('stored');
  const [complianceRules, setComplianceRules] = useState([]);
  const [fiuStatus, setFiuStatus] = useState('all');
  const [fiuType, setFiuType] = useState('all');
  const [fiuSearch, setFiuSearch] = useState('');
  const isFIU = mode === 'fiu';
  const isAML = mode !== 'fiu';
  const filteredReports = useMemo(() => {
    const qText = fiuSearch.trim().toLowerCase();
    return (reports || []).filter((r) => {
      if (fiuStatus !== 'all' && String(r.fiu_status || 'draft') !== fiuStatus) return false;
      if (fiuType !== 'all' && String(r.report_type || '').toLowerCase() !== fiuType) return false;
      if (!qText) return true;
      return (
        String(r.id || '').toLowerCase().includes(qText)
        || String(r.report_type || '').toLowerCase().includes(qText)
        || String(r.output_format || '').toLowerCase().includes(qText)
      );
    });
  }, [reports, fiuStatus, fiuType, fiuSearch]);
  const fiuMetrics = useMemo(() => {
    const rows = filteredReports || [];
    const totalRows = rows.reduce((s, r) => s + Number(r.rows_count || 0), 0);
    const strCount = rows.filter((r) => String(r.report_type || '').toLowerCase() === 'str').length;
    const ctrCount = rows.filter((r) => String(r.report_type || '').toLowerCase() === 'ctr').length;
    const submitted = rows.filter((r) => String(r.fiu_status || '').toLowerCase() === 'submitted').length;
    const draft = rows.length - submitted;
    const latest = rows
      .slice()
      .sort((a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0))[0] || null;
    return { totalRows, strCount, ctrCount, submitted, draft, latest };
  }, [filteredReports]);

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const [rd, rc, rm, rr, rw, rs, rss, rsc, rrules] = await Promise.all([
        api.complianceDashboard(),
        api.complianceCases({
          status, case_type: caseType, risk_level: risk, uid, q, skip: String(skip), limit: String(limit),
        }),
        api.complianceTransactionMonitoring({ limit: '50', source: monitorSource }),
        api.complianceReports({ limit: '50' }),
        api.complianceWalletBlacklist({ limit: '50', is_active: 'true' }),
        api.complianceSanctions({ limit: '50', is_active: 'true' }),
        api.complianceSanctionsSyncStatus(),
        api.complianceScreeningConfig(),
        api.complianceRules(),
      ]);
      const jd = await rd.json().catch(() => ({}));
      const jc = await rc.json().catch(() => ({}));
      const jm = await rm.json().catch(() => ({}));
      const jr = await rr.json().catch(() => ({}));
      const jw = await rw.json().catch(() => ({}));
      const js = await rs.json().catch(() => ({}));
      const jss = await rss.json().catch(() => ({}));
      const jsc = await rsc.json().catch(() => ({}));
      const jrules = await rrules.json().catch(() => ({}));
      if (!rd.ok) throw new Error(jd.detail || 'Failed to load compliance dashboard');
      if (!rc.ok) throw new Error(jc.detail || 'Failed to load compliance cases');
      if (!rm.ok) throw new Error(jm.detail || 'Failed to load monitoring');
      if (!rr.ok) throw new Error(jr.detail || 'Failed to load reports');
      if (!rw.ok) throw new Error(jw.detail || 'Failed to load wallet blacklist');
      if (!rs.ok) throw new Error(js.detail || 'Failed to load sanctions');
      if (!rss.ok) throw new Error(jss.detail || 'Failed to load sanctions sync status');
      if (!rsc.ok) throw new Error(jsc.detail || 'Failed to load screening configuration');
      if (!rrules.ok) throw new Error(jrules.detail || 'Failed to load compliance rules');
      setDash(jd);
      setCases(jc.items || []);
      setTotal(jc.total ?? 0);
      setMonitoring(jm.items || []);
      setReports(jr.items || []);
      setWalletBlacklist(jw.items || []);
      setSanctions(js.items || []);
      setSyncStatus(jss);
      setScreeningConfig(jsc);
      setComplianceRules(jrules.items || []);
    } catch (e) {
      setErr(e.message || 'Failed to load compliance data');
      setCases([]);
      setTotal(0);
      setComplianceRules([]);
    } finally {
      setLoading(false);
    }
  }, [status, caseType, risk, uid, q, skip, limit, monitorSource]);

  useEffect(() => { load(); }, [load]);

  async function createCase(values) {
    setErr('');
    const res = await api.createComplianceCase({
      case_type: values.case_type,
      uid: String(values.uid || '').trim() || undefined,
      title: String(values.title || '').trim(),
      risk_level: values.risk_level,
      notes: String(values.notes || '').trim(),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return setErr(body.detail || 'Failed to create case');
    setOk('Compliance case created.');
    setCreateOpen(false);
    load();
  }

  async function patchCase(values) {
    if (!editCase) return;
    setErr('');
    const res = await api.patchComplianceCase(editCase.id, {
      status: values.status,
      assignee_aid: String(values.assignee_aid || '').trim() || undefined,
      risk_level: values.risk_level || undefined,
      notes: String(values.notes || '').trim(),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return setErr(body.detail || 'Failed to update case');
    setOk(`Case ${editCase.id} updated.`);
    setEditCase(null);
    load();
  }

  async function addAttachment(values) {
    if (!attachCase) return;
    setErr('');
    const res = await api.addComplianceAttachment(attachCase.id, {
      name: String(values.name || '').trim(),
      url: String(values.url || '').trim(),
      mime_type: String(values.mime_type || '').trim() || undefined,
      note: String(values.note || '').trim() || undefined,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return setErr(body.detail || 'Failed to add attachment');
    setOk(`Attachment added to ${attachCase.id}.`);
    setAttachCase(null);
    load();
  }

  async function patchKycRisk(values) {
    const targetUid = String(values.uid || '').trim();
    if (!targetUid) return;
    const body = {
      risk_tags: String(values.tags || '').split(',').map((x) => x.trim()).filter(Boolean),
      note: String(values.note || '').trim() || undefined,
    };
    if (values.pep_flag !== 'keep') body.pep_flag = values.pep_flag === 'true';
    if (values.sanctions_flag !== 'keep') body.sanctions_flag = values.sanctions_flag === 'true';
    const res = await api.patchKycRisk(targetUid, body);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setErr(data.detail || 'Failed to patch KYC risk');
    setOk(`KYC risk updated for ${targetUid}.`);
    setKycRiskOpen(false);
  }

  async function rerequestKyc(reason) {
    const targetUid = String(uid || '').trim();
    if (!targetUid) return setErr('Set User UID filter first.');
    const res = await api.rerequestKyc(targetUid, { notes: String(reason || '').trim() });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setErr(data.detail || 'Failed to re-request KYC');
    setOk(`KYC set to re_request for ${targetUid}.`);
    setRerequestOpen(false);
  }

  async function saveScreeningConfig(values) {
    setErr('');
    const payload = {
      enabled: values.enabled === 'true',
      min_match_score: Number(values.min_match_score || 0.8),
      fail_closed: values.fail_closed === 'true',
      block_on_wallet_blacklist: values.block_on_wallet_blacklist === 'true',
      block_on_sanctions: values.block_on_sanctions === 'true',
      monitor_large_trade_usdt: Number(values.monitor_large_trade_usdt || 25000),
      monitor_daily_turnover_usdt: Number(values.monitor_daily_turnover_usdt || 100000),
      velocity_withdraw_count_24h: Number(values.velocity_withdraw_count_24h || 3),
    };
    const res = await api.patchComplianceScreeningConfig(payload);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setErr(data.detail || 'Failed to save screening configuration');
    setOk('Screening configuration updated.');
    setScreeningConfig(data);
  }

  async function addWalletBlacklist(values) {
    setErr('');
    const res = await api.createComplianceWalletBlacklist({
      wallet_address: String(values.wallet_address || '').trim(),
      network: String(values.network || '').trim(),
      reason: String(values.reason || '').trim() || undefined,
      risk_level: values.risk_level,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setErr(data.detail || 'Failed to add wallet blacklist entry');
    setOk('Wallet blacklist entry added.');
    setAddWalletOpen(false);
    load();
  }

  async function addSanction(values) {
    setErr('');
    const res = await api.createComplianceSanction({
      entity_name: String(values.entity_name || '').trim(),
      list_source: String(values.list_source || '').trim() || 'manual',
      reference_id: String(values.reference_id || '').trim() || undefined,
      country: String(values.country || '').trim() || undefined,
      risk_level: values.risk_level,
      aliases: String(values.aliases || '').split(',').map((x) => x.trim()).filter(Boolean),
      notes: String(values.notes || '').trim() || undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setErr(data.detail || 'Failed to add sanction entry');
    setOk('Sanction entry added.');
    setAddSanctionOpen(false);
    load();
  }

  async function runSanctionSync() {
    setErr('');
    const res = await api.syncComplianceSanctions();
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setErr(data.detail || 'Failed to sync sanctions');
    setOk(`Sanction sync completed. Upserted ${data.upserted_count || 0} rows.`);
    load();
  }

  async function runMonitoring(values) {
    setErr('');
    const res = await api.runComplianceTransactionMonitoring({
      large_trade_usdt: Number(values.large_trade_usdt || 0),
      daily_turnover_usdt: Number(values.daily_turnover_usdt || 0),
      emit_cases: values.emit_cases === 'true',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setErr(data.detail || 'Failed to run monitoring');
    setOk(`Monitoring completed. Found ${data.items_found || 0}; created ${data.created_cases || 0} case(s).`);
    setMonitorRunOpen(false);
    load();
  }

  async function generateReport(values) {
    setErr('');
    const res = await api.generateComplianceReport({
      report_type: values.report_type,
      output_format: values.output_format,
      date_from: values.date_from,
      date_to: values.date_to,
      threshold_usdt: Number(values.threshold_usdt || 10000),
      notes: String(values.notes || '').trim() || undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setErr(data.detail || 'Failed to generate report');
    setOk(`${String(data.report_type || '').toUpperCase()} report generated.`);
    setReportOpen(false);
    load();
  }

  async function submitToFIU(reportId) {
    const res = await api.submitComplianceReportFIU(reportId);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setErr(data.detail || 'Failed to submit FIU report');
    setOk(`FIU submitted for ${reportId}.`);
    load();
  }

  async function toggleComplianceRule(rule) {
    if (!canManageCompliance || !rule?.id) return;
    setErr('');
    const res = await api.patchComplianceRule(rule.id, { enabled: !rule.enabled });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setErr(data.detail || 'Failed to update rule');
    setOk(`Rule ${rule.id} ${rule.enabled ? 'disabled' : 'enabled'}.`);
    load();
  }

  async function downloadReport(report) {
    const res = await api.downloadComplianceReport(report.id);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setErr(data.detail || 'Failed to download report');
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = report.file_name || `${report.id}.${report.output_format || 'csv'}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const screeningFields = useMemo(() => [
    { id: 'enabled', label: 'Screening enabled', type: 'select', value: String(screeningConfig?.enabled ?? true), options: [{ value: 'true', label: 'true' }, { value: 'false', label: 'false' }] },
    { id: 'min_match_score', label: 'Min match score (0-1)', value: String(screeningConfig?.min_match_score ?? 0.8) },
    { id: 'fail_closed', label: 'Fail closed', type: 'select', value: String(screeningConfig?.fail_closed ?? false), options: [{ value: 'true', label: 'true' }, { value: 'false', label: 'false' }] },
    { id: 'block_on_wallet_blacklist', label: 'Block wallet blacklist', type: 'select', value: String(screeningConfig?.block_on_wallet_blacklist ?? true), options: [{ value: 'true', label: 'true' }, { value: 'false', label: 'false' }] },
    { id: 'block_on_sanctions', label: 'Block sanctions', type: 'select', value: String(screeningConfig?.block_on_sanctions ?? true), options: [{ value: 'true', label: 'true' }, { value: 'false', label: 'false' }] },
    { id: 'monitor_large_trade_usdt', label: 'Large trade threshold (USDT)', value: String(screeningConfig?.monitor_large_trade_usdt ?? 25000) },
    { id: 'monitor_daily_turnover_usdt', label: 'Daily turnover threshold (USDT)', value: String(screeningConfig?.monitor_daily_turnover_usdt ?? 100000) },
    { id: 'velocity_withdraw_count_24h', label: 'Withdrawal velocity (count / 24h)', value: String(screeningConfig?.velocity_withdraw_count_24h ?? 3) },
  ], [screeningConfig]);

  return (
    <div className="admin-page">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="admin-title mb-2 flex items-center gap-2">
            <ShieldCheck className="text-gold-light" size={26} /> {isFIU ? 'FIU Reporting' : 'AML Operations'}
          </h1>
          <p className="admin-page-lead">
            {isFIU
              ? 'Generate, download, and submit STR/CTR reports for regulator workflows.'
              : 'Case management for AML operations: KYC risk controls, sanctions screening, blacklist actions, and monitoring.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setReportOpen(true)} className="rounded-xl border border-emerald-500/30 px-3 py-2 text-emerald-200 text-sm font-bold">Generate report</button>
          {isAML ? (
            <>
              <button type="button" onClick={() => setMonitorRunOpen(true)} className="rounded-xl border border-cyan-500/30 px-3 py-2 text-cyan-200 text-sm font-bold">Run screening</button>
              <button type="button" onClick={runSanctionSync} className="rounded-xl border border-fuchsia-500/30 px-3 py-2 text-fuchsia-200 text-sm font-bold">Sync sanctions</button>
              <button type="button" onClick={() => setAddWalletOpen(true)} className="rounded-xl border border-orange-500/30 px-3 py-2 text-orange-200 text-sm font-bold">Wallet blacklist</button>
              <button type="button" onClick={() => setAddSanctionOpen(true)} className="rounded-xl border border-violet-500/30 px-3 py-2 text-violet-200 text-sm font-bold">Add sanction</button>
              <button type="button" onClick={() => setKycRiskOpen(true)} className="rounded-xl border border-gold/30 px-3 py-2 text-gold-light text-sm font-bold">Patch KYC risk</button>
              <button type="button" onClick={() => setRerequestOpen(true)} className="rounded-xl border border-rose-500/30 px-3 py-2 text-rose-200 text-sm font-bold">Re-request KYC</button>
              <button type="button" onClick={() => setCreateOpen(true)} className="inline-flex items-center gap-2 rounded-xl border border-gold/35 px-3 py-2 text-gold-light text-sm font-bold"><Plus size={14} /> Create case</button>
            </>
          ) : null}
          <button type="button" onClick={load} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border border-surface-border px-3 py-2 text-white/80 text-sm font-bold disabled:opacity-40">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      <div className="mb-1 adm-table-x scrollbar-thin">
        <div className="admin-tabs w-max min-w-full">
          <Link to="/aml" className={`admin-tab-btn shrink-0 ${isAML ? 'active' : ''}`}>
            AML Operations
          </Link>
          <Link to="/fiu" className={`admin-tab-btn shrink-0 ${isFIU ? 'active' : ''}`}>
            FIU Reporting
          </Link>
          <Link to="/hedger" className="admin-tab-btn shrink-0">
            Risk Management
          </Link>
        </div>
      </div>

      {err ? <p className="text-red-400 text-sm">{err}</p> : null}
      {ok ? <p className="text-emerald-300 text-sm">{ok}</p> : null}

      {isAML ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <Stat title="Total cases" value={dash?.cases_total ?? 0} tone="blue" icon={Briefcase} />
          <Stat title="Open cases" value={dash?.cases_open ?? 0} tone="cyan" icon={FolderOpen} />
          <Stat title="High-risk cases" value={dash?.cases_high_risk ?? 0} tone="red" icon={AlertTriangle} />
          <Stat title="Pending or re-requested KYC" value={dash?.kyc_pending_or_rerequest ?? 0} tone="yellow" icon={UserCheck} />
          <Stat title="PEP flagged profiles" value={dash?.kyc_pep_flagged ?? 0} tone="purple" icon={Users} />
          <Stat title="Sanctions matches" value={dash?.kyc_sanctions_flagged ?? 0} tone="rose" icon={ShieldAlert} />
        </div>
      ) : (
        <div className="grid sm:grid-cols-3 gap-3">
          <Stat title="Reports total" value={(reports || []).length} tone="blue" icon={FileText} />
          <Stat title="FIU submitted" value={(reports || []).filter((r) => r.fiu_status === 'submitted').length} tone="emerald" icon={CheckCircle2} />
          <Stat title="Draft or pending" value={(reports || []).filter((r) => r.fiu_status !== 'submitted').length} tone="yellow" icon={Clock3} />
        </div>
      )}

      {isAML ? <div className="grid lg:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-surface-border bg-surface-card p-4">
          <h2 className="text-sm font-bold text-white mb-2">Sanction List Sync Status</h2>
          <p className="text-xs text-white/60">Last run: {syncStatus?.last_run?.started_at ? new Date(syncStatus.last_run.started_at).toLocaleString() : 'never'}</p>
          <p className="text-xs text-white/60">Last status: {syncStatus?.last_run?.status || 'n/a'}</p>
          <p className="text-xs text-white/60">Active sanctions: {syncStatus?.active_sanctions ?? 0}</p>
        </div>
        <div className="rounded-2xl border border-surface-border bg-surface-card p-4">
          <h2 className="text-sm font-bold text-white mb-2">Screening Configuration</h2>
          <div className="grid sm:grid-cols-2 gap-2 text-xs text-white/70">
            <p>Enabled: {String(screeningConfig?.enabled ?? true)}</p>
            <p>Min score: {screeningConfig?.min_match_score ?? 0.8}</p>
            <p>Fail closed: {String(screeningConfig?.fail_closed ?? false)}</p>
            <p>Block wallet blacklist: {String(screeningConfig?.block_on_wallet_blacklist ?? true)}</p>
            <p>Block sanctions: {String(screeningConfig?.block_on_sanctions ?? true)}</p>
            <p>Large trade: {screeningConfig?.monitor_large_trade_usdt ?? 25000} USDT</p>
            <p>Daily turnover: {screeningConfig?.monitor_daily_turnover_usdt ?? 100000} USDT</p>
            <p>WD velocity (24h): {screeningConfig?.velocity_withdraw_count_24h ?? 3} txs</p>
          </div>
          <button type="button" onClick={() => setScreeningOpen(true)} className="mt-3 rounded-lg border border-surface-border px-3 py-1.5 text-xs font-bold text-white/80">Edit screening config</button>
        </div>
      </div> : null}

      {isAML ? <div className="grid sm:grid-cols-2 lg:grid-cols-6 gap-3">
        <select value={caseType} onChange={(e) => { setSkip(0); setCaseType(e.target.value); }} className="rounded-xl bg-surface-card border border-surface-border px-3 py-2 text-sm text-white">
          <option value="">All types</option><option value="sar">sar</option><option value="str">str</option><option value="aml_review">aml_review</option>
        </select>
        <select value={status} onChange={(e) => { setSkip(0); setStatus(e.target.value); }} className="rounded-xl bg-surface-card border border-surface-border px-3 py-2 text-sm text-white">
          <option value="">All status</option><option value="open">open</option><option value="in_review">in_review</option><option value="escalated">escalated</option><option value="resolved">resolved</option><option value="closed">closed</option>
        </select>
        <select value={risk} onChange={(e) => { setSkip(0); setRisk(e.target.value); }} className="rounded-xl bg-surface-card border border-surface-border px-3 py-2 text-sm text-white">
          <option value="">All risk</option><option value="low">low</option><option value="medium">medium</option><option value="high">high</option><option value="critical">critical</option>
        </select>
        <UserUidSuggestInput value={uid} onChange={(v) => { setSkip(0); setUid(v); }} />
        <input value={q} onChange={(e) => { setSkip(0); setQ(e.target.value); }} placeholder="Search title/uid/id" className="lg:col-span-2 rounded-xl bg-surface-card border border-surface-border px-3 py-2 text-sm text-white placeholder:text-white/35" />
      </div> : null}

      {isAML ? (
        <AdminDataTable minWidth="1050px">
          <thead>
            <tr>
              <th>Updated</th>
              <th>Case</th>
              <th>UID</th>
              <th>Type</th>
              <th>Status</th>
              <th>Risk</th>
              <th>Assignee</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="text-center text-white/50">Loading…</td></tr>
            ) : cases.length === 0 ? (
              <tr><td colSpan={8} className="text-center text-white/50">No compliance cases match.</td></tr>
            ) : cases.map((c) => (
              <tr key={c.id}>
                <td className="text-xs text-white/60">{c.updated_at ? new Date(c.updated_at).toLocaleString() : '—'}</td>
                <td><p className="font-semibold text-white">{c.title}</p><p className="text-[11px] font-mono text-white/40">{c.id}</p></td>
                <td className="text-xs font-mono text-blue-300">{c.uid || '—'}</td>
                <td className="text-xs uppercase">{c.case_type}</td>
                <td className="text-xs">{c.status}</td>
                <td className="text-xs">{c.risk_level}</td>
                <td className="text-xs font-mono">{c.assignee_aid || '—'}</td>
                <td className="text-right">
                  <div className="inline-flex items-center gap-2">
                    <button type="button" onClick={() => setEditCase(c)} className="text-xs font-bold text-gold-light hover:underline">Update</button>
                    <button type="button" onClick={() => setAttachCase(c)} className="inline-flex items-center gap-1 text-xs font-bold text-sky-300 hover:underline"><Paperclip size={12} /> Attach</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </AdminDataTable>
      ) : null}

      {isAML ? <div className="grid lg:grid-cols-2 gap-4">
        <div>
          <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-white">Transaction monitoring</h3>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-white/50">Source</span>
              <select
                value={monitorSource}
                onChange={(e) => { setMonitorSource(e.target.value); setSkip(0); }}
                className="rounded-lg bg-surface-dark border border-surface-border px-2 py-1 text-white font-bold"
              >
                <option value="stored">Stored events</option>
                <option value="live">Live scan</option>
              </select>
            </div>
          </div>
          <AdminDataTable minWidth="760px">
            <thead>
              <tr>
                {['Event', 'UID', 'Amount USDT', 'Reason', 'Time'].map((c) => <th key={c}>{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {(monitoring || []).length === 0 ? (
                <tr><td className="text-white/50" colSpan={5}>No rows.</td></tr>
              ) : (monitoring || []).slice(0, 12).map((m, idx) => (
                <tr key={`mon-${idx}`}>
                  <td className="text-white/85">{m.event_type}</td>
                  <td className="text-white/85 font-mono text-xs">{m.uid || '—'}</td>
                  <td className="text-white/85">{m.amount_usdt ?? '—'}</td>
                  <td className="text-white/85">{m.reason || '—'}</td>
                  <td className="text-white/85 text-xs">{m.created_at ? new Date(m.created_at).toLocaleString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </AdminDataTable>
        </div>
      </div> : null}

      {isFIU ? (
        <>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat title="STR reports" value={fiuMetrics.strCount} tone="blue" icon={FileSearch} />
            <Stat title="CTR reports" value={fiuMetrics.ctrCount} tone="cyan" icon={Landmark} />
            <Stat title="Draft pipeline" value={fiuMetrics.draft} tone="yellow" icon={Clock3} />
            <Stat title="Submitted to FIU" value={fiuMetrics.submitted} tone="emerald" icon={CheckCircle2} />
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <div className="rounded-2xl border border-surface-border bg-surface-card p-4">
              <h2 className="text-sm font-bold text-white mb-2">FIU Queue Summary</h2>
              <div className="grid sm:grid-cols-2 gap-2 text-xs text-white/70">
                <p>Reports in current view: {filteredReports.length}</p>
                <p>Total rows covered: {fiuMetrics.totalRows}</p>
                <p>Current status filter: {fiuStatus.toUpperCase()}</p>
                <p>Current type filter: {fiuType.toUpperCase()}</p>
              </div>
            </div>
            <div className="rounded-2xl border border-surface-border bg-surface-card p-4">
              <h2 className="text-sm font-bold text-white mb-2">Latest Report Snapshot</h2>
              {fiuMetrics.latest ? (
                <div className="grid sm:grid-cols-2 gap-2 text-xs text-white/70">
                  <p>ID: <span className="font-mono text-white/90">{fiuMetrics.latest.id}</span></p>
                  <p>Type: <span className="text-white/90 uppercase">{String(fiuMetrics.latest.report_type || '—')}</span></p>
                  <p>Format: <span className="text-white/90 uppercase">{String(fiuMetrics.latest.output_format || '—')}</span></p>
                  <p>FIU status: <span className="text-white/90">{fiuMetrics.latest.fiu_status || 'draft'}</span></p>
                  <p className="sm:col-span-2">Updated: <span className="text-white/90">{fiuMetrics.latest.updated_at ? new Date(fiuMetrics.latest.updated_at).toLocaleString() : '—'}</span></p>
                </div>
              ) : (
                <p className="text-xs text-white/60">No report generated yet.</p>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-surface-border bg-surface-card p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="admin-tabs">
                {[
                  { id: 'all', label: 'All reports' },
                  { id: 'draft', label: 'Draft' },
                  { id: 'submitted', label: 'Submitted' },
                ].map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setFiuStatus(s.id)}
                    className={`admin-tab-btn text-xs ${fiuStatus === s.id ? 'active' : ''}`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              <div className="admin-tabs">
                {[
                  { id: 'all', label: 'All types' },
                  { id: 'str', label: 'STR' },
                  { id: 'ctr', label: 'CTR' },
                ].map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setFiuType(t.id)}
                    className={`admin-tab-btn text-xs ${fiuType === t.id ? 'active' : ''}`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <input
                value={fiuSearch}
                onChange={(e) => setFiuSearch(e.target.value)}
                placeholder="Search report id/type/format"
                className="ml-auto min-w-[240px] rounded-lg bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white placeholder:text-white/35"
              />
            </div>
            <p className="text-xs text-white/55">
              FIU workflow: generate STR/CTR report, download for verification, then submit to FIU.
            </p>
          </div>

          <SimpleTable
            title="FIU Reporting (STR/CTR)"
            columns={['ID', 'Type', 'Rows', 'Format', 'FIU', 'Actions']}
            rows={filteredReports.slice(0, 50).map((r) => [
              r.id,
              String(r.report_type || '').toUpperCase(),
              r.rows_count ?? 0,
              String(r.output_format || '').toUpperCase(),
              r.fiu_status || 'draft',
              <span key={r.id} className="inline-flex gap-2">
                <button type="button" onClick={() => downloadReport(r)} className="text-sky-300 hover:underline">Download</button>
                {r.fiu_status !== 'submitted' ? <button type="button" onClick={() => submitToFIU(r.id)} className="text-emerald-300 hover:underline">Submit FIU</button> : null}
              </span>,
            ])}
          />
        </>
      ) : null}

      {isAML ? (
        <div>
          <div className="px-4 py-3">
            <h3 className="text-sm font-bold text-white">Compliance rules</h3>
            <p className="text-xs text-white/50 mt-1">
              {canManageCompliance ? 'Toggle built-in monitoring rules on or off.' : 'View only — rule changes require finance or superadmin.'}
            </p>
          </div>
          <AdminDataTable minWidth="720px">
            <thead>
              <tr>
                <th>ID</th>
                <th>Name</th>
                <th>Kind</th>
                <th>Enabled</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(complianceRules || []).length === 0 ? (
                <tr><td className="text-white/50" colSpan={5}>No compliance rules.</td></tr>
              ) : complianceRules.map((rule) => (
                <tr key={rule.id}>
                  <td className="font-mono text-xs text-white/70">{rule.id}</td>
                  <td className="text-white/85">{rule.name}</td>
                  <td className="text-xs uppercase text-white/70">{rule.rule_kind}</td>
                  <td className="text-white/85">{rule.enabled ? 'yes' : 'no'}</td>
                  <td className="text-right">
                    {canManageCompliance ? (
                      <button
                        type="button"
                        onClick={() => toggleComplianceRule(rule)}
                        className="text-xs font-bold text-gold-light hover:underline"
                      >
                        {rule.enabled ? 'Disable' : 'Enable'}
                      </button>
                    ) : (
                      <span className="text-white/35 text-xs">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </AdminDataTable>
        </div>
      ) : null}

      {isAML ? <div className="grid lg:grid-cols-2 gap-4">
        <SimpleTable
          title="Wallet Blacklist"
          columns={['Wallet', 'Network', 'Risk', 'Reason', 'Updated']}
          rows={(walletBlacklist || []).slice(0, 12).map((w) => [w.wallet_address, w.network, w.risk_level, w.reason || '—', w.updated_at ? new Date(w.updated_at).toLocaleString() : '—'])}
        />
        <SimpleTable
          title="Blacklists & Sanctions"
          columns={['Entity', 'Source', 'Country', 'Risk', 'Updated']}
          rows={(sanctions || []).slice(0, 12).map((s) => [s.entity_name, s.list_source, s.country || '—', s.risk_level, s.updated_at ? new Date(s.updated_at).toLocaleString() : '—'])}
        />
      </div> : null}

      {isAML ? <div className="flex items-center justify-between text-sm text-white/55">
        <span>{total} cases</span>
        <div className="flex items-center gap-2">
          <select value={String(limit)} onChange={(e) => { setSkip(0); setLimit(Number(e.target.value)); }} className="rounded-xl bg-surface-card border border-surface-border px-3 py-2 text-white text-sm">
            {[25, 40, 50, 100].map((n) => <option key={n} value={n}>{n}/page</option>)}
          </select>
          <button type="button" disabled={skip <= 0} onClick={() => setSkip((s) => Math.max(0, s - limit))} className="rounded-xl border border-surface-border px-3 py-2 text-sm font-bold disabled:opacity-40">Prev</button>
          <button type="button" disabled={skip + limit >= total} onClick={() => setSkip((s) => s + limit)} className="rounded-xl border border-surface-border px-3 py-2 text-sm font-bold disabled:opacity-40">Next</button>
        </div>
      </div> : null}

      {isAML ? <FormModal
        open={createOpen}
        title="Create compliance case"
        confirmText="Create case"
        onClose={() => setCreateOpen(false)}
        onConfirm={createCase}
        fields={[
          { id: 'case_type', label: 'Case type', type: 'select', value: 'sar', required: true, options: [{ value: 'sar', label: 'sar' }, { value: 'str', label: 'str' }, { value: 'aml_review', label: 'aml_review' }] },
          { id: 'title', label: 'Title', value: '', required: true },
          { id: 'uid', label: 'User UID (optional)', value: uid || '' },
          { id: 'risk_level', label: 'Risk level', type: 'select', value: 'medium', options: [{ value: 'low', label: 'low' }, { value: 'medium', label: 'medium' }, { value: 'high', label: 'high' }, { value: 'critical', label: 'critical' }] },
          { id: 'notes', label: 'Notes', type: 'textarea', value: '', rows: 4 },
        ]}
      /> : null}

      {isAML ? <FormModal
        open={!!editCase}
        title={`Update ${editCase?.id || ''}`}
        confirmText="Save changes"
        onClose={() => setEditCase(null)}
        onConfirm={patchCase}
        fields={[
          { id: 'status', label: 'Status', type: 'select', value: editCase?.status || 'open', required: true, options: [{ value: 'open', label: 'open' }, { value: 'in_review', label: 'in_review' }, { value: 'escalated', label: 'escalated' }, { value: 'resolved', label: 'resolved' }, { value: 'closed', label: 'closed' }] },
          { id: 'assignee_aid', label: 'Assignee AID', value: editCase?.assignee_aid || '' },
          { id: 'risk_level', label: 'Risk level', type: 'select', value: editCase?.risk_level || 'medium', options: [{ value: 'low', label: 'low' }, { value: 'medium', label: 'medium' }, { value: 'high', label: 'high' }, { value: 'critical', label: 'critical' }] },
          { id: 'notes', label: 'Notes', type: 'textarea', value: editCase?.notes || '', rows: 4 },
        ]}
      /> : null}

      {isAML ? <FormModal
        open={!!attachCase}
        title={`Add attachment to ${attachCase?.id || ''}`}
        confirmText="Add attachment"
        onClose={() => setAttachCase(null)}
        onConfirm={addAttachment}
        fields={[
          { id: 'name', label: 'Attachment name', value: '', required: true },
          { id: 'url', label: 'Attachment URL', value: '', required: true },
          { id: 'mime_type', label: 'MIME type', value: '' },
          { id: 'note', label: 'Note', type: 'textarea', value: '', rows: 3 },
        ]}
      /> : null}

      {isAML ? <FormModal
        open={kycRiskOpen}
        title="Patch KYC risk profile"
        confirmText="Save risk"
        onClose={() => setKycRiskOpen(false)}
        onConfirm={patchKycRisk}
        fields={[
          { id: 'uid', label: 'User UID', value: uid || '', required: true },
          { id: 'tags', label: 'Risk tags (comma separated)', value: '' },
          { id: 'pep_flag', label: 'PEP flag', type: 'select', value: 'keep', options: [{ value: 'keep', label: 'keep' }, { value: 'true', label: 'true' }, { value: 'false', label: 'false' }] },
          { id: 'sanctions_flag', label: 'Sanctions flag', type: 'select', value: 'keep', options: [{ value: 'keep', label: 'keep' }, { value: 'true', label: 'true' }, { value: 'false', label: 'false' }] },
          { id: 'note', label: 'Risk note', type: 'textarea', value: '', rows: 3 },
        ]}
      /> : null}

      {isAML ? <ConfirmModal
        open={rerequestOpen}
        title="Re-request KYC submission"
        message={uid ? `Set ${uid} to KYC re_request?` : 'Set User UID filter first.'}
        inputLabel="Reason"
        inputPlaceholder="Please re-submit KYC documents for additional verification."
        initialValue="Please re-submit KYC documents for additional verification."
        required
        danger
        confirmText="Re-request"
        onClose={() => setRerequestOpen(false)}
        onConfirm={rerequestKyc}
      /> : null}

      {isAML ? <FormModal
        open={addWalletOpen}
        title="Add wallet blacklist entry"
        confirmText="Add wallet"
        onClose={() => setAddWalletOpen(false)}
        onConfirm={addWalletBlacklist}
        fields={[
          { id: 'wallet_address', label: 'Wallet address', value: '', required: true },
          { id: 'network', label: 'Network', value: 'TRC20', required: true },
          { id: 'risk_level', label: 'Risk level', type: 'select', value: 'high', options: [{ value: 'medium', label: 'medium' }, { value: 'high', label: 'high' }, { value: 'critical', label: 'critical' }] },
          { id: 'reason', label: 'Reason', type: 'textarea', value: '', rows: 3 },
        ]}
      /> : null}

      {isAML ? <FormModal
        open={addSanctionOpen}
        title="Add sanction list entity"
        confirmText="Add entity"
        onClose={() => setAddSanctionOpen(false)}
        onConfirm={addSanction}
        fields={[
          { id: 'entity_name', label: 'Entity name', value: '', required: true },
          { id: 'list_source', label: 'Source list', value: 'manual' },
          { id: 'reference_id', label: 'Reference ID', value: '' },
          { id: 'country', label: 'Country', value: '' },
          { id: 'risk_level', label: 'Risk level', type: 'select', value: 'high', options: [{ value: 'medium', label: 'medium' }, { value: 'high', label: 'high' }, { value: 'critical', label: 'critical' }] },
          { id: 'aliases', label: 'Aliases (comma separated)', value: '' },
          { id: 'notes', label: 'Notes', type: 'textarea', value: '', rows: 3 },
        ]}
      /> : null}

      {isAML ? <FormModal
        open={monitorRunOpen}
        title="Run transaction monitoring"
        confirmText="Run now"
        onClose={() => setMonitorRunOpen(false)}
        onConfirm={runMonitoring}
        fields={[
          { id: 'large_trade_usdt', label: 'Large trade threshold (USDT)', value: String(screeningConfig?.monitor_large_trade_usdt ?? 25000) },
          { id: 'daily_turnover_usdt', label: 'Daily turnover threshold (USDT)', value: String(screeningConfig?.monitor_daily_turnover_usdt ?? 100000) },
          { id: 'emit_cases', label: 'Auto-create STR cases', type: 'select', value: 'false', options: [{ value: 'false', label: 'false' }, { value: 'true', label: 'true' }] },
        ]}
      /> : null}

      <FormModal
        open={reportOpen}
        title="Generate compliance report"
        confirmText="Generate report"
        onClose={() => setReportOpen(false)}
        onConfirm={generateReport}
        fields={[
          { id: 'report_type', label: 'Report type', type: 'select', value: 'str', options: [{ value: 'str', label: 'STR' }, { value: 'ctr', label: 'CTR' }] },
          { id: 'output_format', label: 'Output format', type: 'select', value: 'csv', options: [{ value: 'csv', label: 'CSV' }, { value: 'xlsx', label: 'XLSX' }, { value: 'json', label: 'JSON' }] },
          { id: 'date_from', label: 'Date from (ISO)', value: new Date(Date.now() - 7 * 86400000).toISOString() },
          { id: 'date_to', label: 'Date to (ISO)', value: new Date().toISOString() },
          { id: 'threshold_usdt', label: 'Threshold (CTR)', value: '10000' },
          { id: 'notes', label: 'Notes', type: 'textarea', value: '', rows: 3 },
        ]}
      />

      {isAML ? <FormModal
        open={screeningOpen}
        title="Edit screening configuration"
        confirmText="Save configuration"
        onClose={() => setScreeningOpen(false)}
        onConfirm={async (values) => {
          await saveScreeningConfig(values);
          setScreeningOpen(false);
          load();
        }}
        fields={screeningFields}
      /> : null}
    </div>
  );
}

function Stat({ title, value, tone = 'blue', icon: Icon }) {
  const tones = {
    blue: 'bg-gradient-to-br from-[#FE6C02]/30 via-[#FE6C02]/14 to-transparent border-[#FE6C02]/45',
    emerald: 'bg-gradient-to-br from-[#00A876]/30 via-[#00A876]/14 to-transparent border-[#00A876]/45',
    cyan: 'bg-gradient-to-br from-[#FE9D55]/30 via-[#FE6C02]/14 to-transparent border-[#FE6C02]/45',
    yellow: 'bg-gradient-to-br from-[#FE9D55]/30 via-[#FE6C02]/14 to-transparent border-[#FE6C02]/45',
    purple: 'bg-gradient-to-br from-[#B44D01]/30 via-[#FE6C02]/14 to-transparent border-[#B44D01]/45',
    red: 'bg-gradient-to-br from-[#EB5454]/30 via-[#EB5454]/14 to-transparent border-[#EB5454]/45',
    rose: 'bg-gradient-to-br from-[#EB5454]/30 via-[#EB5454]/14 to-transparent border-[#EB5454]/45',
  };
  return (
    <div className={`rounded-xl border p-4 shadow-[0_10px_24px_rgba(0,0,0,0.22)] ${tones[tone] || tones.blue}`}>
      <div className="flex items-center gap-2 mb-1">
        {Icon ? <Icon size={16} className="text-white/90" /> : null}
        <p className="text-sm font-semibold text-white/90">{title}</p>
      </div>
      <p className="text-2xl font-extrabold text-white mt-1">{value}</p>
    </div>
  );
}

function SimpleTable({ title, columns, rows }) {
  return (
    <div>
      <div className="px-4 py-3">
        <h3 className="text-sm font-bold text-white">{title}</h3>
      </div>
      <AdminDataTable minWidth="760px">
        <thead>
          <tr>
            {columns.map((c) => <th key={c}>{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td className="text-white/50" colSpan={columns.length}>No rows.</td></tr>
          ) : rows.map((r, idx) => (
            <tr key={`${title}-${idx}`}>
              {r.map((cell, i) => <td key={`${title}-${idx}-${i}`} className="text-white/85">{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </AdminDataTable>
    </div>
  );
}
