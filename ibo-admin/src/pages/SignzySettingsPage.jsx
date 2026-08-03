import { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, Building2, RefreshCw, Save, Info } from 'lucide-react';
import { adminFetch } from '@/lib/api';
import { useAdminAuth } from '@/context/AdminAuthContext';
import { hasPermission } from '@/lib/adminAccess';
import { AdminPageHeader, AdminPanel } from '@/components/AdminPrimitives';

// ── helpers ───────────────────────────────────────────────────────────────────

async function fetchControls() {
  const res = await adminFetch('/api/admin/platform-controls');
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || res.statusText);
  return res.json();
}

async function patchControls(updates) {
  const res = await adminFetch('/api/admin/platform-controls', {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || res.statusText);
  return res.json();
}

// ── mode option cards ─────────────────────────────────────────────────────────

function ModeCard({ value, selected, title, description, badge, color, onClick, disabled }) {
  const isActive = selected === value;
  const borderColor = isActive ? color : 'rgba(255,255,255,0.08)';
  const bg = isActive ? `${color}14` : 'rgba(255,255,255,0.03)';
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onClick(value)}
      className="text-left rounded-xl p-4 transition-all w-full disabled:opacity-40"
      style={{ border: `2px solid ${borderColor}`, background: bg }}
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-sm font-bold text-white">{title}</span>
        {badge && (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
            style={{ background: `${color}22`, color, border: `1px solid ${color}44` }}>
            {badge}
          </span>
        )}
        {isActive && (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
            style={{ background: `${color}22`, color, border: `1px solid ${color}44` }}>
            Active
          </span>
        )}
      </div>
      <p className="text-xs text-white/50 leading-relaxed">{description}</p>
    </button>
  );
}

// ── main component ─────────────────────────────────────────────────────────────

export default function SignzySettingsPage() {
  const { admin } = useAdminAuth();
  const canManage = hasPermission(admin, 'manage_settings');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [err, setErr]         = useState('');
  const [ok, setOk]           = useState('');

  const [kycMode,       setKycMode]       = useState('manual');
  const [bankVerifyMode, setBankVerifyMode] = useState('auto');

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const data = await fetchControls();
      setKycMode(data.kyc_mode || 'manual');
      setBankVerifyMode(data.bank_verify_mode || 'auto');
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true); setErr(''); setOk('');
    try {
      await patchControls({ kyc_mode: kycMode, bank_verify_mode: bankVerifyMode });
      setOk('Settings saved successfully.');
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 sm:p-8 max-w-4xl mx-auto space-y-8">
      <AdminPageHeader
        title="Signzy Verification Settings"
        subtitle="Control how KYC identity verification and bank account verification work."
        icon={ShieldCheck}
      >
        <button
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold text-white/60 hover:text-white transition-colors"
          style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.04)' }}
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </AdminPageHeader>

      {err && (
        <div className="rounded-xl px-4 py-3 text-sm text-red-300"
          style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)' }}>
          {err}
        </div>
      )}
      {ok && (
        <div className="rounded-xl px-4 py-3 text-sm text-emerald-300"
          style={{ background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.25)' }}>
          {ok}
        </div>
      )}

      {/* ── KYC mode ──────────────────────────────────────────────────── */}
      <AdminPanel>
        <div className="p-6 border-b border-white/[0.06]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{ background: 'rgba(167,139,250,0.1)', border: '1px solid rgba(167,139,250,0.2)' }}>
              <ShieldCheck size={16} className="text-violet-400" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">KYC Verification Mode</h3>
              <p className="text-xs text-white/45 mt-0.5">
                Controls how users complete their identity verification.
              </p>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-4">
          <div className="grid sm:grid-cols-3 gap-3">
            <ModeCard
              value="manual"
              selected={kycMode}
              title="Manual Review"
              description="Users upload ID + selfie, run Signzy face match, then submit for admin review."
              color="#0EA4AB"
              onClick={setKycMode}
              disabled={!canManage || loading}
            />
            <ModeCard
              value="auto"
              selected={kycMode}
              title="Auto — DigiLocker"
              badge="Signzy"
              description="Users verify via DigiLocker (Aadhaar-linked). Approval is instant and automatic."
              color="#22c55e"
              onClick={setKycMode}
              disabled={!canManage || loading}
            />
            <ModeCard
              value="disabled"
              selected={kycMode}
              title="Disabled"
              description="All KYC submissions are blocked. Users cannot start or continue verification."
              color="#ef4444"
              onClick={setKycMode}
              disabled={!canManage || loading}
            />
          </div>

          {kycMode === 'auto' && (
            <div className="flex items-start gap-2.5 rounded-xl px-4 py-3 text-xs text-violet-300"
              style={{ background: 'rgba(167,139,250,0.07)', border: '1px solid rgba(167,139,250,0.18)' }}>
              <Info size={13} className="shrink-0 mt-0.5 text-violet-400" />
              <span>
                Requires <strong>SIGNZY_API_KEY</strong>,&nbsp;
                <strong>SIGNZY_DIGILOCKER_CALLBACK_URL</strong>,&nbsp;
                <strong>SIGNZY_DIGILOCKER_SUCCESS_URL</strong>, and&nbsp;
                <strong>API_PUBLIC_URL</strong> in <code>backend/.env</code>.
                After DigiLocker, users upload a selfie and call <code>POST /api/kyc/face-match</code>
                (Signzy Face Match). If PAN is not linked in DigiLocker, users enter PAN and call{' '}
                <code>POST /api/kyc/pan/verify</code> (Signzy PAN Verify) before selfie.
                Set <strong>SIGNZY_FACE_MATCH_REQUIRED=false</strong> to skip selfie.
                Set <strong>SIGNZY_PAN_VERIFY_REQUIRED=false</strong> to skip PAN when not in DigiLocker.
              </span>
            </div>
          )}
        </div>
      </AdminPanel>

      {/* ── Bank verification mode ─────────────────────────────────────── */}
      <AdminPanel>
        <div className="p-6 border-b border-white/[0.06]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{ background: 'rgba(56,189,248,0.1)', border: '1px solid rgba(56,189,248,0.2)' }}>
              <Building2 size={16} className="text-sky-400" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Bank Account Verification Mode</h3>
              <p className="text-xs text-white/45 mt-0.5">
                Applied when users add bank details in P2P payment methods or INR withdrawal payout profiles.
              </p>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-4">
          <div className="grid sm:grid-cols-3 gap-3">
            <ModeCard
              value="auto"
              selected={bankVerifyMode}
              title="Auto — Penny Drop"
              badge="Signzy"
              description="Signzy hybrid bank verification API is called instantly when the user saves bank details."
              color="#22c55e"
              onClick={setBankVerifyMode}
              disabled={!canManage || loading}
            />
            <ModeCard
              value="manual"
              selected={bankVerifyMode}
              title="Manual Review"
              description="Bank details are saved as unverified. Admin or operations team verifies before processing payouts."
              color="#0EA4AB"
              onClick={setBankVerifyMode}
              disabled={!canManage || loading}
            />
            <ModeCard
              value="disabled"
              selected={bankVerifyMode}
              title="Disabled"
              description="No verification is performed. Bank details are accepted as-is (not recommended for production)."
              color="#ef4444"
              onClick={setBankVerifyMode}
              disabled={!canManage || loading}
            />
          </div>

          {bankVerifyMode === 'auto' && (
            <div className="flex items-start gap-2.5 rounded-xl px-4 py-3 text-xs text-sky-300"
              style={{ background: 'rgba(56,189,248,0.07)', border: '1px solid rgba(56,189,248,0.18)' }}>
              <Info size={13} className="shrink-0 mt-0.5 text-sky-400" />
              <span>
                Requires <strong>SIGNZY_API_KEY</strong> in <code>backend/.env</code>.&nbsp;
                Also set <strong>SIGNZY_VERIFY_REQUIRED</strong> to <code>false</code> if you want
                Signzy outages to silently degrade to unverified instead of blocking users.
              </span>
            </div>
          )}
          {bankVerifyMode === 'manual' && (
            <div className="flex items-start gap-2.5 rounded-xl px-4 py-3 text-xs text-gold-light"
              style={{ background: 'rgba(14,164,171,0.07)', border: '1px solid rgba(14,164,171,0.18)' }}>
              <Info size={13} className="shrink-0 mt-0.5 text-gold" />
              Bank details will be saved as <strong>unverified</strong>. Ensure your operations team
              manually verifies accounts before releasing INR payouts or allowing P2P trades.
            </div>
          )}
        </div>
      </AdminPanel>

      {/* ── Save ──────────────────────────────────────────────────────── */}
      {canManage && (
        <div className="flex justify-end">
          <button
            onClick={save}
            disabled={saving || loading}
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold text-[#05070d] disabled:opacity-40"
            style={{ background: 'linear-gradient(135deg,#0EA4AB,#C5E35B)' }}
          >
            <Save size={15} />
            {saving ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      )}
    </div>
  );
}
