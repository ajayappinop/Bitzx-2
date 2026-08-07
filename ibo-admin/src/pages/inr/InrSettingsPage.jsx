import { useCallback, useEffect, useState } from 'react';
import { IndianRupee, Plus, RefreshCw, Trash2, ToggleLeft, ToggleRight } from 'lucide-react';
import { api } from '@/lib/api';
import { useAdminAuth } from '@/context/AdminAuthContext';
import { hasPermission } from '@/lib/adminAccess';
import { AdminPageHeader, AdminPanel } from '@/components/AdminPrimitives';
import ConfirmModal from '@/components/ConfirmModal';

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000';

function uploadUrl(path) {
  if (!path) return '';
  if (path.startsWith('http')) return path;
  return `${BACKEND}${path}`;
}

const emptyBank = { bank_name: '', account_holder_name: '', account_number: '', ifsc_code: '', branch: '' };
const emptyUpi = { upi_id: '', display_name: '' };
const emptyQr = { label: '' };

const TYPE_LABELS = { bank: 'Bank transfer', upi: 'UPI', qr: 'QR code' };

const DEPOSIT_MODE_LABELS = {
  manual: 'Manual only (UTR + screenshot, admin approval)',
  gateway: 'Payment gateway only (automatic checkout)',
  hybrid: 'Hybrid (manual + gateway)',
};

const GATEWAY_PROVIDER_LABELS = {
  none: 'None',
  razorpay: 'Razorpay',
  cashfree: 'Cashfree',
  payu: 'PayU',
  phonepe: 'PhonePe',
};

const SETTINGS_TABS = [
  { id: 'gateway', label: 'Payment gateway' },
  { id: 'methods', label: 'Manual methods' },
];

function methodDisplayLabel(m) {
  if (m?.label) return m.label;
  const d = m?.details || {};
  if (m?.type === 'bank') {
    const tail = String(d.account_number || '').slice(-4);
    return `${d.bank_name || 'Bank'}${tail ? ` · ••••${tail}` : ''}`;
  }
  if (m?.type === 'upi') return d.display_name || d.upi_id || 'UPI';
  if (m?.type === 'qr') return d.label || 'QR';
  return TYPE_LABELS[m?.type] || 'Payment method';
}

export default function InrSettingsPage() {
  const { admin } = useAdminAuth();
  const canManage = hasPermission(admin, 'manage_settings');

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');

  const [formType, setFormType] = useState('bank');
  const [bank, setBank] = useState(emptyBank);
  const [upi, setUpi] = useState(emptyUpi);
  const [qr, setQr] = useState(emptyQr);
  const [qrFile, setQrFile] = useState(null);
  const [saving, setSaving] = useState(false);

  const [gatewayCfg, setGatewayCfg] = useState(null);
  const [gatewayProviders, setGatewayProviders] = useState([]);
  const [gwMode, setGwMode] = useState('manual');
  const [gwProvider, setGwProvider] = useState('none');
  const [gwAutoMax, setGwAutoMax] = useState('0');
  const [gwMinDeposit, setGwMinDeposit] = useState('0');
  const [gwSaving, setGwSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [activeTab, setActiveTab] = useState('gateway');

  const loadGateway = useCallback(async () => {
    try {
      const [cfgRes, provRes] = await Promise.all([
        api.inrGatewayConfig(),
        api.inrGatewayProviders(),
      ]);
      const cfg = await cfgRes.json();
      const prov = await provRes.json();
      if (!cfgRes.ok) throw new Error(cfg.detail || `HTTP ${cfgRes.status}`);
      if (!provRes.ok) throw new Error(prov.detail || `HTTP ${provRes.status}`);
      const provItems = Array.isArray(prov.items) ? prov.items : [];
      setGatewayCfg(cfg);
      setGatewayProviders(provItems);
      const mode = cfg.deposit_mode || 'manual';
      let provider = cfg.gateway_provider || 'none';
      if (mode !== 'manual' && provider === 'none') {
        const first = provItems.find((p) => p.id && p.id !== 'none');
        provider = first?.id || 'razorpay';
      }
      setGwMode(mode);
      setGwProvider(provider);
      setGwAutoMax(String(cfg.auto_approve_max_inr ?? 0));
      setGwMinDeposit(
        cfg.min_deposit_inr != null && cfg.min_deposit_inr !== ''
          ? String(cfg.min_deposit_inr)
          : '0',
      );
    } catch (e) {
      setErr((prev) => prev || e.message || 'Could not load gateway settings');
    }
  }, []);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    setErr('');
    try {
      const r = await api.inrPaymentMethods();
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail || `HTTP ${r.status}`);
      setItems(Array.isArray(j.items) ? j.items : []);
    } catch (e) {
      setErr(e.message || 'Could not load payment methods');
      if (!silent) setItems([]);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    loadGateway();
  }, [load, loadGateway]);

  useEffect(() => {
    if (!ok) return undefined;
    const t = setTimeout(() => setOk(''), 3500);
    return () => clearTimeout(t);
  }, [ok]);

  const toggleActive = async (m) => {
    if (!canManage) return;
    setErr('');
    setOk('');
    const prevActive = m.is_active;
    const nextActive = !prevActive;
    setItems((list) => list.map((x) => (x.id === m.id ? { ...x, is_active: nextActive } : x)));
    try {
      const r = await api.inrUpdatePaymentMethod(m.id, { is_active: nextActive });
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail || `HTTP ${r.status}`);
      if (j?.id) {
        setItems((list) => list.map((x) => (x.id === j.id ? { ...x, ...j } : x)));
      }
    } catch (e) {
      setItems((list) => list.map((x) => (x.id === m.id ? { ...x, is_active: prevActive } : x)));
      setErr(e.message);
    }
  };

  const confirmDeleteMethod = async () => {
    if (!canManage || !deleteTarget?.id) return;
    const id = deleteTarget.id;
    setDeleteBusy(true);
    setErr('');
    setOk('');
    const prev = items;
    setItems((list) => list.filter((x) => x.id !== id));
    try {
      const r = await api.inrDeletePaymentMethod(id);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail || `HTTP ${r.status}`);
      setOk('Payment method deleted');
      setDeleteTarget(null);
    } catch (e) {
      setItems(prev);
      setErr(e.message);
    } finally {
      setDeleteBusy(false);
    }
  };

  const pickDefaultGatewayProvider = () => {
    const first = gatewayProviders.find((p) => p.id && p.id !== 'none');
    return first?.id || 'razorpay';
  };

  const onDepositModeChange = (mode) => {
    setGwMode(mode);
    if (mode === 'manual') {
      setGwProvider('none');
      return;
    }
    if (gwProvider === 'none' || !gwProvider) {
      setGwProvider(pickDefaultGatewayProvider());
    }
  };

  const saveGatewayConfig = async (e) => {
    e.preventDefault();
    if (!canManage) return;
    setErr('');
    setOk('');
    if (gwMode !== 'manual' && (!gwProvider || gwProvider === 'none')) {
      setErr(
        'Choose a gateway provider (e.g. Razorpay) below, or switch deposit flow to “Manual only” if you are not using automatic payments yet.',
      );
      return;
    }
    setGwSaving(true);
    try {
      const auto = parseFloat(gwAutoMax);
      const minDep = parseFloat(gwMinDeposit);
      const r = await api.inrUpdateGatewayConfig({
        deposit_mode: gwMode,
        gateway_provider: gwMode === 'manual' ? 'none' : gwProvider,
        min_deposit_inr: Number.isFinite(minDep) && minDep >= 0 ? Math.round(minDep * 100) / 100 : 0,
        auto_approve_max_inr:
          gwMode === 'manual'
            ? 0
            : Number.isFinite(auto) && auto >= 0
              ? auto
              : 0,
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail || `HTTP ${r.status}`);
      setGatewayCfg(j);
      setGwMinDeposit(j.min_deposit_inr != null ? String(j.min_deposit_inr) : '0');
      setOk('Payment gateway settings saved');
    } catch (ex) {
      setErr(ex.message || 'Could not save gateway settings');
    } finally {
      setGwSaving(false);
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!canManage) return;
    setSaving(true);
    setErr('');
    setOk('');
    try {
      if (formType === 'qr') {
        if (!qrFile) throw new Error('QR image is required');
        const fd = new FormData();
        fd.append('type', 'qr');
        fd.append('details_json', JSON.stringify(qr));
        fd.append('is_active', 'true');
        fd.append('qr_image', qrFile);
        const r = await api.inrCreateQrPaymentMethod(fd);
        const j = await r.json();
        if (!r.ok) throw new Error(j.detail || `HTTP ${r.status}`);
      } else {
        const details = formType === 'bank' ? bank : upi;
        const r = await api.inrCreatePaymentMethod({ type: formType, details, is_active: true });
        const j = await r.json();
        if (!r.ok) throw new Error(j.detail || `HTTP ${r.status}`);
      }
      setBank(emptyBank);
      setUpi(emptyUpi);
      setQr(emptyQr);
      setQrFile(null);
      setOk('Payment method added');
      setActiveTab('methods');
      await load({ silent: true });
    } catch (ex) {
      setErr(ex.message || 'Could not create method');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="admin-page">
      <AdminPageHeader
        icon={IndianRupee}
        title="INR deposit settings"
        subtitle="Payment gateway (automatic) and manual bank/UPI/QR methods for INR deposits."
        actions={(
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-surface-border text-sm font-bold text-white hover:border-gold/40 disabled:opacity-40"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        )}
      />

      {err && (
        <p className="text-rose-300 text-sm mb-4 flex items-center justify-between gap-3">
          <span>{err}</span>
          <button type="button" onClick={() => setErr('')} className="text-white/50 hover:text-white text-xs shrink-0">Dismiss</button>
        </p>
      )}
      {ok && (
        <p className="text-emerald-300 text-sm mb-4 flex items-center justify-between gap-3">
          <span>{ok}</span>
          <button type="button" onClick={() => setOk('')} className="text-white/50 hover:text-white text-xs shrink-0">Dismiss</button>
        </p>
      )}

      <div className="flex gap-2 overflow-x-auto pb-1 mb-6 border-b border-surface-border/70">
        {SETTINGS_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setActiveTab(t.id)}
            className={`admin-tab-btn shrink-0 ${activeTab === t.id ? 'active' : ''}`}
          >
            {t.label}
            {t.id === 'methods' && items.length > 0 ? (
              <span className="ml-1.5 text-[10px] font-bold opacity-70">({items.length})</span>
            ) : null}
          </button>
        ))}
      </div>

      {activeTab === 'gateway' && (
      <AdminPanel title="Payment gateway" className="mb-6">
        <p className="text-sm text-white/55 mb-4">
          Gateway / hybrid need a provider name saved first (credentials can be added in{' '}
          <code className="text-white/70">.env</code> later). Until then, manual deposits work as today.
        </p>
        {canManage ? (
          <form onSubmit={saveGatewayConfig} className="space-y-4 max-w-xl">
            <div>
              <label className="text-xs text-white/50 uppercase">Minimum deposit (INR)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                className="mt-1 w-full rounded-lg border border-surface-border bg-surface-dark px-3 py-2 text-white text-sm"
                value={gwMinDeposit}
                onChange={(e) => setGwMinDeposit(e.target.value)}
              />
              <p className="text-[11px] text-white/40 mt-1">
                Users cannot submit manual or gateway deposits below this amount. Use 0 for no minimum. Supports paise (e.g. 500.50).
              </p>
            </div>
            <div>
              <label className="text-xs text-white/50 uppercase">Deposit flow</label>
              <select
                className="mt-1 w-full rounded-lg border border-surface-border bg-surface-dark px-3 py-2 text-white text-sm"
                value={gwMode}
                onChange={(e) => onDepositModeChange(e.target.value)}
              >
                {Object.entries(DEPOSIT_MODE_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>{label}</option>
                ))}
              </select>
            </div>
            {gwMode !== 'manual' && (
              <div>
                <label className="text-xs text-white/50 uppercase">Gateway provider</label>
                <select
                  className="mt-1 w-full rounded-lg border border-surface-border bg-surface-dark px-3 py-2 text-white text-sm"
                  value={gwProvider === 'none' ? '' : gwProvider}
                  onChange={(e) => setGwProvider(e.target.value)}
                  required
                >
                  <option value="" disabled>
                    Select provider…
                  </option>
                  {gatewayProviders
                    .filter((p) => p.id !== 'none')
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                        {p.configured ? ' · credentials set' : ' · no API keys yet'}
                        {!p.implemented ? ' · integration coming soon' : ''}
                      </option>
                    ))}
                </select>
                <p className="text-[11px] text-white/40 mt-1">
                  Picking Razorpay (or another) only records your choice. Checkout stays off until
                  keys are added and the integration is enabled.
                </p>
              </div>
            )}
            {gwMode !== 'manual' && (
              <div>
                <label className="text-xs text-white/50 uppercase">
                  Auto-approve up to (INR)
                </label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  className="mt-1 w-full rounded-lg border border-surface-border bg-surface-dark px-3 py-2 text-white text-sm"
                  value={gwAutoMax}
                  onChange={(e) => setGwAutoMax(e.target.value)}
                />
                <p className="text-[11px] text-white/40 mt-1">
                  After a successful gateway payment, credit IBO automatically when amount is at or below this limit.
                  Use 0 to always require admin review.
                </p>
              </div>
            )}
            <button
              type="submit"
              disabled={gwSaving}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-cyan-500/15 text-cyan-200 font-bold border border-cyan-500/30 disabled:opacity-50"
            >
              {gwSaving ? 'Saving…' : 'Save gateway settings'}
            </button>
          </form>
        ) : (
          <dl className="text-sm space-y-2 max-w-xl">
            <div className="flex justify-between gap-4">
              <dt className="text-white/50">Minimum deposit</dt>
              <dd className="text-white font-semibold">
                {Number(gatewayCfg?.min_deposit_inr || 0) > 0
                  ? `₹${Number(gatewayCfg.min_deposit_inr).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                  : 'No minimum'}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-white/50">Flow</dt>
              <dd className="text-white font-semibold">{DEPOSIT_MODE_LABELS[gatewayCfg?.deposit_mode] || gatewayCfg?.deposit_mode || '—'}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-white/50">Provider</dt>
              <dd className="text-white font-semibold">
                {GATEWAY_PROVIDER_LABELS[gatewayCfg?.gateway_provider] || gatewayCfg?.gateway_provider || '—'}
              </dd>
            </div>
            {gatewayCfg?.deposit_mode && gatewayCfg.deposit_mode !== 'manual' && (
              <div className="flex justify-between gap-4">
                <dt className="text-white/50">Auto-approve up to</dt>
                <dd className="text-white font-semibold">
                  ₹{Number(gatewayCfg.auto_approve_max_inr || 0).toLocaleString('en-IN')}
                </dd>
              </div>
            )}
          </dl>
        )}
      </AdminPanel>
      )}

      {activeTab === 'methods' && (
        <div className={`grid grid-cols-1 gap-6 ${canManage ? 'xl:grid-cols-[1fr_minmax(320px,400px)]' : ''}`}>
          <AdminPanel
            title="Configured methods"
            subtitle="Shown to users on the INR deposit page when manual flow is enabled."
          >
            {loading && items.length === 0 ? (
              <p className="text-white/60 text-sm">Loading…</p>
            ) : items.length === 0 ? (
              <div className="rounded-xl border border-dashed border-surface-border bg-surface-dark px-5 py-8 text-center">
                <p className="text-white/70 text-sm font-semibold">No payment methods yet</p>
                <p className="text-white/45 text-xs mt-2 max-w-sm mx-auto">
                  {canManage
                    ? 'Use the panel on the right to add bank, UPI, or QR instructions.'
                    : 'An administrator can add methods from this screen.'}
                </p>
              </div>
            ) : (
              <ul className="space-y-3">
                {items.map((m) => (
                  <li
                    key={m.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-surface-border bg-surface-dark px-4 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-bold text-white">{methodDisplayLabel(m)}</p>
                        <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border border-surface-border text-white/50">
                          {TYPE_LABELS[m.type] || m.type}
                        </span>
                      </div>
                      {m.type === 'bank' && (
                        <p className="text-sm text-white/60 mt-1">
                          A/C {m.details?.account_number}
                          {m.details?.ifsc_code ? ` · IFSC ${m.details.ifsc_code}` : ''}
                        </p>
                      )}
                      {m.type === 'upi' && m.details?.upi_id && (
                        <p className="text-sm text-white/60 mt-1 font-mono">{m.details.upi_id}</p>
                      )}
                      {m.type === 'qr' && m.qr_image_url && (
                        <img
                          src={uploadUrl(m.qr_image_url)}
                          alt=""
                          className="mt-2 h-20 w-20 object-contain rounded-lg border border-surface-border bg-white p-1"
                        />
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`text-xs font-bold ${m.is_active ? 'text-green-400' : 'text-white/40'}`}>
                        {m.is_active ? 'Active' : 'Inactive'}
                      </span>
                      {canManage && (
                        <>
                          <button type="button" onClick={() => toggleActive(m)} className="text-gold-light" title="Toggle active">
                            {m.is_active ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}
                          </button>
                          <button type="button" onClick={() => setDeleteTarget(m)} className="text-rose-400" title="Delete">
                            <Trash2 size={18} />
                          </button>
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </AdminPanel>

          {canManage && (
            <AdminPanel title="Add payment method" className="xl:sticky xl:top-4 xl:self-start">
              <form onSubmit={handleCreate} className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  {['bank', 'upi', 'qr'].map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setFormType(t)}
                      className={`px-3 py-2 rounded-lg text-xs font-bold border transition-colors ${
                        formType === t
                          ? 'border-gold/50 bg-gold/10 text-gold-light'
                          : 'border-surface-border text-white/60 hover:border-gold/25'
                      }`}
                    >
                      {TYPE_LABELS[t] || t}
                    </button>
                  ))}
                </div>

                {formType === 'bank' && (
                  <div className="space-y-3">
                    {[
                      ['bank_name', 'Bank name'],
                      ['account_holder_name', 'Account holder'],
                      ['account_number', 'Account number'],
                      ['ifsc_code', 'IFSC'],
                      ['branch', 'Branch (optional)'],
                    ].map(([key, label]) => (
                      <div key={key}>
                        <label className="text-xs text-white/50 uppercase">{label}</label>
                        <input
                          className="mt-1 w-full rounded-lg border border-surface-border bg-surface-dark px-3 py-2 text-white text-sm"
                          value={bank[key]}
                          onChange={(e) => setBank((b) => ({ ...b, [key]: e.target.value }))}
                          required={key !== 'branch'}
                        />
                      </div>
                    ))}
                  </div>
                )}

                {formType === 'upi' && (
                  <div className="space-y-3">
                    <div>
                      <label className="text-xs text-white/50 uppercase">UPI ID</label>
                      <input
                        className="mt-1 w-full rounded-lg border border-surface-border bg-surface-dark px-3 py-2 text-white text-sm font-mono"
                        value={upi.upi_id}
                        onChange={(e) => setUpi((u) => ({ ...u, upi_id: e.target.value }))}
                        required
                      />
                    </div>
                    <div>
                      <label className="text-xs text-white/50 uppercase">Display name</label>
                      <input
                        className="mt-1 w-full rounded-lg border border-surface-border bg-surface-dark px-3 py-2 text-white text-sm"
                        value={upi.display_name}
                        onChange={(e) => setUpi((u) => ({ ...u, display_name: e.target.value }))}
                        required
                      />
                    </div>
                  </div>
                )}

                {formType === 'qr' && (
                  <div className="space-y-3">
                    <div>
                      <label className="text-xs text-white/50 uppercase">Label</label>
                      <input
                        className="mt-1 w-full rounded-lg border border-surface-border bg-surface-dark px-3 py-2 text-white text-sm"
                        value={qr.label}
                        onChange={(e) => setQr({ label: e.target.value })}
                        required
                      />
                    </div>
                    <div>
                      <label className="text-xs text-white/50 uppercase">QR image</label>
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="mt-1 block w-full text-sm text-white/70 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-gold/15 file:text-gold-light file:text-xs file:font-bold"
                        onChange={(e) => setQrFile(e.target.files?.[0] || null)}
                        required
                      />
                    </div>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={saving}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gold/20 text-gold-light font-bold border border-gold/30 disabled:opacity-50"
                >
                  <Plus size={16} /> {saving ? 'Saving…' : 'Add method'}
                </button>
              </form>
            </AdminPanel>
          )}
        </div>
      )}

      <ConfirmModal
        open={!!deleteTarget}
        title="Delete payment method?"
        message={
          deleteTarget
            ? `Remove “${methodDisplayLabel(deleteTarget)}” (${TYPE_LABELS[deleteTarget.type] || deleteTarget.type})?${
                deleteTarget.is_active
                  ? ' It is currently active and shown to users on the INR deposit page.'
                  : ''
              } This cannot be undone.`
            : ''
        }
        confirmText="Delete"
        cancelText="Cancel"
        danger
        busy={deleteBusy}
        onClose={() => { if (!deleteBusy) setDeleteTarget(null); }}
        onConfirm={confirmDeleteMethod}
      />
    </div>
  );
}
