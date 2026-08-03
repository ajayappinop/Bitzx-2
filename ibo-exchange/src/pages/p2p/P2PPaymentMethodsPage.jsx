import { useEffect, useState } from 'react';
import {
  Plus, Pencil, Trash2, Loader2, AlertCircle,
  Smartphone, CreditCard, Building2, CheckCircle2, ShieldCheck, ShieldAlert,
} from 'lucide-react';
import { p2pApi } from '@/services/p2pApi';
import P2PModal from './P2PModal';

/* ── payment method definitions ──────────────────────────────────────── */
const PM_TYPES = ['UPI', 'IMPS', 'BANK', 'PAYTM', 'PHONEPE', 'GPAY'];

const PM_META = {
  UPI:     { icon: Smartphone,  color: '#22c55e', bg: 'rgba(34,197,94,0.1)',  border: 'rgba(34,197,94,0.25)',  label: 'UPI' },
  IMPS:    { icon: CreditCard,  color: '#0EA4AB', bg: 'rgba(14,164,171,0.1)', border: 'rgba(14,164,171,0.25)', label: 'IMPS' },
  BANK:    { icon: Building2,   color: '#0EA4AB', bg: 'rgba(167,139,250,0.1)',border: 'rgba(14,164,171,0.25)',label: 'Bank Transfer' },
  PAYTM:   { icon: Smartphone,  color: '#38bdf8', bg: 'rgba(56,189,248,0.1)', border: 'rgba(56,189,248,0.25)', label: 'Paytm' },
  PHONEPE: { icon: Smartphone,  color: '#818cf8', bg: 'rgba(129,140,248,0.1)',border: 'rgba(129,140,248,0.25)',label: 'PhonePe' },
  GPAY:    { icon: Smartphone,  color: '#fb923c', bg: 'rgba(251,146,60,0.1)', border: 'rgba(251,146,60,0.25)', label: 'Google Pay' },
};

const PM_FIELD_DEFS = {
  UPI:     [
    { key: 'display_name', label: 'Display Name', required: true,  placeholder: 'e.g. My SBI UPI' },
    { key: 'upi_id',       label: 'UPI ID',        required: true,  placeholder: 'yourname@bank', hint: 'Must contain @' },
    { key: 'holder_name',  label: 'Full Name',     required: false, placeholder: 'As registered (optional)' },
  ],
  IMPS:    [
    { key: 'display_name',    label: 'Display Name',    required: true,  placeholder: 'e.g. SBI IMPS' },
    { key: 'account_number',  label: 'Account Number',  required: true,  placeholder: '1234567890' },
    { key: 'ifsc',            label: 'IFSC Code',       required: true,  placeholder: 'SBIN0001234' },
    { key: 'holder_name',     label: 'Account Holder',  required: true,  placeholder: 'Full name as on account' },
    { key: 'bank_name',       label: 'Bank Name',       required: false, placeholder: 'e.g. State Bank of India' },
  ],
  BANK:    [
    { key: 'display_name',    label: 'Display Name',    required: true,  placeholder: 'e.g. HDFC Current' },
    { key: 'account_number',  label: 'Account Number',  required: true,  placeholder: '1234567890' },
    { key: 'ifsc',            label: 'IFSC Code',       required: true,  placeholder: 'HDFC0001234' },
    { key: 'holder_name',     label: 'Account Holder',  required: true,  placeholder: 'Full name as on account' },
    { key: 'bank_name',       label: 'Bank Name',       required: false, placeholder: 'e.g. HDFC Bank' },
  ],
  PAYTM:   [
    { key: 'display_name', label: 'Display Name',     required: true,  placeholder: 'e.g. My Paytm' },
    { key: 'upi_id',       label: 'Paytm UPI / Phone',required: true,  placeholder: '9876543210@paytm' },
    { key: 'holder_name',  label: 'Full Name',        required: false, placeholder: 'Name on Paytm (optional)' },
  ],
  PHONEPE: [
    { key: 'display_name', label: 'Display Name',        required: true,  placeholder: 'e.g. My PhonePe' },
    { key: 'upi_id',       label: 'PhonePe UPI / Phone', required: true,  placeholder: '9876543210@ybl' },
    { key: 'holder_name',  label: 'Full Name',           required: false, placeholder: 'Name on PhonePe (optional)' },
  ],
  GPAY:    [
    { key: 'display_name', label: 'Display Name',    required: true,  placeholder: 'e.g. My Google Pay' },
    { key: 'upi_id',       label: 'GPay UPI / Phone',required: true,  placeholder: '9876543210@okicici' },
    { key: 'holder_name',  label: 'Full Name',       required: false, placeholder: 'Name on Google Pay (optional)' },
  ],
};

const inp = 'w-full rounded-xl bg-[color:var(--ibo-elevated)] border border-[color:var(--ibo-border-solid)] px-3.5 py-2.5 text-[color:var(--ibo-ink)] text-sm placeholder:text-[color:var(--ibo-muted)] focus:outline-none focus:border-[rgba(91,184,255,0.55)] transition-colors';

export default function P2PPaymentMethodsPage() {
  const [methods, setMethods] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing]   = useState(null);
  const [pmType, setPmType]     = useState('UPI');
  const [form, setForm]         = useState({});
  const [formErrors, setFormErrors] = useState({});
  const [busy, setBusy]         = useState({});
  const [error, setError]       = useState('');

  const load = async () => {
    try { const d = await p2pApi.listPaymentMethods(); setMethods(d.payment_methods || []); }
    catch (e) { setError(e.message); }
  };
  useEffect(() => { load(); }, []);

  const b  = (k) => busy[k];
  const sb = (k, v) => setBusy((s) => ({ ...s, [k]: v }));

  const openAdd = () => {
    setEditing(null); setPmType('UPI'); setForm({ display_name: '', holder_name: '', upi_id: '' });
    setFormErrors({}); setShowForm(true);
  };
  const openEdit = (m) => {
    setEditing(m); setPmType(m.type);
    setForm({ display_name: m.display_name || '', holder_name: m.holder_name || '',
              upi_id: m.upi_id || '', account_number: m.account_number || '',
              ifsc: m.ifsc || '', bank_name: m.bank_name || '' });
    setFormErrors({}); setShowForm(true);
  };

  const handleTypeChange = (t) => {
    setPmType(t);
    setForm((f) => ({ display_name: f.display_name || '', holder_name: f.holder_name || '' }));
    setFormErrors({});
  };

  const validate = () => {
    const defs = PM_FIELD_DEFS[pmType] || [];
    const errs = {};
    defs.forEach(({ key, label, required, hint }) => {
      const val = (form[key] || '').trim();
      if (required && !val) { errs[key] = `${label} is required.`; return; }
      if (key === 'upi_id' && val && !val.includes('@')) { errs[key] = hint || 'Invalid UPI ID.'; }
      if (key === 'ifsc' && val && val.length !== 11) { errs[key] = 'IFSC must be exactly 11 characters.'; }
    });
    return errs;
  };

  const submit = async () => {
    const errs = validate();
    if (Object.keys(errs).length) { setFormErrors(errs); return; }
    sb('save', true); setFormErrors({});
    try {
      const payload = { type: pmType };
      (PM_FIELD_DEFS[pmType] || []).forEach(({ key }) => {
        const v = (form[key] || '').trim();
        if (v) payload[key] = v;
      });
      if (editing) await p2pApi.updatePaymentMethod(editing.pm_id, payload);
      else         await p2pApi.createPaymentMethod(payload);
      setShowForm(false); load();
    } catch (e) {
      const detail = e.detail || e.message;
      const msg = Array.isArray(detail) ? detail.map((d) => d.msg || JSON.stringify(d)).join(' · ') : String(detail);
      setFormErrors({ _global: msg });
    }
    finally { sb('save', false); }
  };

  const del = async (pmId) => {
    if (!window.confirm('Remove this payment method?')) return;
    sb(`del_${pmId}`, true);
    try { await p2pApi.deletePaymentMethod(pmId); load(); }
    catch (e) { alert(e.message); }
    finally { sb(`del_${pmId}`, false); }
  };

  return (
    <div className="ibo-page font-ui">
      <div className="w-full px-4 sm:px-5 md:px-6 lg:px-8 xl:px-10 2xl:px-12 py-6 sm:py-8 pb-16">

        <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-[color:var(--ibo-ink)] tracking-tight" style={{ fontFamily: "Inter, 'Plus Jakarta Sans', system-ui, sans-serif" }}>
              Payment Methods
            </h1>
            <p className="text-[color:var(--ibo-muted)] text-sm mt-1">Manage how you receive and send money in P2P trades.</p>
          </div>
          <button onClick={openAdd}
            className="ibo-hover-scale inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-[#050a1a]"
            style={{ background: 'linear-gradient(135deg,#0EA4AB,#5BB8FF)', boxShadow: '0 4px 20px rgba(14,164,171,0.3)' }}>
            <Plus size={15} /> Add Method
          </button>
        </div>

        {error && (
          <div className="flex items-center gap-2.5 rounded-xl border border-red-500/25 bg-red-500/10 p-3.5 text-red-400 text-sm mb-4">
            <AlertCircle size={14} className="shrink-0" />{error}
          </div>
        )}

        {/* Cards grid */}
        {methods === null ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={20} className="animate-spin text-[#0EA4AB]" />
          </div>
        ) : methods.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[color:var(--ibo-border-solid)] p-16 text-center">
            <div className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center"
              style={{ background: 'rgba(14,164,171,0.08)', border: '1px solid rgba(14,164,171,0.15)' }}>
              <CreditCard size={22} className="text-[#5BB8FF]/60" />
            </div>
            <p className="text-white/60 font-semibold text-sm">No payment methods yet</p>
            <p className="text-white/30 text-xs mt-1.5 mb-5">Add UPI, IMPS, or bank details to start trading.</p>
            <button onClick={openAdd}
              className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold text-[#050a1a]"
              style={{ background: 'linear-gradient(135deg,#0EA4AB,#5BB8FF)' }}>
              <Plus size={14} /> Add First Method
            </button>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {methods.map((m) => {
              const meta = PM_META[m.type] || PM_META.UPI;
              const Icon = meta.icon;
              return (
                <div key={m.pm_id}
                  className="ibo-hover-lift ibo-hover-glow rounded-2xl border p-5 space-y-3.5"
                  style={{ background: 'var(--ibo-card)', borderColor: 'var(--ibo-border-solid)' }}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                        style={{ background: meta.bg, border: `1px solid ${meta.border}` }}>
                        <Icon size={16} style={{ color: meta.color }} />
                      </div>
                      <div>
                        <p className="text-white font-bold text-sm">{m.display_name}</p>
                        <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
                          style={{ background: meta.bg, color: meta.color, border: `1px solid ${meta.border}` }}>
                          {meta.label}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button onClick={() => openEdit(m)} title="Edit"
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-white/35 hover:text-white transition-colors"
                        style={{ border: '1px solid var(--ibo-border-solid)', background: 'var(--ibo-card)' }}>
                        <Pencil size={12} />
                      </button>
                      <button onClick={() => del(m.pm_id)} disabled={b(`del_${m.pm_id}`)} title="Remove"
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-red-400/40 hover:text-red-400 transition-colors"
                        style={{ border: '1px solid rgba(239,68,68,0.15)', background: 'var(--ibo-card)' }}>
                        {b(`del_${m.pm_id}`) ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {m.upi_id         && <InfoRow label="UPI ID"      value={m.upi_id} mono />}
                    {m.account_number && <InfoRow label="Account"     value={`****${m.account_number.slice(-4)}`} mono />}
                    {m.ifsc           && <InfoRow label="IFSC"        value={m.ifsc} mono />}
                    {m.bank_name      && <InfoRow label="Bank"        value={m.bank_name} />}
                    {m.verified_account_name && (
                      <InfoRow label="Verified Name" value={m.verified_account_name} />
                    )}
                    {!m.verified_account_name && m.holder_name && (
                      <InfoRow label="Name" value={m.holder_name} />
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5 text-[10px] text-green-400 font-semibold">
                      <CheckCircle2 size={11} />Active
                    </div>
                    {['BANK', 'IMPS'].includes(m.type) && (
                      m.verified
                        ? (
                          <div className="flex items-center gap-1 text-[10px] font-bold text-emerald-400 px-2 py-0.5 rounded-full"
                            style={{ background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.25)' }}>
                            <ShieldCheck size={10} />Bank Verified
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 text-[10px] font-bold text-gold px-2 py-0.5 rounded-full"
                            style={{ background: 'rgba(197,227,91,0.1)', border: '1px solid rgba(197,227,91,0.25)' }}>
                            <ShieldAlert size={10} />Unverified
                          </div>
                        )
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Add/Edit modal ────────────────────────────────────────── */}
      {showForm && (
        <P2PModal title={editing ? 'Edit Payment Method' : 'Add Payment Method'} size="md" onClose={() => setShowForm(false)}>
          <P2PModal.Body>
            {/* Type selector */}
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-widest text-white/40 mb-2">Method Type</label>
              <div className="grid grid-cols-3 gap-2">
                {PM_TYPES.map((t) => {
                  const meta = PM_META[t];
                  const on   = pmType === t;
                  return (
                    <button key={t} type="button" onClick={() => handleTypeChange(t)}
                      className="py-2.5 rounded-xl text-xs font-bold transition-all"
                      style={on
                        ? { background: meta.bg, border: `1px solid ${meta.border}`, color: meta.color }
                        : { background: 'var(--ibo-elevated)', border: '1px solid var(--ibo-border-solid)', color: 'var(--ibo-muted)' }}>
                      {meta.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Fields */}
            {(PM_FIELD_DEFS[pmType] || []).map(({ key, label, required, placeholder }) => (
              <div key={key} className="space-y-1.5">
                <label className="block text-[10px] font-bold uppercase tracking-widest text-white/40">
                  {label}{required && <span className="text-red-400 ml-1">*</span>}
                </label>
                <input
                  value={form[key] || ''}
                  onChange={(e) => { setForm((f) => ({ ...f, [key]: e.target.value })); setFormErrors((fe) => ({ ...fe, [key]: '' })); }}
                  placeholder={placeholder}
                  className={`${inp} ${formErrors[key] ? 'border-red-500/50 focus:border-red-500/70' : ''}`}
                />
                {formErrors[key] && <p className="text-xs text-red-400">{formErrors[key]}</p>}
              </div>
            ))}

            {['BANK', 'IMPS'].includes(pmType) && !editing && (
              <div className="flex items-start gap-2.5 rounded-xl p-3 text-xs text-emerald-300/80"
                style={{ background: 'rgba(52,211,153,0.07)', border: '1px solid rgba(52,211,153,0.18)' }}>
                <ShieldCheck size={13} className="shrink-0 mt-0.5 text-emerald-400" />
                Your account number and IFSC will be verified with your bank before saving.
              </div>
            )}

            {formErrors._global && (
              <div className="flex items-start gap-2.5 rounded-xl p-3.5 text-red-400 text-sm"
                style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)' }}>
                <AlertCircle size={13} className="shrink-0 mt-0.5" />{formErrors._global}
              </div>
            )}
          </P2PModal.Body>
          <P2PModal.Footer>
            <button type="button" onClick={() => setShowForm(false)}
              className="px-4 py-2 rounded-xl text-sm font-semibold text-white/50 hover:text-white transition-colors"
              style={{ border: '1px solid var(--ibo-border-solid)' }}>
              Cancel
            </button>
            <button type="button" onClick={submit} disabled={b('save')}
              className="ibo-hover-scale inline-flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-bold text-[#050a1a] disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg,#0EA4AB,#5BB8FF)' }}>
              {b('save') && <Loader2 size={13} className="animate-spin" />}
              {b('save') && ['BANK', 'IMPS'].includes(pmType)
                ? 'Verifying Account…'
                : editing ? 'Save Changes' : 'Add Method'}
            </button>
          </P2PModal.Footer>
        </P2PModal>
      )}
    </div>
  );
}

function InfoRow({ label, value, mono }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[10px] text-white/30 uppercase tracking-wider font-semibold shrink-0">{label}</span>
      <span className={`text-xs text-white/70 truncate text-right ${mono ? 'font-mono' : 'font-medium'}`}>{value}</span>
    </div>
  );
}
