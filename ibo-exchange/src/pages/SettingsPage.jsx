import { useState, useEffect, useCallback } from 'react';

import { useNavigate, Link } from 'react-router-dom';

import { motion, AnimatePresence } from 'framer-motion';

import {

  Shield, ShieldCheck, ShieldAlert, Smartphone, Activity,

  Trash2, Eye, EyeOff, Lock, X, CheckCircle2, AlertTriangle,

  Clock, Globe, LogOut, ChevronRight,

  ToggleLeft, ToggleRight, Fish, ArrowLeft,

} from 'lucide-react';

import { useAuth, authFetch } from '@/context/AuthContext';

import { exchangeApiOrigin } from '@/lib/apiBase';

import { getPasswordStrengthMeta, validateStrongPassword } from '@/lib/authValidation';



const API = exchangeApiOrigin(import.meta.env.VITE_BACKEND_URL);



// ── Shared UI primitives ──────────────────────────────────────────────────────



function Drawer({ open, onClose, title, children }) {

  useEffect(() => {

    if (!open) return;

    const onKey = (e) => { if (e.key === 'Escape') onClose(); };

    document.addEventListener('keydown', onKey);

    return () => document.removeEventListener('keydown', onKey);

  }, [open, onClose]);



  return (

    <AnimatePresence>

      {open && (

        <>

          <motion.div

            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}

            className="fixed inset-0 z-[79] bg-black/60 backdrop-blur-sm"

            onClick={onClose}

          />

          <motion.div

            initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}

            transition={{ type: 'spring', stiffness: 320, damping: 32 }}

            className="fixed right-0 top-0 bottom-0 z-[80] w-full max-w-lg

              bg-surface-dark border-l border-surface-border shadow-2xl overflow-y-auto"

          >

            <div className="flex items-center justify-between px-6 py-5 border-b border-surface-border sticky top-0 bg-surface-dark z-10">

              <h2 className="text-lg font-extrabold text-white">{title}</h2>

              <button type="button" onClick={onClose}

                className="p-1.5 rounded-lg text-white/50 hover:text-white hover:bg-white/[.08] transition-colors">

                <X size={18} />

              </button>

            </div>

            <div className="px-6 py-6">{children}</div>

          </motion.div>

        </>

      )}

    </AnimatePresence>

  );

}



function Tile({ icon: Icon, iconColor = 'text-gold-light', title, desc, badge, badgeColor, onClick, href, disabled }) {

  const inner = (

    <div

      className={`flex items-center gap-4 p-4 rounded-2xl border border-surface-border

        bg-surface-card transition-all group

        ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:border-gold/30 hover:bg-surface-hover cursor-pointer'}`}

      onClick={!disabled && !href ? onClick : undefined}

    >

      <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"

        style={{ background: 'rgba(254, 108, 2,0.1)', border: '1px solid rgba(254, 108, 2,0.2)' }}>

        <Icon size={18} className={iconColor} />

      </div>

      <div className="flex-1 min-w-0">

        <p className="text-sm font-bold text-white">{title}</p>

        {desc && <p className="text-xs text-white/55 mt-0.5 truncate">{desc}</p>}

      </div>

      {badge && (

        <span className={`text-[10px] font-extrabold uppercase tracking-wider px-2.5 py-1 rounded-full border flex-shrink-0 ${badgeColor || 'text-green-400 bg-green-400/10 border-green-400/25'}`}>

          {badge}

        </span>

      )}

      {!badge && !disabled && <ChevronRight size={16} className="text-white/30 group-hover:text-white/60 flex-shrink-0 transition-colors" />}

    </div>

  );

  if (href) return <Link to={href}>{inner}</Link>;

  return inner;

}



function FieldRow({ label, children }) {

  return (

    <div className="mb-4">

      <label className="block text-sm font-semibold text-white/80 mb-1.5">{label}</label>

      {children}

    </div>

  );

}



function TextInput({ value, onChange, type = 'text', placeholder, disabled, error, rightAddon }) {

  return (

    <div>

      <div className={`flex items-center bg-surface border rounded-xl px-4 py-3 transition-colors focus-within:border-gold/40

        ${error ? 'border-red-500/50' : 'border-surface-border'}`}>

        <input

          type={type}

          value={value}

          onChange={onChange}

          placeholder={placeholder}

          disabled={disabled}

          className="flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/35 disabled:opacity-50"

        />

        {rightAddon}

      </div>

      {error && <p className="text-xs text-red-400 mt-1">{error}</p>}

    </div>

  );

}



function Btn({ children, onClick, loading, disabled, variant = 'primary', className = '' }) {

  const base = 'w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm transition-all disabled:opacity-50';

  const styles = variant === 'danger'

    ? 'bg-red-500/15 border border-red-500/30 text-red-400 hover:bg-red-500/25'

    : variant === 'ghost'

    ? 'border border-surface-border text-white/60 hover:text-white hover:border-white/30'

    : 'bg-logo-gradient text-surface-dark hover:shadow-lg hover:shadow-gold/20';

  return (

    <button type="button" onClick={onClick} disabled={disabled || loading} className={`${base} ${styles} ${className}`}>

      {loading ? <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> : children}

    </button>

  );

}



function ErrorBox({ msg }) {

  if (!msg) return null;

  return (

    <div className="flex items-start gap-2.5 bg-red-500/10 border border-red-500/25 rounded-xl px-4 py-3 mb-4 text-sm text-red-400">

      <AlertTriangle size={15} className="flex-shrink-0 mt-0.5" /> {msg}

    </div>

  );

}



function SuccessBox({ msg }) {

  if (!msg) return null;

  return (

    <div className="flex items-start gap-2.5 bg-green-500/10 border border-green-500/25 rounded-xl px-4 py-3 mb-4 text-sm text-green-400">

      <CheckCircle2 size={15} className="flex-shrink-0 mt-0.5" /> {msg}

    </div>

  );

}



// ── Security Score ────────────────────────────────────────────────────────────



function SecurityScore({ user, twoFaEnabled }) {

  const checks = [

    { label: 'Email verified', ok: true },

    { label: '2FA enabled', ok: twoFaEnabled },

    { label: 'KYC verified', ok: user?.kyc_status === 'approved' },

    { label: 'Anti-phishing code', ok: Boolean(user?.anti_phishing_code) },

    { label: 'Safe session', ok: Boolean(user?.safe_session) },

    { label: 'Phone linked', ok: Boolean(user?.phone) },

  ];

  const score = Math.round((checks.filter(c => c.ok).length / checks.length) * 100);

  const color = score >= 80 ? '#22c55e' : score >= 50 ? '#FE6C02' : '#ef4444';

  const label = score >= 80 ? 'Strong' : score >= 50 ? 'Medium' : 'Weak';



  return (

    <div className="rounded-2xl border border-surface-border bg-surface-card p-5 mb-4">

      <div className="flex items-center justify-between mb-4">

        <div>

          <p className="text-xs font-extrabold uppercase tracking-wider text-white/50 mb-0.5">Security Score</p>

          <p className="text-2xl font-extrabold text-white">

            {score}%{' '}

            <span className="text-sm font-bold" style={{ color }}>{label}</span>

          </p>

        </div>

        <div className="w-14 h-14">

          <svg viewBox="0 0 48 48" className="w-full h-full -rotate-90">

            <circle cx="24" cy="24" r="20" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="5" />

            <circle cx="24" cy="24" r="20" fill="none" strokeWidth="5"

              stroke={color} strokeLinecap="round"

              strokeDasharray={`${(score / 100) * 125.7} 125.7`}

              style={{ transition: 'stroke-dasharray 0.6s ease' }}

            />

          </svg>

        </div>

      </div>

      <div className="grid grid-cols-2 gap-1.5">

        {checks.map(c => (

          <div key={c.label} className="flex items-center gap-1.5 text-xs">

            {c.ok

              ? <CheckCircle2 size={12} className="text-green-400 flex-shrink-0" />

              : <AlertTriangle size={12} className="text-white/25 flex-shrink-0" />}

            <span className={c.ok ? 'text-white/70' : 'text-white/30'}>{c.label}</span>

          </div>

        ))}

      </div>

    </div>

  );

}



// ── 2FA Panel ─────────────────────────────────────────────────────────────────

// Phases: idle → setup → verify → backups | idle → disable | idle → regen



function TwoFactorPanel({ open, onClose, user, onUserUpdate }) {

  // phase: idle | setup | verify | backups | disable | regen

  const [phase, setPhase] = useState('idle');

  const [setupData, setSetupData] = useState(null);



  // shared code input (TOTP or backup)

  const [code, setCode]       = useState('');

  // password only needed for disable

  const [disablePw, setDisablePw] = useState('');

  const [showDisablePw, setShowDisablePw] = useState(false);

  // regen needs a TOTP code

  const [regenCode, setRegenCode] = useState('');



  const [backupCodes, setBackupCodes] = useState([]);

  const [loading, setLoading]     = useState(false);

  const [error, setError]         = useState('');

  const [success, setSuccess]     = useState('');

  const enabled = Boolean(user?.two_factor_enabled);



  const reset = () => {

    setPhase('idle'); setCode(''); setDisablePw(''); setRegenCode('');

    setError(''); setSuccess(''); setSetupData(null);

  };



  // ── Start setup ─────────────────────────────────────────────────────────────

  const startSetup = async () => {

    setLoading(true); setError('');

    try {

      const res  = await authFetch(`${API}/api/auth/2fa/setup`, { method: 'POST' });

      const data = await res.json();

      if (!res.ok) throw new Error(data.detail || 'Setup failed');

      setSetupData(data);   // data.secret_b32, data.otpauth_url, data.issuer

      setCode('');

      setPhase('setup');

    } catch (e) { setError(e.message); }

    finally { setLoading(false); }

  };



  // ── Verify TOTP code after scanning QR ─────────────────────────────────────

  const verifySetup = async () => {

    if (code.length < 6) { setError('Enter the 6-digit code from your authenticator app.'); return; }

    setLoading(true); setError('');

    try {

      const res  = await authFetch(`${API}/api/auth/2fa/verify`, { method: 'POST', body: { code } });

      const data = await res.json();

      if (!res.ok) throw new Error(data.detail || 'Verification failed');

      setBackupCodes(data.backup_codes || []);

      onUserUpdate({ two_factor_enabled: true });

      setPhase('backups');

    } catch (e) { setError(e.message); }

    finally { setLoading(false); }

  };



  // ── Disable 2FA — backend requires password + TOTP code ────────────────────

  const disable2fa = async () => {

    if (!disablePw) { setError('Enter your account password.'); return; }

    if (code.length < 6) { setError('Enter your current 6-digit TOTP code.'); return; }

    setLoading(true); setError('');

    try {

      const res  = await authFetch(`${API}/api/auth/2fa/disable`, {

        method: 'POST',

        body: { password: disablePw, code },

      });

      const data = await res.json();

      if (!res.ok) throw new Error(data.detail || 'Disable failed');

      onUserUpdate({ two_factor_enabled: false });

      setSuccess('2FA has been disabled.');

      setPhase('idle');

    } catch (e) { setError(e.message); }

    finally { setLoading(false); }

  };



  // ── Regenerate backup codes — backend requires TOTP code ───────────────────

  const regenBackups = async () => {

    if (regenCode.length < 6) { setError('Enter your current 6-digit TOTP code to regenerate backup codes.'); return; }

    setLoading(true); setError('');

    try {

      const res  = await authFetch(`${API}/api/auth/2fa/backup-codes/regenerate`, {

        method: 'POST',

        body: { code: regenCode },

      });

      const data = await res.json();

      if (!res.ok) throw new Error(data.detail || 'Regeneration failed');

      setBackupCodes(data.backup_codes || []);

      setPhase('backups');

    } catch (e) { setError(e.message); }

    finally { setLoading(false); }

  };



  return (

    <Drawer open={open} onClose={() => { reset(); onClose(); }} title="Two-Factor Authentication">

      <ErrorBox msg={error} />

      <SuccessBox msg={success} />



      {/* ── Idle state ── */}

      {phase === 'idle' && (

        <>

          <div className={`flex items-center gap-3 mb-6 p-4 rounded-xl border

            ${enabled ? 'border-green-500/25 bg-green-500/[.06]' : 'border-gold/25 bg-gold/[.06]'}`}>

            {enabled

              ? <ShieldCheck size={22} className="text-green-400 flex-shrink-0" />

              : <ShieldAlert size={22} className="text-gold flex-shrink-0" />}

            <div>

              <p className="text-sm font-bold text-white">{enabled ? '2FA is enabled' : '2FA is disabled'}</p>

              <p className="text-xs text-white/50 mt-0.5">

                {enabled ? 'Your account is protected with TOTP authenticator' : 'Enable for extra account protection'}

              </p>

            </div>

          </div>

          {enabled ? (

            <div className="space-y-3">

              <Btn onClick={() => { setCode(''); setDisablePw(''); setError(''); setPhase('disable'); }} variant="danger">

                Disable 2FA

              </Btn>

              <Btn onClick={() => { setRegenCode(''); setError(''); setPhase('regen'); }} variant="ghost">

                Regenerate Backup Codes

              </Btn>

            </div>

          ) : (

            <Btn onClick={startSetup} loading={loading}>Enable 2FA</Btn>

          )}

        </>

      )}



      {/* ── QR scan + manual key ── */}

      {phase === 'setup' && setupData && (

        <>

          <p className="text-sm text-white/70 mb-4 leading-relaxed">

            Scan the QR code with your authenticator app (Google Authenticator, Authy, 1Password, etc.)

          </p>

          <div className="flex justify-center mb-4">

            <div className="bg-white p-3 rounded-xl inline-block">

              <img

                src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(setupData.otpauth_url || '')}`}

                alt="2FA QR Code" width={180} height={180}

              />

            </div>

          </div>

          {/* Manual key — backend returns secret_b32 */}

          {setupData.secret_b32 && (

            <div className="mb-4 p-3 rounded-xl bg-surface-card border border-surface-border">

              <p className="text-xs text-white/50 mb-1">Can't scan? Enter this key manually:</p>

              <p className="font-mono text-sm text-gold-light break-all select-all">{setupData.secret_b32}</p>

            </div>

          )}

          <FieldRow label="Enter 6-digit code from your app">

            <TextInput

              value={code}

              onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}

              placeholder="000000"

            />

          </FieldRow>

          <div className="space-y-2">

            <Btn onClick={verifySetup} loading={loading} disabled={code.length < 6}>Verify & Enable</Btn>

            <Btn onClick={reset} variant="ghost">Cancel</Btn>

          </div>

        </>

      )}



      {/* ── Backup codes display ── */}

      {phase === 'backups' && (

        <>

          <div className="mb-4 p-4 rounded-xl bg-gold/10 border border-gold/25">

            <p className="text-sm font-bold text-gold mb-1">Save your backup codes</p>

            <p className="text-xs text-gold/80 leading-relaxed">

              Each code can be used once if you lose access to your authenticator app. Store them somewhere safe.

            </p>

          </div>

          <div className="grid grid-cols-2 gap-2 mb-5">

            {backupCodes.map((c, i) => (

              <div key={i}

                className="font-mono text-xs bg-surface-card border border-surface-border rounded-lg px-3 py-2.5 text-white/80 select-all text-center">

                {c}

              </div>

            ))}

          </div>

          <Btn onClick={() => { reset(); setSuccess('2FA configured. Keep backup codes safe!'); }}>Done</Btn>

        </>

      )}



      {/* ── Disable 2FA — requires password + TOTP code ── */}

      {phase === 'disable' && (

        <>

          <div className="mb-5 p-4 rounded-xl bg-red-500/10 border border-red-500/25">

            <p className="text-sm font-bold text-red-400 mb-1">Disable Two-Factor Authentication</p>

            <p className="text-xs text-red-400/80">For security, disabling 2FA requires both your password and your current authenticator code.</p>

          </div>

          <FieldRow label="Account password">

            <TextInput

              type={showDisablePw ? 'text' : 'password'}

              value={disablePw}

              onChange={e => setDisablePw(e.target.value)}

              placeholder="Your account password"

              rightAddon={

                <button type="button" onClick={() => setShowDisablePw(v => !v)} className="text-white/50 hover:text-white ml-2">

                  {showDisablePw ? <EyeOff size={15} /> : <Eye size={15} />}

                </button>

              }

            />

          </FieldRow>

          <FieldRow label="Current 6-digit authenticator code">

            <TextInput

              value={code}

              onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}

              placeholder="000000"

            />

          </FieldRow>

          <div className="space-y-2">

            <Btn

              onClick={disable2fa}

              loading={loading}

              disabled={!disablePw || code.length < 6}

              variant="danger"

            >

              Confirm Disable 2FA

            </Btn>

            <Btn onClick={reset} variant="ghost">Cancel</Btn>

          </div>

        </>

      )}



      {/* ── Regenerate backup codes — requires TOTP code ── */}

      {phase === 'regen' && (

        <>

          <div className="mb-5 p-4 rounded-xl bg-surface-card border border-surface-border">

            <p className="text-sm font-bold text-white mb-1">Regenerate Backup Codes</p>

            <p className="text-xs text-white/55 leading-relaxed">

              All previous backup codes will be invalidated. You'll receive 10 fresh codes.

              Enter your current authenticator code to confirm.

            </p>

          </div>

          <FieldRow label="Current 6-digit authenticator code">

            <TextInput

              value={regenCode}

              onChange={e => setRegenCode(e.target.value.replace(/\D/g, '').slice(0, 6))}

              placeholder="000000"

            />

          </FieldRow>

          <div className="space-y-2">

            <Btn onClick={regenBackups} loading={loading} disabled={regenCode.length < 6}>

              Generate New Codes

            </Btn>

            <Btn onClick={reset} variant="ghost">Cancel</Btn>

          </div>

        </>

      )}

    </Drawer>

  );

}



// ── Account Activity Panel ────────────────────────────────────────────────────



function AccountActivityPanel({ open, onClose }) {

  const [data, setData]           = useState(null);

  const [loading, setLoading]     = useState(false);

  const [error, setError]         = useState('');

  const [logoutLoading, setLogoutLoading] = useState(false);

  const { revokeAllSessions }     = useAuth();

  const navigate                  = useNavigate();



  const load = useCallback(() => {

    setLoading(true); setError('');

    authFetch(`${API}/api/auth/account-activity`)

      .then(r => r.json())

      .then(d => setData(d))

      .catch(e => setError(e.message))

      .finally(() => setLoading(false));

  }, []);



  useEffect(() => { if (open) load(); }, [open, load]);



  const handleLogoutAll = async () => {

    setLogoutLoading(true);

    try {

      await revokeAllSessions();

      navigate('/login');

    } catch (e) { setError(e.message); setLogoutLoading(false); }

  };



  const fmt = (s) => {

    if (!s) return '—';

    try { return new Date(s).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); } catch { return s; }

  };



  return (

    <Drawer open={open} onClose={onClose} title="Account Activity">

      <ErrorBox msg={error} />



      {loading && (

        <div className="flex flex-col items-center justify-center py-12 gap-3">

          <div className="w-6 h-6 border-2 border-gold border-t-transparent rounded-full animate-spin" />

          <p className="text-sm text-white/40">Loading activity…</p>

        </div>

      )}



      {!loading && data && (

        <>

          {/* Active Sessions */}

          <div className="mb-7">

            <div className="flex items-center justify-between mb-3">

              <p className="text-xs font-extrabold uppercase tracking-wider text-white/50">

                Active Sessions ({data.sessions?.length ?? 0})

              </p>

              <button

                type="button"

                onClick={handleLogoutAll}

                disabled={logoutLoading}

                className="flex items-center gap-1.5 text-xs font-bold text-red-400 hover:text-red-300

                  border border-red-500/25 rounded-lg px-3 py-1.5 hover:bg-red-500/10 transition-colors disabled:opacity-50"

              >

                {logoutLoading

                  ? <div className="w-3 h-3 border-2 border-red-400 border-t-transparent rounded-full animate-spin" />

                  : <LogOut size={12} />}

                Log Out All

              </button>

            </div>

            {!data.sessions?.length

              ? <p className="text-xs text-white/35 py-4 text-center">No active sessions found.</p>

              : (

                <div className="space-y-2">

                  {data.sessions.map((s, i) => (

                    <div key={i} className="p-3 rounded-xl border border-surface-border bg-surface-card">

                      <div className="flex items-center gap-2 mb-1">

                        <Globe size={13} className="text-gold-light flex-shrink-0" />

                        <span className="text-xs font-bold text-white flex-1">Session active</span>

                        <span className="text-[10px] text-white/30 font-mono">{(s.jti || '').slice(-8)}</span>

                      </div>

                      <p className="text-[11px] text-white/45 ml-5">Started: {fmt(s.created_at)}</p>

                      <p className="text-[11px] text-white/30 ml-5">Expires: {fmt(s.expires_at)}</p>

                    </div>

                  ))}

                </div>

              )}

          </div>



          {/* Login History */}

          <div>

            <div className="flex items-center justify-between mb-3">

              <p className="text-xs font-extrabold uppercase tracking-wider text-white/50">

                Recent Login History

              </p>

              <button type="button" onClick={load} className="text-xs text-white/40 hover:text-white/70 flex items-center gap-1">

                <Clock size={11} /> Refresh

              </button>

            </div>

            {!data.login_history?.length

              ? <p className="text-xs text-white/35 py-4 text-center">No login history available.</p>

              : (

                <div className="space-y-2">

                  {data.login_history.map((l, i) => (

                    <div key={i} className="flex items-start gap-3 p-3 rounded-xl border border-surface-border bg-surface-card">

                      {l.success

                        ? <CheckCircle2 size={14} className="text-green-400 flex-shrink-0 mt-0.5" />

                        : <AlertTriangle size={14} className="text-red-400 flex-shrink-0 mt-0.5" />}

                      <div className="flex-1 min-w-0">

                        <p className="text-xs font-bold text-white">

                          {l.success ? 'Successful login' : `Failed — ${l.reason || 'unknown'}`}

                        </p>

                        <p className="text-[11px] text-white/40 mt-0.5 truncate">

                          {l.ip} · {fmt(l.created_at)}

                        </p>

                      </div>

                    </div>

                  ))}

                </div>

              )}

          </div>

        </>

      )}

    </Drawer>

  );

}



// ── Change Password Panel ─────────────────────────────────────────────────────



function PasswordPanel({ open, onClose }) {

  const [currentPw, setCurrentPw] = useState('');

  const [newPw, setNewPw]         = useState('');

  const [confirmPw, setConfirmPw] = useState('');

  const [showCurrent, setShowCurrent] = useState(false);

  const [showNew, setShowNew]     = useState(false);

  const [loading, setLoading]     = useState(false);

  const [error, setError]         = useState('');

  const [success, setSuccess]     = useState('');





  const strengthMeta = getPasswordStrengthMeta(newPw);



  const reset = () => {

    setCurrentPw(''); setNewPw(''); setConfirmPw('');

    setError(''); setSuccess('');

  };



  const handleSubmit = async () => {

    if (!currentPw) { setError('Enter your current password.'); return; }

    const pwErr = validateStrongPassword(newPw);

    if (pwErr) { setError(pwErr); return; }

    if (newPw !== confirmPw) { setError('New passwords do not match.'); return; }

    setLoading(true); setError('');

    try {

      // Backend: PUT /api/auth/password → { current_password, new_password }

      // Returns: { ok, message, access_token, refresh_token }

      const res  = await authFetch(`${API}/api/auth/password`, {

        method: 'PUT',

        body: { current_password: currentPw, new_password: newPw },

      });

      const data = await res.json();

      if (!res.ok) throw new Error(data.detail || 'Password change failed');



      // Update stored tokens so current session stays alive

      if (data.access_token) {

        localStorage.setItem('ibo_ex_token', data.access_token);

      }

      if (data.refresh_token) {

        localStorage.setItem('ibo_ex_refresh', data.refresh_token);

      }

      setSuccess('Password updated successfully!');

      reset();

    } catch (e) { setError(e.message); }

    finally { setLoading(false); }

  };



  return (

    <Drawer open={open} onClose={() => { reset(); onClose(); }} title="Change Password">

      <ErrorBox msg={error} />

      <SuccessBox msg={success} />



      <FieldRow label="Current Password">

        <TextInput

          type={showCurrent ? 'text' : 'password'}

          value={currentPw}

          onChange={e => setCurrentPw(e.target.value)}

          placeholder="Your current password"

          rightAddon={

            <button type="button" onClick={() => setShowCurrent(v => !v)} className="text-white/50 hover:text-white ml-2">

              {showCurrent ? <EyeOff size={15} /> : <Eye size={15} />}

            </button>

          }

        />

      </FieldRow>



      <FieldRow label="New Password">

        <TextInput

          type={showNew ? 'text' : 'password'}

          value={newPw}

          onChange={e => setNewPw(e.target.value)}

          placeholder="8+ chars: upper, lower, number, symbol"

          rightAddon={

            <button type="button" onClick={() => setShowNew(v => !v)} className="text-white/50 hover:text-white ml-2">

              {showNew ? <EyeOff size={15} /> : <Eye size={15} />}

            </button>

          }

        />

        {newPw && (

          <div className="flex items-center gap-2 mt-2">

            <div className="flex gap-1 flex-1">

              {[1, 2, 3, 4].map(l => (

                <div key={l} className="flex-1 h-1 rounded-full transition-all"

                  style={{ background: strengthMeta.score >= l ? strengthMeta.color : 'rgba(255,255,255,0.07)' }} />

              ))}

            </div>

            {strengthMeta.label && (

              <span className="text-xs font-bold whitespace-nowrap" style={{ color: strengthMeta.color }}>

                {strengthMeta.label}

              </span>

            )}

          </div>

        )}

      </FieldRow>



      <FieldRow label="Confirm New Password">

        <TextInput

          type="password"

          value={confirmPw}

          onChange={e => setConfirmPw(e.target.value)}

          placeholder="Repeat new password"

          error={confirmPw && confirmPw !== newPw ? 'Passwords do not match' : ''}

        />

      </FieldRow>



      <p className="text-xs text-white/40 mb-4 leading-relaxed">

        Changing your password will invalidate all other active sessions but keep this one alive.

      </p>



      <Btn onClick={handleSubmit} loading={loading} disabled={!currentPw || !newPw || !confirmPw}>

        <Lock size={15} /> Update Password

      </Btn>

    </Drawer>

  );

}



// ── Anti-Phishing Code Panel ──────────────────────────────────────────────────



function AntiPhishingPanel({ open, onClose, user, onUserUpdate }) {

  const [code, setCode]       = useState('');

  const [loading, setLoading] = useState(false);

  const [error, setError]     = useState('');

  const [success, setSuccess] = useState('');



  useEffect(() => {

    if (open) {

      setCode(user?.anti_phishing_code || '');

      setError(''); setSuccess('');

    }

  }, [open, user?.anti_phishing_code]);



  const handleSave = async () => {

    const trimmed = code.trim();

    if (trimmed.length < 4) { setError('Code must be at least 4 characters.'); return; }

    setLoading(true); setError('');

    try {

      const res  = await authFetch(`${API}/api/auth/anti-phishing-code`, {

        method: 'POST', body: { code: trimmed },

      });

      const data = await res.json();

      if (!res.ok) throw new Error(data.detail || 'Failed to save code');

      onUserUpdate({ anti_phishing_code: trimmed });

      setSuccess('Anti-phishing code saved.');

    } catch (e) { setError(e.message); }

    finally { setLoading(false); }

  };



  const handleClear = async () => {

    setLoading(true); setError('');

    try {

      const res  = await authFetch(`${API}/api/auth/anti-phishing-code`, {

        method: 'POST', body: { code: '' }, // empty string → backend clears it

      });

      const data = await res.json();

      if (!res.ok) throw new Error(data.detail || 'Failed');

      onUserUpdate({ anti_phishing_code: null });

      setCode('');

      setSuccess('Anti-phishing code cleared.');

    } catch (e) { setError(e.message); }

    finally { setLoading(false); }

  };



  return (

    <Drawer open={open} onClose={onClose} title="Anti-Phishing Code">

      <div className="mb-5 p-4 rounded-xl bg-surface-card border border-surface-border">

        <div className="flex items-center gap-2 mb-2">

          <Fish size={15} className="text-gold-light flex-shrink-0" />

          <p className="text-sm font-bold text-white">What is an anti-phishing code?</p>

        </div>

        <p className="text-xs text-white/60 leading-relaxed">

          This unique code will appear in every official email from Delta. If you receive

          an email without your code — or with the wrong code — treat it as a phishing attempt.

        </p>

      </div>



      {user?.anti_phishing_code && (

        <div className="mb-4 p-3 rounded-xl bg-gold/10 border border-gold/25 flex items-center gap-2">

          <CheckCircle2 size={14} className="text-gold-light flex-shrink-0" />

          <div>

            <p className="text-xs text-white/50">Current code</p>

            <p className="text-sm font-bold text-gold-light font-mono">{user.anti_phishing_code}</p>

          </div>

        </div>

      )}



      <ErrorBox msg={error} />

      <SuccessBox msg={success} />



      <FieldRow label="Your anti-phishing code (4–24 characters)">

        <TextInput

          value={code}

          onChange={e => setCode(e.target.value.slice(0, 24))}

          placeholder="e.g. MySecretWord42"

        />

        <p className="text-xs text-white/35 mt-1">Letters, numbers and symbols are all fine.</p>

      </FieldRow>



      <div className="space-y-2">

        <Btn onClick={handleSave} loading={loading} disabled={code.trim().length < 4}>

          Save Code

        </Btn>

        {user?.anti_phishing_code && (

          <Btn onClick={handleClear} loading={loading} variant="ghost">

            Clear Code

          </Btn>

        )}

      </div>

    </Drawer>

  );

}



// ── Delete Account Panel ──────────────────────────────────────────────────────



function DeleteAccountPanel({ open, onClose, user, onUserUpdate }) {

  const [password, setPassword] = useState('');

  const [reason, setReason]     = useState('');

  const [showPw, setShowPw]     = useState(false);

  const [loading, setLoading]   = useState(false);

  const [error, setError]       = useState('');

  const [success, setSuccess]   = useState('');

  const isPending               = Boolean(user?.pending_deletion);



  const reset = () => { setPassword(''); setReason(''); setError(''); setSuccess(''); };



  const handleDelete = async () => {

    if (!password) { setError('Password is required to confirm deletion.'); return; }

    setLoading(true); setError('');

    try {

      const body = { password };

      if (reason.trim()) body.reason = reason.trim();

      const res  = await authFetch(`${API}/api/auth/account/delete`, { method: 'POST', body });

      const data = await res.json();

      if (!res.ok) throw new Error(data.detail || 'Request failed');

      onUserUpdate({ pending_deletion: true });

      setSuccess('Account deletion scheduled. You can cancel within 24 hours.');

      reset();

    } catch (e) { setError(e.message); }

    finally { setLoading(false); }

  };



  const handleCancel = async () => {

    setLoading(true); setError('');

    try {

      const res  = await authFetch(`${API}/api/auth/account/cancel-deletion`, { method: 'POST' });

      const data = await res.json();

      if (!res.ok) throw new Error(data.detail || 'Failed to cancel');

      onUserUpdate({ pending_deletion: false });

      setSuccess('Account deletion cancelled. Your account is safe.');

    } catch (e) { setError(e.message); }

    finally { setLoading(false); }

  };



  return (

    <Drawer open={open} onClose={() => { reset(); onClose(); }} title="Delete Account">

      <ErrorBox msg={error} />

      <SuccessBox msg={success} />



      {isPending ? (

        <div className="text-center py-4">

          <div className="w-16 h-16 rounded-full bg-gold/10 border border-gold/25

            flex items-center justify-center mx-auto mb-4">

            <Clock size={26} className="text-gold" />

          </div>

          <p className="text-base font-bold text-white mb-2">Deletion Request Pending</p>

          <p className="text-sm text-white/55 mb-7 leading-relaxed">

            Your account is scheduled for deletion. You can cancel this request to keep your account.

          </p>

          <Btn onClick={handleCancel} loading={loading}>

            Cancel Deletion Request

          </Btn>

        </div>

      ) : (

        <>

          <div className="mb-5 p-4 rounded-xl bg-red-500/10 border border-red-500/25">

            <p className="text-sm font-bold text-red-400 mb-1.5">⚠ This action is irreversible</p>

            <p className="text-xs text-red-400/80 leading-relaxed">

              All your data, wallets, trade history and referrals will be permanently deleted.

              Please withdraw all funds before proceeding.

            </p>

          </div>



          <FieldRow label="Confirm with your password">

            <TextInput

              type={showPw ? 'text' : 'password'}

              value={password}

              onChange={e => setPassword(e.target.value)}

              placeholder="Enter your current password"

              rightAddon={

                <button type="button" onClick={() => setShowPw(v => !v)} className="text-white/50 hover:text-white ml-2">

                  {showPw ? <EyeOff size={15} /> : <Eye size={15} />}

                </button>

              }

            />

          </FieldRow>



          <FieldRow label="Reason for leaving (optional)">

            <TextInput

              value={reason}

              onChange={e => setReason(e.target.value)}

              placeholder="Why are you leaving?"

            />

          </FieldRow>



          <Btn

            onClick={handleDelete}

            loading={loading}

            disabled={!password}

            variant="danger"

          >

            <Trash2 size={15} /> Request Account Deletion

          </Btn>

        </>

      )}

    </Drawer>

  );

}



// ── Main Settings Page ────────────────────────────────────────────────────────



export default function SettingsPage() {

  const { user, updateUser } = useAuth();

  const navigate             = useNavigate();



  const [drawer, setDrawer]                 = useState(null);

  const [safeSessionLoading, setSafeSesLoading] = useState(false);

  const [safeSessionError, setSafeSesError] = useState('');



  const onUserUpdate = useCallback((patch) => updateUser(patch), [updateUser]);



  const twoFaEnabled = Boolean(user?.two_factor_enabled);

  const safeSession  = Boolean(user?.safe_session);

  const kycStatus    = user?.kyc_status || 'unverified';



  const kycBadge = kycStatus === 'approved'

    ? { label: 'Verified',     color: 'text-green-400 bg-green-400/10 border-green-400/25' }

    : kycStatus === 'pending'

    ? { label: 'Under Review', color: 'text-gold bg-gold/10 border-gold/25' }

    : kycStatus === 'rejected'

    ? { label: 'Rejected',     color: 'text-red-400 bg-red-400/10 border-red-400/25' }

    : { label: 'Not Started',  color: 'text-white/40 bg-white/[.04] border-white/10' };



  const toggleSafeSession = async () => {

    setSafeSesLoading(true); setSafeSesError('');

    try {

      const res  = await authFetch(`${API}/api/auth/safe-session`, {

        method: 'POST', body: { enabled: !safeSession },

      });

      const data = await res.json();

      if (!res.ok) throw new Error(data.detail || 'Failed');

      updateUser({ safe_session: data.safe_session });

    } catch (e) { setSafeSesError(e.message); }

    finally { setSafeSesLoading(false); }

  };



  if (!user) {

    return (

      <div className="ibo-page flex items-center justify-center">

        <div className="w-8 h-8 border-2 border-gold border-t-transparent rounded-full animate-spin" />

      </div>

    );

  }



  return (

    <div className="ibo-page">

      <div className="w-full px-4 sm:px-5 md:px-6 lg:px-8 xl:px-10 2xl:px-12 py-6 sm:py-8">



        {/* ── Header ─────────────────────────────────────────────── */}

        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mb-7">

          <div className="flex items-center gap-3">

            <button

              type="button"

              onClick={() => navigate(-1)}

              className="p-2 rounded-xl border border-surface-border text-white/60

                hover:text-white hover:border-white/30 transition-colors flex-shrink-0"

            >

              <ArrowLeft size={18} />

            </button>

            <div>

              <p className="ibo-eyebrow mb-1">Account</p>

              <h1 className="font-display text-2xl sm:text-3xl font-bold text-white tracking-tight flex items-center gap-2.5">

                <Shield className="text-[#FE6C02] flex-shrink-0" size={22} />

                Security &amp; Settings

              </h1>

              <p className="text-zinc-400 text-sm mt-1">Manage your account security and preferences</p>

            </div>

          </div>

        </motion.div>



        {/* ── Layout: score+KYC left, tiles right on xl ──────────── */}

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 xl:gap-8 items-start">



          {/* ── Left column ── */}

          <div className="xl:col-span-1 space-y-4">

            <SecurityScore user={user} twoFaEnabled={twoFaEnabled} />



            {/* KYC card */}

            <div className="rounded-2xl border border-surface-border bg-surface-card overflow-hidden">

              <div className="px-5 py-3.5 border-b border-surface-border flex items-center justify-between">

                <p className="text-xs font-extrabold uppercase tracking-wider text-white/50">Identity Verification</p>

                <span className={`text-[10px] font-extrabold uppercase tracking-wider px-2.5 py-1 rounded-full border ${kycBadge.color}`}>

                  {kycBadge.label}

                </span>

              </div>

              <div className="p-5">

                <div className="flex items-center gap-3 mb-4">

                  <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"

                    style={{ background: 'rgba(254, 108, 2,0.1)', border: '1px solid rgba(254, 108, 2,0.2)' }}>

                    <ShieldCheck size={18} className={kycStatus === 'approved' ? 'text-green-400' : 'text-gold-light'} />

                  </div>

                  <div>

                    <p className="text-sm font-bold text-white">KYC Verification</p>

                    <p className="text-xs text-white/50">Required for full trading access</p>

                  </div>

                </div>

                <Link

                  to="/kyc"

                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-bold text-sm

                    bg-logo-gradient text-surface-dark

                    hover:shadow-lg hover:shadow-gold/20 hover:scale-[1.01] transition-all"

                >

                  {kycStatus === 'approved' ? 'View KYC Status' : 'Complete KYC'}

                  <ChevronRight size={15} />

                </Link>

              </div>

            </div>



            {/* Safe Session — in left column on desktop */}

            <div className={`hidden xl:flex items-center gap-4 p-4 rounded-2xl border border-surface-border

              bg-surface-card hover:border-gold/30 hover:bg-surface-hover transition-all

              ${safeSessionLoading ? 'opacity-60' : ''}`}

            >

              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"

                style={{ background: 'rgba(254, 108, 2,0.1)', border: '1px solid rgba(254, 108, 2,0.2)' }}>

                <Shield size={18} className="text-gold-light" />

              </div>

              <div className="flex-1 min-w-0">

                <p className="text-sm font-bold text-white">Safe Session</p>

                <p className="text-xs text-white/55 mt-0.5">Extra re-auth for sensitive actions</p>

                {safeSessionError && <p className="text-xs text-red-400 mt-0.5">{safeSessionError}</p>}

              </div>

              <button

                type="button"

                onClick={toggleSafeSession}

                disabled={safeSessionLoading}

                className="flex-shrink-0 disabled:opacity-50 transition-opacity"

                aria-label="Toggle safe session"

              >

                {safeSession

                  ? <ToggleRight size={34} className="text-gold-light" />

                  : <ToggleLeft size={34} className="text-white/30" />}

              </button>

            </div>

          </div>



          {/* ── Right column — main tiles ── */}

          <div className="xl:col-span-2 space-y-3">

            <p className="text-xs font-extrabold uppercase tracking-wider text-white/40 px-0.5">Account Security</p>



            {/* 2FA */}

            <Tile

              icon={Smartphone}

              title="Two-Factor Authentication (2FA)"

              desc={twoFaEnabled ? 'Authenticator app active — account protected' : 'Not enabled — add an extra login layer'}

              badge={twoFaEnabled ? 'ON' : 'OFF'}

              badgeColor={twoFaEnabled

                ? 'text-green-400 bg-green-400/10 border-green-400/25'

                : 'text-white/40 bg-white/[.04] border-white/10'}

              onClick={() => setDrawer('2fa')}

            />



            {/* Change Password */}

            <Tile

              icon={Lock}

              title="Change Password"

              desc="Update your account login password"

              onClick={() => setDrawer('password')}

            />



            {/* Anti-phishing */}

            <Tile

              icon={Fish}

              title="Anti-Phishing Code"

              desc={user?.anti_phishing_code

                ? `Active code: ${user.anti_phishing_code}`

                : 'Not set — add a code shown in all official emails'}

              badge={user?.anti_phishing_code ? 'SET' : undefined}

              badgeColor="text-gold-light bg-gold/10 border-gold/25"

              onClick={() => setDrawer('antiphishing')}

            />



            {/* Account Activity */}

            <Tile

              icon={Activity}

              title="Account Activity"

              desc="Active sessions and recent login history"

              onClick={() => setDrawer('activity')}

            />



            {/* Safe Session — shown inline on mobile / tablet */}

            <div className={`xl:hidden flex items-center gap-4 p-4 rounded-2xl border border-surface-border

              bg-surface-card hover:border-gold/30 hover:bg-surface-hover transition-all

              ${safeSessionLoading ? 'opacity-60' : ''}`}

            >

              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"

                style={{ background: 'rgba(254, 108, 2,0.1)', border: '1px solid rgba(254, 108, 2,0.2)' }}>

                <Shield size={18} className="text-gold-light" />

              </div>

              <div className="flex-1 min-w-0">

                <p className="text-sm font-bold text-white">Safe Session Mode</p>

                <p className="text-xs text-white/55 mt-0.5">Require re-authentication for sensitive actions</p>

                {safeSessionError && <p className="text-xs text-red-400 mt-0.5">{safeSessionError}</p>}

              </div>

              <button

                type="button"

                onClick={toggleSafeSession}

                disabled={safeSessionLoading}

                className="flex-shrink-0 disabled:opacity-50 transition-opacity"

              >

                {safeSession

                  ? <ToggleRight size={34} className="text-gold-light" />

                  : <ToggleLeft size={34} className="text-white/30" />}

              </button>

            </div>



            {/* Danger zone */}

            <div className="pt-3">

              <p className="text-xs font-extrabold uppercase tracking-wider text-white/40 px-0.5 mb-3">Danger Zone</p>

              <Tile

                icon={Trash2}

                iconColor="text-red-400"

                title={user?.pending_deletion ? 'Account Deletion Pending' : 'Delete Account'}

                desc={user?.pending_deletion

                  ? 'Scheduled for deletion — click to cancel the request'

                  : 'Permanently delete your account and all associated data'}

                onClick={() => setDrawer('delete')}

              />

            </div>

          </div>

        </div>

      </div>



      {/* ── Drawers ─────────────────────────────────────────────── */}

      <TwoFactorPanel

        open={drawer === '2fa'}

        onClose={() => setDrawer(null)}

        user={user}

        onUserUpdate={onUserUpdate}

      />

      <AccountActivityPanel

        open={drawer === 'activity'}

        onClose={() => setDrawer(null)}

      />

      <PasswordPanel

        open={drawer === 'password'}

        onClose={() => setDrawer(null)}

      />

      <AntiPhishingPanel

        open={drawer === 'antiphishing'}

        onClose={() => setDrawer(null)}

        user={user}

        onUserUpdate={onUserUpdate}

      />

      <DeleteAccountPanel

        open={drawer === 'delete'}

        onClose={() => setDrawer(null)}

        user={user}

        onUserUpdate={onUserUpdate}

      />

    </div>

  );

}

