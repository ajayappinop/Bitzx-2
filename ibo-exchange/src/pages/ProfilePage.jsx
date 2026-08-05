import { useState, useEffect, useRef, useMemo, useCallback, useLayoutEffect } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  User, Lock, Shield, CheckCircle, AlertCircle,
  ChevronRight, ChevronDown, Eye, EyeOff,
  Camera, Trash2, Copy, RefreshCw, LogOut, KeyRound, Gift,
} from 'lucide-react';
import { useAuth, authFetch } from '@/context/AuthContext';
import {
  validateProfileForm,
  firstProfileError,
  validatePasswordChangeFields,
  firstPasswordChangeFieldError,
  nationalFromStoredPhone,
} from '@/lib/profileValidation';
import { validateSignupMobile } from '@/lib/authValidation';
import {
  formatApiDetail,
  parseFastApi422FieldErrors,
  authFormBannerMessage,
  validateStrongPassword,
} from '@/lib/authValidation';
import { exchangeApiOrigin } from '@/lib/apiBase';
import { useSignupOtpConfig } from '@/hooks/useSignupOtpConfig';
import { listCountryNames, suggestPlaces } from '@/data/kycLocations';
import { createPortal } from 'react-dom';

const API = exchangeApiOrigin(import.meta.env.VITE_BACKEND_URL);

/** Normalize pure country names; leave place labels like "Jaipur, Rajasthan, India" intact. */
function resolveLocationValue(raw) {
  const cur = String(raw || '').trim();
  if (!cur) return '';
  if (cur.includes(',')) return cur;
  const hit = listCountryNames().find((c) => c.toLowerCase() === cur.toLowerCase());
  return hit || cur;
}

/**
 * Typeable combobox with filtered suggestions (country / city / region).
 * Dropdown is portaled so account scroll does not clip it.
 */
function ProfSuggestField({
  id,
  value,
  onChange,
  onBlur,
  hasError,
  suggestions = [],
  placeholder = 'Type or select…',
  autoComplete = 'off',
  listLabel = 'suggestions',
}) {
  const [open, setOpen] = useState(false);
  const [hl, setHl] = useState(0);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const listId = `${id}-list`;
  const [coords, setCoords] = useState({ top: 0, left: 0, width: 0 });

  const visible = suggestions.slice(0, 80);
  const showList = open && visible.length > 0;

  const measure = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setCoords({
      top: r.bottom + 4,
      left: r.left,
      width: r.width,
    });
  }, []);

  useLayoutEffect(() => {
    if (!showList) return;
    measure();
    const onRe = () => measure();
    window.addEventListener('resize', onRe);
    window.addEventListener('scroll', onRe, true);
    return () => {
      window.removeEventListener('resize', onRe);
      window.removeEventListener('scroll', onRe, true);
    };
  }, [showList, measure, value, visible.length]);

  useEffect(() => {
    const onDoc = (e) => {
      const t = e.target;
      if (wrapRef.current?.contains(t)) return;
      if (listRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  useEffect(() => {
    setHl(0);
  }, [visible.length, value]);

  const pick = (s) => {
    onChange(s);
    setOpen(false);
    inputRef.current?.focus();
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (!showList) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHl((i) => Math.min(i + 1, visible.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHl((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && visible[hl]) {
      e.preventDefault();
      pick(visible[hl]);
    }
  };

  const dropdown = showList
    ? createPortal(
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={listLabel}
          className="prof-suggest-list"
          style={{
            top: coords.top,
            left: coords.left,
            width: coords.width,
          }}
        >
          {visible.map((s, i) => (
            <li key={`${s}-${i}`} role="option" aria-selected={i === hl}>
              <button
                type="button"
                className={`prof-suggest-item${i === hl ? ' is-active' : ''}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(s)}
              >
                {s}
              </button>
            </li>
          ))}
        </ul>,
        document.body,
      )
    : null;

  return (
    <div ref={wrapRef} className="prof-combobox">
      <input
        ref={inputRef}
        id={id}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-invalid={hasError}
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className="prof-input"
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label={open ? `Close ${listLabel}` : `Open ${listLabel}`}
        className="prof-combobox__toggle"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          setOpen((v) => !v);
          inputRef.current?.focus();
        }}
      >
        <ChevronDown size={16} className={open ? 'rotate-180' : undefined} />
      </button>
      {dropdown}
    </div>
  );
}

function resolveAvatarUrl(user) {
  if (!user?.avatar_url) return null;
  const u = user.avatar_url;
  if (u.startsWith('http')) return u;
  const base = API.replace(/\/$/, '');
  return `${base}${u.startsWith('/') ? u : `/${u}`}`;
}

const KYC_CONFIG = {
  approved:   { label: 'Verified',      bg: 'rgba(34,197,94,0.12)',  text: '#22c55e',  border: 'rgba(34,197,94,0.25)',  icon: CheckCircle },
  pending:    { label: 'Under Review',  bg: 'rgba(254, 108, 2,0.12)', text: '#FE6C02',  border: 'rgba(254, 108, 2,0.25)', icon: Shield      },
  rejected:   { label: 'Rejected',      bg: 'rgba(239,68,68,0.12)',  text: '#ef4444',  border: 'rgba(239,68,68,0.25)',  icon: AlertCircle },
  unverified: { label: 'Not Verified',  bg: 'var(--ibo-elevated)', text: 'var(--ibo-ink-secondary)',  border: 'var(--ibo-border)', icon: Shield     },
};

function Toast({ msg, ok }) {
  if (!msg) return null;
  return (
    <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
      className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium ${
        ok ? 'bg-green-500/10 border border-green-500/25 text-green-400'
           : 'bg-red-500/10 border border-red-500/25 text-red-400'}`}>
      {ok ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
      {msg}
    </motion.div>
  );
}

function OtpSendButton({ label, loading, disabled, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      className="wallet-action-primary flex-shrink-0 !px-3 sm:!px-4 !py-2.5 text-xs sm:text-sm disabled:opacity-40 disabled:pointer-events-none"
    >
      {loading ? (
        <span className="inline-block w-4 h-4 border-2 border-gold-light border-t-transparent rounded-full animate-spin" />
      ) : (
        label
      )}
    </button>
  );
}

function FieldGroup({ label, children, hint, required, error }) {
  const err = error?.trim();
  return (
    <div className="min-w-0">
      <label className="ibo-field-label !mb-1.5">
        {label}
        {required ? <span className="text-[#F6465D] ml-0.5 normal-case tracking-normal">*</span> : null}
      </label>
      {children}
      {err ? <p className="text-xs text-[#F6465D] mt-1.5 font-semibold">{err}</p> : null}
      {hint && !err ? <p className="text-[11px] text-[color:var(--ibo-muted)] mt-1.5 leading-relaxed">{hint}</p> : null}
    </div>
  );
}

function fieldShell(hasError) {
  return `prof-pw-wrap${hasError ? ' is-error' : ''}`;
}

function fieldInputClass(hasError) {
  return `wallet-field w-full prof-pw-input${hasError ? ' is-error' : ''}`;
}

function ProfileTab({ user, updateUser }) {
  const fileRef = useRef(null);
  const { smsOtpEnabled, defaultCountryCode } = useSignupOtpConfig();
  const [countryCode, setCountryCode] = useState('91');
  const [form, setForm] = useState({
    name: '',
    mobile: '',
    country: '',
    bio: '',
  });
  const [baselineMobile, setBaselineMobile] = useState('');
  const [phoneOtp, setPhoneOtp] = useState('');
  const [phoneOtpSent, setPhoneOtpSent] = useState(false);
  const [phoneSendLoading, setPhoneSendLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [toast, setToast] = useState(null);
  const [preview, setPreview] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [touched, setTouched] = useState({
    name: false,
    phone: false,
    phoneOtp: false,
    country: false,
    bio: false,
  });
  useEffect(() => {
    if (defaultCountryCode) setCountryCode(defaultCountryCode);
  }, [defaultCountryCode]);
  useEffect(() => {
    if (!user) return;
    const nat = nationalFromStoredPhone(user.phone, countryCode);
    setBaselineMobile(nat);
    setForm({
      name: user.name || '',
      mobile: nat,
      country: resolveLocationValue(user.country || ''),
      bio: user.bio || '',
    });
    setPhoneOtp('');
    setPhoneOtpSent(false);
  }, [user, countryCode]);
  const mobileDigits = form.mobile.replace(/\D/g, '');
  const phoneChanged = mobileDigits !== baselineMobile.replace(/\D/g, '');
  const mobileValid = !validateSignupMobile(mobileDigits);
  const placeSuggestions = useMemo(
    () => suggestPlaces(form.country || '', 80),
    [form.country],
  );
  useEffect(() => {
    setFieldErrors({});
  }, [form.name, form.mobile, form.country, form.bio, phoneOtp]);
  useEffect(() => {
    if (!phoneChanged) {
      setPhoneOtp('');
      setPhoneOtpSent(false);
    }
  }, [phoneChanged]);
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);
  const showToast = (msg, ok) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 4500); };
  const showFieldError = field => Boolean(fieldErrors[field]) && (submitAttempted || touched[field] || (field === 'phoneOtp' && phoneChanged));
  const markTouched = field => setTouched(prev => ({ ...prev, [field]: true }));
  const validateSingleField = (field, nextForm = form) => {
    const errs = validateProfileForm(nextForm);
    return errs[field] || '';
  };
  const initials = user?.name?.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || '??';
  const avatarSrc = preview || resolveAvatarUrl(user);
  const handleSendPhoneOtp = async () => {
    if (!phoneChanged) {
      showToast('Enter a new mobile number to verify.', false);
      return;
    }
    if (!mobileValid) {
      setFieldErrors(prev => ({ ...prev, phone: validateSignupMobile(mobileDigits) }));
      showToast(validateSignupMobile(mobileDigits) || 'Enter a valid mobile number.', false);
      return;
    }
    setPhoneSendLoading(true);
    try {
      const res = await authFetch(`${API}/api/auth/profile/phone/send-otp`, {
        method: 'POST',
        body: JSON.stringify({ mobile: mobileDigits, country_code: countryCode || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(formatApiDetail(data.detail) || 'Could not send SMS code');
      if (data.otp_required === false) {
        setPhoneOtpSent(false);
      } else {
        setPhoneOtpSent(true);
        setPhoneOtp('');
      }
      showToast(data.message || 'Verification code sent.', true);
    } catch (e) {
      showToast(e.message || 'Could not send SMS code', false);
    } finally {
      setPhoneSendLoading(false);
    }
  };
  const handleSave = async () => {
    setSubmitAttempted(true);
    const name = form.name.trim();
    const country = form.country.trim();
    const errs = validateProfileForm({
      name: form.name,
      mobile: mobileDigits,
      country: form.country,
      bio: form.bio,
    });
    if (phoneChanged && smsOtpEnabled) {
      if (!phoneOtpSent) {
        errs.phoneOtp = 'Send a verification code to your new number first.';
      } else if (!phoneOtp.trim() || phoneOtp.trim().length < 6) {
        errs.phoneOtp = 'Enter the 6-digit SMS code.';
      }
    }
    if (Object.keys(errs).length) {
      setFieldErrors(errs);
      showToast(firstProfileError(errs) || errs.phoneOtp || 'Please fix the highlighted fields.', false);
      return;
    }
    setFieldErrors({});
    setSaving(true);
    try {
      const payload = {
        name,
        country,
        bio: form.bio.trim(),
      };
      if (phoneChanged) {
        payload.mobile = mobileDigits;
        if (countryCode) payload.country_code = countryCode;
        if (smsOtpEnabled && phoneOtp.trim()) {
          payload.phone_otp = phoneOtp.trim();
        }
      }
      const res = await authFetch(`${API}/api/auth/profile`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(formatApiDetail(data.detail) || 'Update failed');
      updateUser(data);
      setPhoneOtp('');
      setPhoneOtpSent(false);
      showToast('Profile updated successfully!', true);
    } catch (e) {
      showToast(e.message, false);
    } finally { setSaving(false); }
  };
  const dirty =
    form.name.trim() !== (user?.name || '') ||
    phoneChanged ||
    form.country.trim() !== resolveLocationValue(user?.country || '') ||
    form.bio.trim() !== (user?.bio || '');
  const onPickFile = async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !file.type.startsWith('image/')) {
      showToast('Please choose a JPEG, PNG, or WebP image', false);
      return;
    }
    if (file.size > 100 * 1024 * 1024) {
      showToast('Image must be 100MB or smaller', false);
      return;
    }
    if (preview) URL.revokeObjectURL(preview);
    setPreview(URL.createObjectURL(file));
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await authFetch(`${API}/api/auth/profile/avatar`, { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Upload failed');
      updateUser(data);
      setPreview(null);
      showToast('Profile photo updated', true);
    } catch (err) {
      setPreview(null);
      showToast(err.message, false);
    } finally {
      setUploading(false);
    }
  };
  const removeAvatar = async () => {
    if (!user?.avatar_url) return;
    setUploading(true);
    try {
      const res = await authFetch(`${API}/api/auth/profile/avatar`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Could not remove photo');
      updateUser(data);
      setPreview(null);
      showToast('Profile photo removed', true);
    } catch (e) {
      showToast(e.message, false);
    } finally { setUploading(false); }
  };
  const kycConf = KYC_CONFIG[user?.kyc_status || 'unverified'];
  const KycIcon = kycConf.icon;
  return (
    <div className="prof-tab space-y-4 w-full min-w-0">
      {/* Identity strip — full-width, not a side dock */}
      <section className="prof-identity" aria-label="Your identity">
        <div className="prof-identity__media">
          <div className="prof-avatar" aria-hidden>
            {avatarSrc ? (
              <img src={avatarSrc} alt="" className="w-full h-full object-cover" />
            ) : (
              <span>{initials}</span>
            )}
            {uploading ? (
              <div className="prof-avatar__loading">
                <span className="w-7 h-7 border-2 border-[#FE6C02] border-t-transparent rounded-full animate-spin" />
              </div>
            ) : null}
          </div>
          <div className="prof-identity__actions">
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
              className="wallet-action-primary text-xs !px-3 !py-2 disabled:opacity-50"
            >
              <Camera size={14} /> {user?.avatar_url ? 'Change photo' : 'Upload photo'}
            </button>
            {user?.avatar_url ? (
              <button
                type="button"
                disabled={uploading}
                onClick={removeAvatar}
                className="wallet-action-ghost text-xs !px-3 !py-2 !text-[#F6465D] hover:!border-[#F6465D]/40 disabled:opacity-50"
              >
                <Trash2 size={14} /> Remove
              </button>
            ) : null}
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={onPickFile}
            />
          </div>
        </div>

        <div className="prof-identity__body min-w-0">
          <p className="prof-identity__kicker">Your profile</p>
          <h3 className="prof-identity__name">{user?.name || 'Trader'}</h3>
          <p className="prof-identity__email truncate" title={user?.email}>
            {user?.email}
          </p>
          <div className="prof-identity__chips">
            <span
              className="prof-chip"
              style={{ background: kycConf.bg, color: kycConf.text, borderColor: kycConf.border }}
            >
              <KycIcon size={12} /> {kycConf.label}
            </span>
            <span className="prof-chip prof-chip--muted">0.1% fee</span>
            <span className="prof-chip prof-chip--muted font-mono text-[10px] max-w-[12rem] truncate" title={user?.uid}>
              {user?.uid}
            </span>
          </div>
          <div className="prof-identity__links">
            <Link to="/account/refer" className="wallet-action-ghost text-xs !px-2.5 !py-1.5">
              <Gift size={13} /> Refer
            </Link>
            <Link to="/account/kyc" className="wallet-action-ghost text-xs !px-2.5 !py-1.5">
              <Shield size={13} /> KYC
            </Link>
            <Link to="/account/security" className="wallet-action-ghost text-xs !px-2.5 !py-1.5">
              <Lock size={13} /> Security
            </Link>
          </div>
          <p className="prof-identity__hint">JPG, PNG or WebP · max 100MB</p>
        </div>
      </section>

      {/* Open form — no nested cards; label | value rows */}
      <section className="prof-form" aria-labelledby="prof-details-heading">
        <header className="prof-form__head">
          <h3 id="prof-details-heading" className="prof-form__title">Personal details</h3>
          <p className="prof-form__sub">Name, mobile, location, and email</p>
        </header>

        <div className="prof-form__list">
          <div className={`prof-form__row ${showFieldError('name') ? 'is-error' : ''}`}>
            <label className="prof-form__label" htmlFor="prof-name">
              Display name <span className="prof-form__req">*</span>
            </label>
            <div className="prof-form__control">
              <input
                id="prof-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                onBlur={() => {
                  markTouched('name');
                  setFieldErrors((prev) => ({ ...prev, name: validateSingleField('name') }));
                }}
                placeholder="Your display name"
                required
                className="prof-input"
              />
              {showFieldError('name') ? (
                <p className="prof-form__err">{fieldErrors.name}</p>
              ) : (
                <p className="prof-form__hint">Your name as shown on the exchange</p>
              )}
            </div>
          </div>

          <div className={`prof-form__row ${showFieldError('phone') ? 'is-error' : ''}`}>
            <label className="prof-form__label" htmlFor="prof-mobile">
              Mobile number <span className="prof-form__req">*</span>
            </label>
            <div className="prof-form__control">
              <div className="prof-form__inline">
                <input
                  id="prof-mobile"
                  value={form.mobile}
                  onChange={(e) => {
                    const v = e.target.value.replace(/\D/g, '').slice(0, 10);
                    setForm((f) => ({ ...f, mobile: v }));
                  }}
                  onBlur={() => {
                    markTouched('phone');
                    setFieldErrors((prev) => ({ ...prev, phone: validateSingleField('phone') }));
                  }}
                  placeholder="9876543210"
                  required
                  inputMode="numeric"
                  autoComplete="tel-national"
                  className="prof-input"
                />
                {phoneChanged && smsOtpEnabled ? (
                  <OtpSendButton
                    label={phoneOtpSent ? 'Resend' : 'Send OTP'}
                    loading={phoneSendLoading}
                    disabled={!mobileValid}
                    onClick={handleSendPhoneOtp}
                  />
                ) : null}
              </div>
              {showFieldError('phone') ? (
                <p className="prof-form__err">{fieldErrors.phone}</p>
              ) : (
                <p className="prof-form__hint">
                  {user?.phone && !phoneChanged
                    ? `Current: ${user.phone}`
                    : phoneChanged && smsOtpEnabled
                      ? 'Verify your new number with SMS before saving.'
                      : phoneChanged && !smsOtpEnabled
                        ? 'SMS verification is inactive — save now and verify later when SMS is enabled.'
                        : '10-digit mobile (India: starts with 6–9)'}
                </p>
              )}
            </div>
          </div>

          {phoneChanged && smsOtpEnabled ? (
            <div className={`prof-form__row ${showFieldError('phoneOtp') ? 'is-error' : ''}`}>
              <label className="prof-form__label" htmlFor="prof-phone-otp">
                SMS code <span className="prof-form__req">*</span>
              </label>
              <div className="prof-form__control">
                <input
                  id="prof-phone-otp"
                  value={phoneOtp}
                  onChange={(e) => {
                    setPhoneOtp(e.target.value.replace(/\D/g, '').slice(0, 6));
                    setFieldErrors((prev) => ({ ...prev, phoneOtp: '' }));
                  }}
                  onBlur={() => markTouched('phoneOtp')}
                  placeholder="123456"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  className="prof-input prof-input--otp"
                />
                {showFieldError('phoneOtp') ? (
                  <p className="prof-form__err">{fieldErrors.phoneOtp}</p>
                ) : (
                  <p className="prof-form__hint">6-digit code sent to your new number</p>
                )}
              </div>
            </div>
          ) : null}

          <div className={`prof-form__row ${showFieldError('country') ? 'is-error' : ''}`}>
            <label className="prof-form__label" htmlFor="prof-country">
              Country / region <span className="prof-form__req">*</span>
            </label>
            <div className="prof-form__control">
              <ProfSuggestField
                id="prof-country"
                value={form.country}
                hasError={showFieldError('country')}
                suggestions={placeSuggestions}
                placeholder="Type a city, region, or country"
                autoComplete="address-level2"
                listLabel="locations"
                onChange={(v) => {
                  setForm((f) => ({ ...f, country: v }));
                  setFieldErrors((prev) => ({ ...prev, country: '' }));
                }}
                onBlur={() => {
                  markTouched('country');
                  const resolved = resolveLocationValue(form.country);
                  if (resolved && resolved !== form.country) {
                    setForm((f) => ({ ...f, country: resolved }));
                  }
                  setFieldErrors((prev) => ({
                    ...prev,
                    country: validateSingleField('country', {
                      ...form,
                      country: resolved || form.country,
                    }),
                  }));
                }}
              />
              {showFieldError('country') ? (
                <p className="prof-form__err">{fieldErrors.country}</p>
              ) : (
                <p className="prof-form__hint">
                  Type a city (e.g. Jaipur) to see full places like Jaipur, Rajasthan, India
                </p>
              )}
            </div>
          </div>

          <div className="prof-form__row prof-form__row--readonly">
            <span className="prof-form__label">Email address</span>
            <div className="prof-form__control">
              <div className="prof-form__readonly">
                <span className="prof-form__readonly-val truncate" title={user?.email}>
                  {user?.email}
                </span>
                <span className="prof-form__readonly-tag">Read-only</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="prof-form prof-form--bio" aria-labelledby="prof-bio-heading">
        <header className="prof-form__head">
          <div className="prof-form__head-row">
            <div className="min-w-0">
              <h3 id="prof-bio-heading" className="prof-form__title">About you</h3>
              <p className="prof-form__sub">Optional bio · max 500 characters</p>
            </div>
            <span className="prof-form__count" aria-live="polite">
              {(form.bio || '').length}/500
            </span>
          </div>
        </header>
        <div className={`prof-form__bio-wrap ${showFieldError('bio') ? 'is-error' : ''}`}>
          <textarea
            id="prof-bio"
            value={form.bio}
            onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))}
            onBlur={() => {
              markTouched('bio');
              setFieldErrors((prev) => ({ ...prev, bio: validateSingleField('bio') }));
            }}
            placeholder="Tell others a bit about your trading style…"
            rows={4}
            maxLength={500}
            className="prof-textarea"
          />
          {showFieldError('bio') ? (
            <p className="prof-form__err">{fieldErrors.bio}</p>
          ) : null}
        </div>
      </section>

      {/* Form actions — open strip, no nested card */}
      <div className={`prof-actions${dirty ? ' is-dirty' : ''}`}>
        <p className="prof-actions__status">
          {dirty ? (
            <>
              <span className="prof-actions__pulse" aria-hidden />
              Unsaved changes
            </>
          ) : (
            <>
              <CheckCircle size={14} className="prof-actions__ok-icon" aria-hidden />
              All changes saved
            </>
          )}
        </p>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !dirty}
          className="wallet-action-primary prof-actions__btn disabled:opacity-40"
        >
          {saving ? (
            <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            'Save profile'
          )}
        </button>
      </div>

      {user?.kyc_status !== 'approved' ? (
        <div className="prof-kyc-banner">
          <div className="prof-kyc-banner__icon">
            <Shield size={18} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-[color:var(--ibo-ink)] m-0">Identity verification</p>
            <p className="text-[13px] text-[color:var(--ibo-ink-secondary)] m-0 mt-1 leading-relaxed">
              Complete KYC to unlock spot trading, deposits, and withdrawals on Delta.
            </p>
          </div>
          <Link to="/account/kyc" className="wallet-action-primary shrink-0">
            Start verification <ChevronRight size={15} />
          </Link>
        </div>
      ) : null}

      {toast ? <Toast msg={toast.msg} ok={toast.ok} /> : null}
    </div>
  );
}

const emptyPwFieldErrors = () => ({
  current_password: '', new_password: '', confirm: '',
});

function SecurityTab() {
  const [form,   setForm]   = useState({ current_password: '', new_password: '', confirm: '' });
  const [showPw, setShowPw] = useState({ cur: false, nw: false, cnf: false });
  const [saving, setSaving] = useState(false);
  const [toast,  setToast]  = useState(null);
  const [fieldErrors, setFieldErrors] = useState(emptyPwFieldErrors);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [touched, setTouched] = useState({
    current_password: false,
    new_password: false,
    confirm: false,
  });
  const showToast = (msg, ok) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 5000); };
  const onPwdChange = k => e => {
    setForm(f => ({ ...f, [k]: e.target.value }));
    setFieldErrors(f => ({ ...f, [k]: '' }));
  };
  const togglePw  = k => setShowPw(p => ({ ...p, [k]: !p[k] }));
  const showFieldError = key => Boolean(fieldErrors[key]) && (submitAttempted || touched[key]);
  const handleChange = async () => {
    setSubmitAttempted(true);
    const fe = validatePasswordChangeFields(form);
    if (Object.keys(fe).length) {
      setFieldErrors({
        current_password: fe.current_password || '',
        new_password: fe.new_password || '',
        confirm: fe.confirm || '',
      });
      showToast(firstPasswordChangeFieldError(fe) || 'Please fix the highlighted fields.', false);
      return;
    }
    setSaving(true);
    try {
      const res  = await authFetch(`${API}/api/auth/password`, {
        method: 'PUT',
        body: JSON.stringify({ current_password: form.current_password, new_password: form.new_password }),
      });
      let data = {};
      try {
        data = await res.json();
      } catch { /* non-JSON */ }
      if (!res.ok) {
        const apiFe = res.status === 422 ? parseFastApi422FieldErrors(data.detail) : {};
        if (Object.keys(apiFe).length) {
          setFieldErrors({
            current_password: apiFe.current_password || '',
            new_password: apiFe.new_password || '',
            confirm: apiFe.confirm || '',
          });
          showToast(authFormBannerMessage(apiFe, formatApiDetail(data.detail)), false);
        } else {
          setFieldErrors(emptyPwFieldErrors());
          showToast(formatApiDetail(data.detail) || 'Failed to change password', false);
        }
        return;
      }
      showToast('Password changed successfully!', true);
      setForm({ current_password: '', new_password: '', confirm: '' });
      setFieldErrors(emptyPwFieldErrors());
    } catch (e) {
      setFieldErrors(emptyPwFieldErrors());
      showToast(e.message || 'Something went wrong', false);
    } finally { setSaving(false); }
  };
  const pwFields = [
    {
      key: 'current_password', label: 'Current Password', placeholder: 'Enter your current password', showKey: 'cur',
      onBlur: () => {
        setTouched(t => ({ ...t, current_password: true }));
        const cur = (form.current_password || '').trim();
        setFieldErrors(f => ({ ...f, current_password: cur ? '' : 'Enter your current password.' }));
      },
    },
    {
      key: 'new_password', label: 'New Password', placeholder: '8+ chars, upper, lower, #, symbol', showKey: 'nw',
      onBlur: () => {
        setTouched(t => ({ ...t, new_password: true }));
        const nw = form.new_password || '';
        const cur = (form.current_password || '').trim();
        let msg = validateStrongPassword(nw) || '';
        if (!msg && nw && cur && nw === cur) {
          msg = 'New password must be different from your current password.';
        }
        setFieldErrors(f => ({ ...f, new_password: msg }));
      },
    },
    {
      key: 'confirm', label: 'Confirm New Password', placeholder: 'Re-enter new password', showKey: 'cnf',
      onBlur: () => {
        setTouched(t => ({ ...t, confirm: true }));
        const nw = form.new_password || '';
        const cf = form.confirm || '';
        let msg = '';
        if (nw && !String(cf).trim()) msg = 'Confirm your new password.';
        else if (String(cf).trim() && nw !== cf) msg = 'New passwords do not match.';
        setFieldErrors(f => ({ ...f, confirm: msg }));
      },
    },
  ];
  return (
    <div className="prof-tab space-y-4 min-w-0">
      <div className="prof-panel">
        <div className="prof-panel__head">
          <span className="prof-panel__icon prof-panel__icon--orange">
            <KeyRound size={15} />
          </span>
          <div className="min-w-0">
            <h3 className="prof-panel__title">Change password</h3>
            <p className="prof-panel__sub">Update your account login password</p>
          </div>
        </div>
        <div className="space-y-4 max-w-xl">
        {pwFields.map(({ key, label, placeholder, showKey, onBlur }) => (
          <FieldGroup key={key} label={label} error={showFieldError(key) ? fieldErrors[key] : ''}>
            <div className={fieldShell(showFieldError(key))}>
              <span className="prof-pw-icon prof-pw-icon--left" aria-hidden>
                <Lock size={15} strokeWidth={2} />
              </span>
              <input
                type={showPw[showKey] ? 'text' : 'password'}
                value={form[key]}
                onChange={onPwdChange(key)}
                onBlur={onBlur}
                placeholder={placeholder}
                autoComplete={key === 'current_password' ? 'current-password' : 'new-password'}
                aria-invalid={Boolean(fieldErrors[key])}
                className={fieldInputClass(showFieldError(key))}
              />
              <button
                type="button"
                onClick={() => togglePw(showKey)}
                className="prof-pw-icon prof-pw-icon--right"
                aria-label={showPw[showKey] ? 'Hide password' : 'Show password'}
              >
                {showPw[showKey] ? <EyeOff size={16} strokeWidth={2} /> : <Eye size={16} strokeWidth={2} />}
              </button>
            </div>
          </FieldGroup>
        ))}
      </div>
      {toast ? <Toast msg={toast.msg} ok={toast.ok} /> : null}
      <button
        type="button"
        onClick={handleChange}
        disabled={saving}
        className="wallet-action-primary prof-pw-submit disabled:opacity-40"
      >
        {saving
          ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          : <><Lock size={15} /> Update password</>}
      </button>
      </div>
      <TwoFactorCard />
      <SessionsCard />
      <div className="prof-panel prof-panel--teal">
        <div className="prof-panel__head">
          <span className="prof-panel__icon prof-panel__icon--teal">
            <Shield size={15} />
          </span>
          <div className="min-w-0">
            <h3 className="prof-panel__title">Security recommendations</h3>
            <p className="prof-panel__sub">Keep your account protected</p>
          </div>
        </div>
        <ul className="prof-tips">
        {[
          "Use a unique password that you don't use on other websites",
          'Include uppercase, lowercase letters, numbers and symbols',
          'Never share your password with anyone, including Delta support',
          'Turn on 2FA above and keep your backup codes in a safe place',
        ].map(tip => (
          <li key={tip}>{tip}</li>
        ))}
        </ul>
      </div>
    </div>
  );
}

// ── 2FA card (setup / verify / disable / backup codes) ──────────────────────

function TwoFactorCard() {
  const { user, updateUser } = useAuth();
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [setup, setSetup] = useState(null);       // { otpauth_url, secret_b32 }
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [backupCodes, setBackupCodes] = useState(null);
  const [disableForm, setDisableForm] = useState({ open: false, password: '', code: '' });
  const [regenForm, setRegenForm] = useState({ open: false, code: '' });
  const showToast = (msg, ok) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 5000); };
  const loadStatus = async () => {
    setLoading(true);
    try {
      const res = await authFetch(`${API}/api/auth/2fa/status`);
      if (res.ok) setStatus(await res.json());
    } finally { setLoading(false); }
  };
  useEffect(() => { loadStatus(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const beginSetup = async () => {
    setBusy(true);
    try {
      const res = await authFetch(`${API}/api/auth/2fa/setup`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { showToast(formatApiDetail(data.detail) || 'Could not start 2FA setup', false); return; }
      setSetup(data);
      setCode('');
      setBackupCodes(null);
    } finally { setBusy(false); }
  };
  const cancelSetup = () => { setSetup(null); setCode(''); };
  const verifySetup = async () => {
    if (!code.trim()) { showToast('Enter the 6-digit code from your app', false); return; }
    setBusy(true);
    try {
      const res = await authFetch(`${API}/api/auth/2fa/verify`, {
        method: 'POST', body: JSON.stringify({ code: code.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { showToast(formatApiDetail(data.detail) || 'Invalid code', false); return; }
      setBackupCodes(data.backup_codes || []);
      setSetup(null);
      setCode('');
      if (user) updateUser(u => ({ ...(u || {}), two_factor_enabled: true }));
      showToast('Two-factor authentication enabled', true);
      await loadStatus();
    } finally { setBusy(false); }
  };
  const submitDisable = async () => {
    if (!disableForm.password) { showToast('Enter your current password', false); return; }
    if (!disableForm.code.trim()) { showToast('Enter a 2FA or backup code', false); return; }
    setBusy(true);
    try {
      const res = await authFetch(`${API}/api/auth/2fa/disable`, {
        method: 'POST',
        body: JSON.stringify({ password: disableForm.password, code: disableForm.code.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { showToast(formatApiDetail(data.detail) || 'Could not disable 2FA', false); return; }
      if (user) updateUser(u => ({ ...(u || {}), two_factor_enabled: false }));
      setDisableForm({ open: false, password: '', code: '' });
      setBackupCodes(null);
      showToast('Two-factor authentication disabled', true);
      await loadStatus();
    } finally { setBusy(false); }
  };
  const submitRegen = async () => {
    if (!regenForm.code.trim()) { showToast('Enter a 2FA or backup code', false); return; }
    setBusy(true);
    try {
      const res = await authFetch(`${API}/api/auth/2fa/backup-codes/regenerate`, {
        method: 'POST', body: JSON.stringify({ code: regenForm.code.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { showToast(formatApiDetail(data.detail) || 'Could not regenerate codes', false); return; }
      setBackupCodes(data.backup_codes || []);
      setRegenForm({ open: false, code: '' });
      showToast('New backup codes generated', true);
      await loadStatus();
    } finally { setBusy(false); }
  };
  const copyText = async (txt) => {
    try { await navigator.clipboard.writeText(txt); showToast('Copied to clipboard', true); }
    catch { showToast('Copy failed — select and copy manually', false); }
  };
  const enabled = !!status?.enabled;
  const required = !!status?.required_for_withdrawal;
  const remaining = status?.backup_codes_remaining ?? 0;
  const qrSrc = setup?.otpauth_url
    ? `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(setup.otpauth_url)}`
    : null;
  return (
    <div className="prof-panel">
      <div className="prof-panel__head flex-wrap">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <span className={`prof-panel__icon ${enabled ? 'prof-panel__icon--teal' : 'prof-panel__icon--orange'}`}>
            <KeyRound size={15} />
          </span>
          <div className="min-w-0">
            <h3 className="prof-panel__title">Two-factor authentication</h3>
            <p className="prof-panel__sub">
              Use an authenticator app to protect sign-in and withdrawals.
            </p>
            <div className="mt-2.5 flex items-center gap-2 flex-wrap">
              <span className={`pref-badge ${enabled ? 'pref-badge--on' : 'pref-badge--warn'}`}>
                {loading ? 'Checking…' : enabled ? 'Enabled' : 'Not enabled'}
              </span>
              {required ? (
                <span className="pref-badge pref-badge--set">Required for withdrawals</span>
              ) : null}
              {enabled ? (
                <span className="pref-badge pref-badge--muted">
                  {remaining} backup code{remaining === 1 ? '' : 's'} left
                </span>
              ) : null}
            </div>
          </div>
        </div>
        {!loading && !enabled && !setup ? (
          <button
            type="button"
            onClick={beginSetup}
            disabled={busy}
            className="wallet-action-primary shrink-0 disabled:opacity-50"
          >
            {busy ? 'Preparing…' : 'Enable 2FA'}
          </button>
        ) : null}
      </div>
      {setup && (
        <div className="rounded-xl p-4 sm:p-5 border border-[color:var(--ibo-border-solid)] bg-[color:var(--ibo-bg)] mt-1">
          <p className="text-sm text-[color:var(--ibo-ink-secondary)] mb-4 leading-relaxed">
            1. Scan the QR with your authenticator app (or paste the secret manually).<br />
            2. Enter the 6-digit code the app shows to finish enabling 2FA.
          </p>
          <div className="flex flex-wrap items-start gap-6">
            {qrSrc && (
              <img src={qrSrc} alt="2FA QR code" width={180} height={180}
                className="rounded-lg border border-[color:var(--ibo-border-solid)] bg-white p-2" />
            )}
            <div className="flex-1 min-w-[220px] space-y-3">
              <div>
                <p className="ibo-field-label !mb-1.5">Secret (base32)</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 font-mono text-sm text-[color:var(--ibo-ink)] bg-[color:var(--ibo-bg)] border border-[color:var(--ibo-border-solid)] rounded-lg px-3 py-2 break-all">
                    {setup.secret_b32}
                  </code>
                  <button onClick={() => copyText(setup.secret_b32)} type="button"
                    className="p-2 rounded-lg border border-[color:var(--ibo-border-solid)] text-[color:var(--ibo-muted)] hover:text-[#FE6C02]">
                    <Copy size={14} />
                  </button>
                </div>
              </div>
              <div>
                <p className="ibo-field-label !mb-1.5">6-digit code</p>
                <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  inputMode="numeric" autoComplete="one-time-code" placeholder="123456"
                  className="wallet-field font-mono tracking-widest text-lg" />
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={verifySetup} disabled={busy || code.length !== 6}
                  className="wallet-action-primary disabled:opacity-40">
                  {busy ? 'Verifying…' : 'Verify & enable'}
                </button>
                <button type="button" onClick={cancelSetup} disabled={busy}
                  className="wallet-action-ghost">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {backupCodes && (
        <div className="rounded-xl p-4 sm:p-5 border border-[rgba(245,158,11,0.4)] bg-[rgba(245,158,11,0.08)] mt-1">
          <p className="text-sm font-semibold text-[#f59e0b] flex items-center gap-2 mb-2">
            <AlertCircle size={14} /> Save these backup codes now — they won&apos;t be shown again.
          </p>
          <p className="text-xs text-[color:var(--ibo-muted)] mb-3">
            Each code works once. Use them to sign in / disable 2FA if you lose your authenticator.
          </p>
          <div className="grid grid-cols-2 gap-2 font-mono text-sm mb-3">
            {backupCodes.map((c) => (
              <code key={c} className="px-3 py-2 bg-[color:var(--ibo-bg)] border border-[color:var(--ibo-border-solid)] rounded-lg text-[color:var(--ibo-ink)] tracking-widest">
                {c}
              </code>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => copyText(backupCodes.join('\n'))}
              className="wallet-action-ghost text-xs">
              <Copy size={12} /> Copy all
            </button>
            <button type="button" onClick={() => setBackupCodes(null)}
              className="wallet-action-ghost text-xs">
              I&apos;ve saved them
            </button>
          </div>
        </div>
      )}
      {enabled && !setup && !backupCodes && (
        <div className="flex flex-wrap gap-2 pt-1">
          <button type="button" onClick={() => setRegenForm({ open: !regenForm.open, code: '' })}
            className="wallet-action-ghost text-sm">
            <RefreshCw size={14} /> Regenerate backup codes
          </button>
          <button type="button" onClick={() => setDisableForm({ open: !disableForm.open, password: '', code: '' })}
            className="wallet-action-ghost !text-[#F6465D] hover:!border-[#F6465D]/40 text-sm">
            Disable 2FA
          </button>
        </div>
      )}
      {regenForm.open && (
        <div className="rounded-xl p-4 border border-[color:var(--ibo-border-solid)] bg-[color:var(--ibo-bg)] space-y-3 mt-1">
          <p className="text-sm text-[color:var(--ibo-ink-secondary)]">
            Enter a current 6-digit code (or unused backup code) to mint a new set. All previous backup codes will stop working.
          </p>
          <input value={regenForm.code} onChange={(e) => setRegenForm(f => ({ ...f, code: e.target.value }))}
            placeholder="Authenticator or backup code"
            className="wallet-field" />
          <div className="flex gap-2">
            <button type="button" onClick={submitRegen} disabled={busy}
              className="wallet-action-primary disabled:opacity-40">
              {busy ? 'Working…' : 'Regenerate'}
            </button>
            <button type="button" onClick={() => setRegenForm({ open: false, code: '' })} disabled={busy}
              className="wallet-action-ghost">
              Cancel
            </button>
          </div>
        </div>
      )}
      {disableForm.open && (
        <div className="rounded-xl p-4 border border-[rgba(246,70,93,0.35)] bg-[rgba(246,70,93,0.06)] space-y-3 mt-1">
          <p className="text-sm text-[#F6465D] font-semibold m-0">Disable two-factor authentication</p>
          <p className="text-xs text-[color:var(--ibo-muted)] m-0">Requires your current password AND a 2FA / backup code.</p>
          <input value={disableForm.password} onChange={(e) => setDisableForm(f => ({ ...f, password: e.target.value }))}
            type="password" autoComplete="current-password" placeholder="Current password"
            className="wallet-field" />
          <input value={disableForm.code} onChange={(e) => setDisableForm(f => ({ ...f, code: e.target.value }))}
            placeholder="Authenticator or backup code"
            className="wallet-field" />
          <div className="flex gap-2">
            <button type="button" onClick={submitDisable} disabled={busy}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-semibold text-white bg-[#F6465D] hover:bg-[#e03d52] disabled:opacity-40">
              {busy ? 'Working…' : 'Disable 2FA'}
            </button>
            <button type="button" onClick={() => setDisableForm({ open: false, password: '', code: '' })} disabled={busy}
              className="wallet-action-ghost">
              Cancel
            </button>
          </div>
        </div>
      )}
      {toast && <Toast msg={toast.msg} ok={toast.ok} />}
    </div>
  );
}

// ── "Log out of all devices" card ───────────────────────────────────────────

function SessionsCard() {
  const { revokeAllSessions } = useAuth();
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const showToast = (msg, ok) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 4000); };
  const onRevoke = async () => {
    setBusy(true);
    try {
      await revokeAllSessions();
      showToast('All sessions revoked — please sign in again', true);
      // Local session is also killed by the epoch bump on the backend.
      setTimeout(() => { window.location.href = '/login'; }, 600);
    } catch (e) {
      showToast(e?.message || 'Could not revoke sessions', false);
      setBusy(false);
    }
  };
  return (
    <div className="prof-panel prof-panel--danger">
      <div className="prof-panel__head">
        <span className="prof-panel__icon prof-panel__icon--red">
          <LogOut size={15} />
        </span>
        <div className="min-w-0">
          <h3 className="prof-panel__title">Active sessions</h3>
          <p className="prof-panel__sub">
            Sign out of every device. Useful if you suspect unauthorized access.
          </p>
        </div>
      </div>
      {!confirming ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="prof-danger-btn"
        >
          Log out of all devices
        </button>
      ) : (
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={onRevoke}
            disabled={busy}
            className="prof-danger-btn disabled:opacity-50"
          >
            {busy ? 'Revoking…' : 'Yes, log out everywhere'}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={busy}
            className="wallet-action-ghost shrink-0"
          >
            Cancel
          </button>
        </div>
      )}
      {toast ? <Toast msg={toast.msg} ok={toast.ok} /> : null}
    </div>
  );
}

export default function ProfilePage({ accountMode = false, forcedTab = null } = {}) {
  const { user, updateUser } = useAuth();
  const [activeTab, setActiveTab] = useState(
    forcedTab === 'security' || forcedTab === 'profile' ? forcedTab : 'profile',
  );

  useEffect(() => {
    if (forcedTab === 'security' || forcedTab === 'profile') {
      setActiveTab(forcedTab);
    }
  }, [forcedTab]);

  const TABS = [
    { id: 'profile',  label: 'Profile', icon: User },
    { id: 'security', label: 'Security', icon: Lock },
  ];

  const tabMeta = TABS.find((t) => t.id === activeTab) || TABS[0];
  const TabIcon = tabMeta.icon;

  const workspace = (
    <motion.div
      key={activeTab}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className="w-full min-w-0"
    >
      {activeTab === 'profile' ? <ProfileTab user={user} updateUser={updateUser} /> : null}
      {activeTab === 'security' ? <SecurityTab /> : null}
    </motion.div>
  );

  const rail = (
    <nav
      className="wallet-surface p-1.5 sm:p-2 flex lg:flex-col gap-1 overflow-x-auto scrollbar-hide"
      aria-label="Profile sections"
    >
      {TABS.map((t) => {
        const Icon = t.icon;
        const active = activeTab === t.id;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => setActiveTab(t.id)}
            className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-sm font-semibold whitespace-nowrap transition-colors shrink-0 lg:w-full ${
              active
                ? 'bg-[#FE6C02]/12 text-[#FE6C02]'
                : 'text-[color:var(--ibo-muted)] hover:text-[color:var(--ibo-ink)] hover:bg-white/[0.03]'
            }`}
          >
            <Icon size={16} strokeWidth={2.1} className="shrink-0" />
            <span className="truncate">{t.label}</span>
          </button>
        );
      })}
    </nav>
  );

  const tabSubtitle =
    activeTab === 'security'
      ? 'Password, 2FA, and active sessions'
      : 'Avatar, contact details, and identity';

  if (accountMode) {
    /* Account shell already has page title; hide rail when a single tab is forced. */
    if (forcedTab === 'profile' || forcedTab === 'security') {
      return (
        <div className="profile-hub font-ui min-w-0 space-y-4">
          <div className="delta-account-toolbar !mb-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="prof-panel__icon prof-panel__icon--orange !w-9 !h-9">
                <TabIcon size={16} />
              </span>
              <div className="min-w-0">
                <h2 className="!text-[15px] !font-semibold !m-0 text-[color:var(--ibo-ink)] truncate">
                  {tabMeta.label}
                </h2>
                <p className="text-[11px] text-[color:var(--ibo-muted)] m-0 mt-0.5 truncate">
                  {tabSubtitle}
                </p>
              </div>
            </div>
          </div>
          {workspace}
        </div>
      );
    }
    return (
      <div className="profile-hub font-ui min-w-0 space-y-4">
        <div className="delta-account-toolbar !mb-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="prof-panel__icon prof-panel__icon--orange !w-9 !h-9">
              <User size={16} />
            </span>
            <div className="min-w-0">
              <h2 className="!text-[15px] !font-semibold !m-0 text-[color:var(--ibo-ink)] truncate">
                Profile &amp; security
              </h2>
              <p className="text-[11px] text-[color:var(--ibo-muted)] m-0 mt-0.5 truncate">
                Manage identity and account protection
              </p>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          <aside className="lg:col-span-3 xl:col-span-2 lg:sticky lg:top-4">{rail}</aside>
          <div className="lg:col-span-9 xl:col-span-10 min-w-0">{workspace}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="ibo-page font-ui profile-hub relative">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[280px] opacity-90"
        style={{
          background:
            'radial-gradient(ellipse 70% 60% at 8% -10%, rgba(254,108,2,0.12), transparent 55%), radial-gradient(ellipse 40% 40% at 92% 10%, rgba(14,203,129,0.04), transparent 50%)',
        }}
      />
      <div className="relative w-full px-4 sm:px-5 md:px-6 lg:px-8 xl:px-10 2xl:px-12 pt-5 sm:pt-7 pb-16">
        <div className="w-full max-w-7xl mx-auto min-w-0">
          <header className="mb-5 sm:mb-6 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#FE6C02]">
                Account
              </p>
              <h1 className="mt-1.5 text-[1.75rem] sm:text-[2rem] font-bold tracking-tight text-[color:var(--ibo-ink)] leading-none flex items-center gap-2.5">
                <User className="text-[#FE6C02] shrink-0" size={24} strokeWidth={2.25} />
                Profile &amp; security
              </h1>
              <p className="mt-2 text-sm text-[color:var(--ibo-muted)] truncate max-w-full">
                {user?.email}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <Link to="/account/refer" className="wallet-action-ghost">
                <Gift size={14} /> Refer
              </Link>
              <Link to="/account/kyc" className="wallet-action-primary">
                <Shield size={14} /> KYC
              </Link>
            </div>
          </header>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 lg:gap-7 items-start">
            <aside className="lg:col-span-3 xl:col-span-2 lg:sticky lg:top-20">{rail}</aside>
            <div className="lg:col-span-9 xl:col-span-10 min-w-0">
              <div className="mb-4 flex items-center gap-2 text-[color:var(--ibo-ink-secondary)]">
                <TabIcon size={15} className="text-[#FE6C02] shrink-0" />
                <h2 className="text-sm font-bold text-[color:var(--ibo-ink)]">{tabMeta.label}</h2>
              </div>
              {workspace}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
