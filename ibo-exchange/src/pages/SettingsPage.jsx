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
            className="fixed inset-0 z-[79] bg-black/65 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 320, damping: 32 }}
            className="fixed right-0 top-0 bottom-0 z-[80] w-full max-w-lg
              bg-[color:var(--ibo-elevated,var(--ibo-card))] border-l border-[color:var(--ibo-border-solid)]
              shadow-2xl overflow-y-auto"
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-[color:var(--ibo-border-solid)] sticky top-0 bg-[color:var(--ibo-elevated,var(--ibo-card))] z-10">
              <h2 className="text-[15px] font-bold text-[color:var(--ibo-ink)]">{title}</h2>
              <button type="button" onClick={onClose}
                className="p-1.5 rounded-lg text-[color:var(--ibo-muted)] hover:text-[color:var(--ibo-ink)] hover:bg-white/5 transition-colors">
                <X size={18} />
              </button>
            </div>
            <div className="px-5 py-5">{children}</div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function PrefTile({
  icon: Icon,
  tone = 'orange',
  title,
  desc,
  badge,
  badgeTone = 'muted',
  onClick,
  href,
  disabled,
}) {
  const toneCls = {
    orange: 'pref-tile__icon--orange',
    green: 'pref-tile__icon--green',
    blue: 'pref-tile__icon--blue',
    amber: 'pref-tile__icon--amber',
    red: 'pref-tile__icon--red',
  }[tone] || 'pref-tile__icon--orange';

  const badgeCls = {
    on: 'pref-badge pref-badge--on',
    off: 'pref-badge pref-badge--off',
    set: 'pref-badge pref-badge--set',
    warn: 'pref-badge pref-badge--warn',
    muted: 'pref-badge pref-badge--muted',
  }[badgeTone] || 'pref-badge pref-badge--muted';

  const inner = (
    <div
      className={`pref-tile group${disabled ? ' is-disabled' : ''}`}
      onClick={!disabled && !href ? onClick : undefined}
      onKeyDown={
        !disabled && !href && onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      role={!href && onClick ? 'button' : undefined}
      tabIndex={!disabled && !href && onClick ? 0 : undefined}
    >
      <div className={`pref-tile__icon ${toneCls}`}>
        <Icon size={17} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="pref-tile__title">{title}</p>
        {desc ? <p className="pref-tile__desc">{desc}</p> : null}
      </div>
      {badge ? <span className={badgeCls}>{badge}</span> : null}
      {!badge && !disabled ? (
        <ChevronRight size={15} className="pref-tile__chevron" />
      ) : null}
    </div>
  );
  if (href) return <Link to={href} className="block no-underline">{inner}</Link>;
  return inner;
}

function FieldRow({ label, children }) {
  return (
    <div className="mb-4">
      <label className="ibo-field-label !mb-1.5">{label}</label>
      {children}
    </div>
  );
}

function TextInput({ value, onChange, type = 'text', placeholder, disabled, error, rightAddon }) {
  return (
    <div>
      <div
        className={`flex items-center rounded-xl border px-3.5 py-2.5 transition-colors bg-[color:var(--ibo-bg)]
        ${error ? 'border-[#F6465D]/50' : 'border-[color:var(--ibo-border-solid)] focus-within:border-[#FE6C02]/45'}`}
      >
        <input
          type={type}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          disabled={disabled}
          className="flex-1 bg-transparent text-sm text-[color:var(--ibo-ink)] outline-none placeholder:text-[color:var(--ibo-muted)] disabled:opacity-50"
        />
        {rightAddon}
      </div>
      {error ? <p className="text-xs text-[#F6465D] mt-1 font-semibold">{error}</p> : null}
    </div>
  );
}

function Btn({ children, onClick, loading, disabled, variant = 'primary', className = '' }) {
  const styles =
    variant === 'danger'
      ? 'bg-[rgba(246,70,93,0.12)] border border-[rgba(246,70,93,0.35)] text-[#F6465D] hover:bg-[rgba(246,70,93,0.2)]'
      : variant === 'ghost'
        ? 'border border-[color:var(--ibo-border-solid)] text-[color:var(--ibo-ink-secondary)] hover:text-[color:var(--ibo-ink)] hover:border-[#FE6C02]/35'
        : 'bg-[#FE6C02] border border-transparent text-white hover:bg-[#ff7a1a]';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-semibold text-sm transition-colors disabled:opacity-50 ${styles} ${className}`}
    >
      {loading ? (
        <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
      ) : (
        children
      )}
    </button>
  );
}

function ErrorBox({ msg }) {
  if (!msg) return null;
  return (
    <div className="flex items-start gap-2.5 bg-[rgba(246,70,93,0.1)] border border-[rgba(246,70,93,0.28)] rounded-xl px-4 py-3 mb-4 text-sm text-[#F6465D]">
      <AlertTriangle size={15} className="flex-shrink-0 mt-0.5" /> {msg}
    </div>
  );
}

function SuccessBox({ msg }) {
  if (!msg) return null;
  return (
    <div className="flex items-start gap-2.5 bg-[rgba(14,203,129,0.1)] border border-[rgba(14,203,129,0.28)] rounded-xl px-4 py-3 mb-4 text-sm text-[#0ECB81]">
      <CheckCircle2 size={15} className="flex-shrink-0 mt-0.5" /> {msg}
    </div>
  );
}

// ── Security Score ────────────────────────────────────────────────────────────

function SecurityScore({ user, twoFaEnabled, compact = false }) {
  const checks = [
    { label: 'Email verified', ok: true },
    { label: '2FA enabled', ok: twoFaEnabled },
    { label: 'KYC verified', ok: user?.kyc_status === 'approved' },
    { label: 'Anti-phishing code', ok: Boolean(user?.anti_phishing_code) },
    { label: 'Safe session', ok: Boolean(user?.safe_session) },
    { label: 'Phone linked', ok: Boolean(user?.phone) },
  ];
  const score = Math.round((checks.filter((c) => c.ok).length / checks.length) * 100);
  const level = score >= 80 ? 'strong' : score >= 50 ? 'medium' : 'weak';
  const label = score >= 80 ? 'Strong' : score >= 50 ? 'Medium' : 'Weak';
  const color = score >= 80 ? '#0ECB81' : score >= 50 ? '#FE6C02' : '#F6465D';

  return (
    <div className={`pref-score pref-score--${level}${compact ? ' pref-score--compact' : ''}`}>
      <div className="pref-score__main">
        <div className="min-w-0">
          <p className="pref-score__label">Security score</p>
          <p className="pref-score__value">
            <span className="tabular-nums">{score}%</span>
            <span className="pref-score__level" style={{ color }}>
              {label}
            </span>
          </p>
        </div>
        <div className="pref-score__ring" aria-hidden>
          <svg viewBox="0 0 48 48" className="w-full h-full -rotate-90">
            <circle cx="24" cy="24" r="20" fill="none" stroke="var(--ibo-border-solid)" strokeWidth="5" />
            <circle
              cx="24"
              cy="24"
              r="20"
              fill="none"
              strokeWidth="5"
              stroke={color}
              strokeLinecap="round"
              strokeDasharray={`${(score / 100) * 125.7} 125.7`}
              style={{ transition: 'stroke-dasharray 0.6s ease' }}
            />
          </svg>
        </div>
      </div>
      <div className="pref-score__checks">
        {checks.map((c) => (
          <div key={c.label} className={`pref-score__check${c.ok ? ' is-ok' : ''}`}>
            {c.ok ? (
              <CheckCircle2 size={12} className="shrink-0 text-[#0ECB81]" />
            ) : (
              <AlertTriangle size={12} className="shrink-0 text-[color:var(--ibo-muted)] opacity-50" />
            )}
            <span>{c.label}</span>
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

export default function SettingsPage({ accountMode = false } = {}) {
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
    ? { label: 'Verified', tone: 'on' }
    : kycStatus === 'pending'
      ? { label: 'Under Review', tone: 'warn' }
      : kycStatus === 'rejected'
        ? { label: 'Rejected', tone: 'off' }
        : { label: 'Not Started', tone: 'muted' };

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
      <div className={accountMode ? 'flex items-center justify-center py-16' : 'ibo-page flex items-center justify-center'}>
        <div className="w-8 h-8 border-2 border-[#FE6C02] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className={`pref-hub font-ui ${accountMode ? 'min-w-0' : 'ibo-page'}`}>
      <div
        className={
          accountMode
            ? 'w-full min-w-0 space-y-4'
            : 'w-full max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-4'
        }
      >
        {/* Toolbar */}
        <div className="delta-account-toolbar !mb-0">
          <div className="flex items-center gap-2 min-w-0">
            {!accountMode ? (
              <button
                type="button"
                onClick={() => navigate(-1)}
                className="wallet-action-ghost !px-2 !py-2 shrink-0"
                aria-label="Back"
              >
                <ArrowLeft size={15} />
              </button>
            ) : null}
            <Shield size={16} className="text-[#FE6C02] shrink-0" />
            <div className="min-w-0">
              <h2 className="text-[15px] font-semibold text-[color:var(--ibo-ink)] m-0 leading-tight truncate">
                Preferences
              </h2>
              <p className="text-[11px] text-[color:var(--ibo-muted)] mt-0.5 m-0 truncate">
                Security, identity &amp; session controls
              </p>
            </div>
          </div>
        </div>

        {/* Security score — full width band */}
        <SecurityScore user={user} twoFaEnabled={twoFaEnabled} />

        {/* Quick status chips */}
        <div className="pref-status-row">
          <span className={`pref-status-chip${twoFaEnabled ? ' is-on' : ' is-off'}`}>
            <Smartphone size={12} /> 2FA {twoFaEnabled ? 'On' : 'Off'}
          </span>
          <span className={`pref-status-chip${kycStatus === 'approved' ? ' is-on' : kycStatus === 'pending' ? ' is-warn' : ' is-off'}`}>
            <ShieldCheck size={12} /> KYC {kycBadge.label}
          </span>
          <span className={`pref-status-chip${safeSession ? ' is-on' : ' is-off'}`}>
            <Shield size={12} /> Safe session {safeSession ? 'On' : 'Off'}
          </span>
          <span className={`pref-status-chip${user?.anti_phishing_code ? ' is-set' : ' is-off'}`}>
            <Fish size={12} /> Anti-phish {user?.anti_phishing_code ? 'Set' : 'Off'}
          </span>
        </div>

        {/* Identity + Safe session side-by-side */}
        <div className="pref-quick-grid">
          <div className={`pref-kyc pref-kyc--${kycStatus === 'approved' ? 'ok' : kycStatus === 'pending' ? 'warn' : 'idle'}`}>
            <div className="pref-kyc__head">
              <div className="pref-kyc__icon">
                <ShieldCheck size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="pref-kyc__title">Identity (KYC)</p>
                  <span className={`pref-badge pref-badge--${kycBadge.tone}`}>{kycBadge.label}</span>
                </div>
                <p className="pref-kyc__desc">Required for full trading &amp; withdrawals</p>
              </div>
            </div>
            <Link to="/account/kyc" className="wallet-action-primary w-full !py-2.5 justify-center">
              {kycStatus === 'approved' ? 'View KYC status' : 'Complete KYC'}
              <ChevronRight size={14} />
            </Link>
          </div>

          <div className={`pref-safe${safeSession ? ' is-on' : ''}${safeSessionLoading ? ' is-loading' : ''}`}>
            <div className="pref-safe__head">
              <div className="pref-safe__icon">
                <Shield size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="pref-safe__title">Safe session</p>
                <p className="pref-safe__desc">Re-auth for sensitive actions</p>
                {safeSessionError ? (
                  <p className="text-[11px] text-[#F6465D] mt-1 m-0">{safeSessionError}</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={toggleSafeSession}
                disabled={safeSessionLoading}
                className="shrink-0 disabled:opacity-50"
                aria-label="Toggle safe session"
              >
                {safeSession ? (
                  <ToggleRight size={34} className="text-[#0ECB81]" />
                ) : (
                  <ToggleLeft size={34} className="text-[color:var(--ibo-muted)]" />
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Security actions */}
        <section className="pref-section">
          <p className="pref-section__label">Account security</p>
          <div className="pref-section__list">
            <PrefTile
              icon={Smartphone}
              tone={twoFaEnabled ? 'green' : 'orange'}
              title="Two-factor authentication"
              desc={
                twoFaEnabled
                  ? 'Authenticator app active — account protected'
                  : 'Not enabled — add an extra login layer'
              }
              badge={twoFaEnabled ? 'ON' : 'OFF'}
              badgeTone={twoFaEnabled ? 'on' : 'off'}
              onClick={() => setDrawer('2fa')}
            />
            <PrefTile
              icon={Lock}
              tone="blue"
              title="Change password"
              desc="Update your account login password"
              onClick={() => setDrawer('password')}
            />
            <PrefTile
              icon={Fish}
              tone="amber"
              title="Anti-phishing code"
              desc={
                user?.anti_phishing_code
                  ? `Active code: ${user.anti_phishing_code}`
                  : 'Not set — code shown in official emails'
              }
              badge={user?.anti_phishing_code ? 'SET' : undefined}
              badgeTone="set"
              onClick={() => setDrawer('antiphishing')}
            />
            <PrefTile
              icon={Activity}
              tone="blue"
              title="Account activity"
              desc="Active sessions and recent login history"
              onClick={() => setDrawer('activity')}
            />
          </div>
        </section>

        {/* Danger zone */}
        <section className="pref-section">
          <p className="pref-section__label pref-section__label--danger">Danger zone</p>
          <div className="pref-section__list">
            <PrefTile
              icon={Trash2}
              tone="red"
              title={user?.pending_deletion ? 'Account deletion pending' : 'Delete account'}
              desc={
                user?.pending_deletion
                  ? 'Scheduled for deletion — click to cancel'
                  : 'Permanently delete your account and data'
              }
              badge={user?.pending_deletion ? 'PENDING' : undefined}
              badgeTone="warn"
              onClick={() => setDrawer('delete')}
            />
          </div>
        </section>
      </div>

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
