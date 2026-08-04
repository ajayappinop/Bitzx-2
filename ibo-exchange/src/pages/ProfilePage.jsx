import { useState, useEffect, useRef } from 'react';

import { Link } from 'react-router-dom';

import { motion } from 'framer-motion';

import {

  User, Lock, Shield, CheckCircle, AlertCircle,

  ChevronRight, Edit2, Eye, EyeOff, Mail, Phone,

  Camera, Trash2, Globe, FileText, Copy, RefreshCw, LogOut, KeyRound, Gift,

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



const API = exchangeApiOrigin(import.meta.env.VITE_BACKEND_URL);



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

      className="ibo-btn-accent flex-shrink-0 !rounded-xl px-3 sm:px-4 py-3.5 text-xs sm:text-sm disabled:opacity-40 disabled:pointer-events-none"

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

    <div>

      <label className="block text-xs font-semibold text-ink mb-2 tracking-wide">

        {label}

        {required && <span className="text-red-400 ml-1">*</span>}

      </label>

      {children}

      {err && <p className="text-xs text-red-400 mt-1.5 font-semibold">{err}</p>}

      {hint && !err && <p className="text-xs text-ink-muted mt-1.5">{hint}</p>}

    </div>

  );

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

      country: user.country || '',

      bio: user.bio || '',

    });

    setPhoneOtp('');

    setPhoneOtpSent(false);

  }, [user, countryCode]);



  const mobileDigits = form.mobile.replace(/\D/g, '');

  const phoneChanged = mobileDigits !== baselineMobile.replace(/\D/g, '');

  const mobileValid = !validateSignupMobile(mobileDigits);



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

    form.country.trim() !== (user?.country || '') ||

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

    <div className="space-y-8 w-full">

      {/* Photo + account meta (left on large screens) — no duplicate name/email; those are in the page title + form */}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8">

        <div

          className="lg:col-span-4 flex flex-col gap-4 p-5 sm:p-6 rounded-2xl h-fit lg:sticky lg:top-24 ibo-account-panel"

        >

          <p className="ibo-field-label !mb-0">Profile photo</p>

          <div className="flex justify-center lg:justify-start">

            <div

              className="relative w-32 h-32 rounded-2xl overflow-hidden flex items-center justify-center

                text-3xl font-extrabold text-gold-light select-none ring-2 ring-gold/35"

              style={{ background: 'linear-gradient(135deg, rgba(254, 108, 2,0.3), rgba(0, 168, 118,0.1))' }}

            >

              {avatarSrc ? (

                <img src={avatarSrc} alt="" className="w-full h-full object-cover" />

              ) : (

                initials

              )}

              {uploading && (

                <div className="absolute inset-0 bg-black/50 flex items-center justify-center">

                  <span className="w-8 h-8 border-2 border-gold border-t-transparent rounded-full animate-spin" />

                </div>

              )}

            </div>

          </div>

          <div className="flex flex-wrap gap-2 justify-center lg:justify-start">

            <button

              type="button"

              disabled={uploading}

              onClick={() => fileRef.current?.click()}

              className="ibo-btn-accent !rounded-xl px-4 py-2 text-sm disabled:opacity-50"

            >

              <Camera size={16} /> {user?.avatar_url ? 'Change photo' : 'Upload photo'}

            </button>

            {user?.avatar_url && (

              <button

                type="button"

                disabled={uploading}

                onClick={removeAvatar}

                className="ibo-btn-outline !rounded-xl px-4 py-2 text-sm text-red-400 !border-red-500/30 hover:!bg-red-500/10 disabled:opacity-50"

              >

                <Trash2 size={16} /> Remove

              </button>

            )}

            <input

              ref={fileRef}

              type="file"

              accept="image/jpeg,image/png,image/webp"

              className="hidden"

              onChange={onPickFile}

            />

          </div>

          <p className="text-[11px] text-ink-muted text-center lg:text-left">

            JPG, PNG or WebP · max 100MB

          </p>

          <div className="h-px bg-[color:var(--ibo-border)]" />

          <div>

            <p className="ibo-field-label">Account ID</p>

            <p className="text-xs font-mono text-ink break-all">{user?.uid}</p>

          </div>

          <div

            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold w-fit"

            style={{ background: kycConf.bg, color: kycConf.text, border: `1px solid ${kycConf.border}` }}

          >

            <KycIcon size={12} /> {kycConf.label}

          </div>

          <p className="text-xs text-ink-muted">Standard account · 0.1% trading fee</p>

        </div>



        <div className="lg:col-span-8 space-y-6 min-w-0">

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">

        <FieldGroup label="Display Name" required error={showFieldError('name') ? fieldErrors.name : ''} hint="Your name as shown on the exchange">

          <div className={`flex items-center bg-surface-card border

            rounded-xl px-4 py-3.5 focus-within:border-gold/50 transition-colors group ${

              showFieldError('name') ? 'border-red-500/50' : 'border-surface-border'

            }`}>

            <User size={17} className="text-ink-muted mr-3 group-focus-within:text-gold transition-colors flex-shrink-0" />

            <input

              value={form.name}

              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}

              onBlur={() => {

                markTouched('name');

                setFieldErrors(prev => ({ ...prev, name: validateSingleField('name') }));

              }}

              placeholder="Your display name"

              required

              className="flex-1 min-w-0 bg-transparent text-base text-ink outline-none placeholder:text-ink-muted"

            />

          </div>

        </FieldGroup>



        <FieldGroup

          label="Mobile number"

          required

          error={showFieldError('phone') ? fieldErrors.phone : ''}

          hint={

            user?.phone && !phoneChanged

              ? `Current: ${user.phone}`

              : phoneChanged && smsOtpEnabled

                ? 'Verify your new number with SMS before saving.'

                : phoneChanged && !smsOtpEnabled

                  ? 'SMS verification is inactive — save now and verify later when SMS is enabled.'

                  : '10-digit mobile (India: starts with 6–9)'

          }

        >

          <div className="flex gap-2">

            <div className={`flex flex-1 min-w-0 items-center bg-surface-card border

              rounded-xl px-4 py-3.5 focus-within:border-gold/50 transition-colors group ${

                showFieldError('phone') ? 'border-red-500/50' : 'border-surface-border'

              }`}>

              <Phone size={17} className="text-ink-muted mr-3 group-focus-within:text-gold transition-colors flex-shrink-0" />

              <input

                value={form.mobile}

                onChange={e => {

                  const v = e.target.value.replace(/\D/g, '').slice(0, 10);

                  setForm(f => ({ ...f, mobile: v }));

                }}

                onBlur={() => {

                  markTouched('phone');

                  setFieldErrors(prev => ({ ...prev, phone: validateSingleField('phone') }));

                }}

                placeholder="9876543210"

                required

                inputMode="numeric"

                autoComplete="tel-national"

                className="flex-1 min-w-0 bg-transparent text-base text-ink outline-none placeholder:text-ink-muted"

              />

            </div>

            {phoneChanged && smsOtpEnabled && (

              <OtpSendButton

                label={phoneOtpSent ? 'Resend' : 'Send OTP'}

                loading={phoneSendLoading}

                disabled={!mobileValid}

                onClick={handleSendPhoneOtp}

              />

            )}

          </div>

        </FieldGroup>



        {phoneChanged && smsOtpEnabled && (

          <FieldGroup

            label="SMS verification code"

            required

            error={showFieldError('phoneOtp') ? fieldErrors.phoneOtp : ''}

            hint="Enter the 6-digit code sent to your new number"

          >

            <input

              value={phoneOtp}

              onChange={e => {

                setPhoneOtp(e.target.value.replace(/\D/g, '').slice(0, 6));

                setFieldErrors(prev => ({ ...prev, phoneOtp: '' }));

              }}

              onBlur={() => markTouched('phoneOtp')}

              placeholder="123456"

              inputMode="numeric"

              autoComplete="one-time-code"

              className={`w-full bg-surface-card border rounded-xl px-4 py-3.5 text-base text-white font-mono tracking-widest outline-none focus:border-gold/50 ${

                showFieldError('phoneOtp') ? 'border-red-500/50' : 'border-surface-border'

              }`}

            />

          </FieldGroup>

        )}



        <FieldGroup label="Country / Region" required error={showFieldError('country') ? fieldErrors.country : ''}>

          <div className={`flex items-center bg-surface-card border

            rounded-xl px-4 py-3.5 focus-within:border-gold/50 transition-colors group ${

              showFieldError('country') ? 'border-red-500/50' : 'border-surface-border'

            }`}>

            <Globe size={17} className="text-ink-muted mr-3 group-focus-within:text-gold transition-colors flex-shrink-0" />

            <input

              value={form.country}

              onChange={e => setForm(f => ({ ...f, country: e.target.value }))}

              onBlur={() => {

                markTouched('country');

                setFieldErrors(prev => ({ ...prev, country: validateSingleField('country') }));

              }}

              placeholder="United States"

              required

              autoComplete="country-name"

              className="flex-1 min-w-0 bg-transparent text-base text-ink outline-none placeholder:text-ink-muted"

            />

          </div>

        </FieldGroup>



        <FieldGroup label="Email Address">

          <div className="flex items-center bg-surface-card border border-surface-border

            rounded-xl px-4 py-3.5 gap-3">

            <Mail size={17} className="text-ink-muted flex-shrink-0" />

            <span className="flex-1 min-w-0 text-base text-ink truncate">{user?.email}</span>

            <span className="text-xs text-ink-muted bg-[color:var(--ibo-elevated)] px-2.5 py-1 rounded-lg flex-shrink-0">

              Read-only

            </span>

          </div>

        </FieldGroup>

          </div>



          <FieldGroup label="Bio" error={showFieldError('bio') ? fieldErrors.bio : ''} hint="Optional — a short line about you (max 500 characters)">

            <div className={`flex items-start bg-surface-card border

              rounded-xl px-4 py-3.5 focus-within:border-gold/50 transition-colors group ${

                showFieldError('bio') ? 'border-red-500/50' : 'border-surface-border'

              }`}>

              <FileText size={17} className="text-white mr-3 mt-0.5 group-focus-within:text-gold transition-colors flex-shrink-0" />

              <textarea

                value={form.bio}

                onChange={e => setForm(f => ({ ...f, bio: e.target.value }))}

                onBlur={() => {

                  markTouched('bio');

                  setFieldErrors(prev => ({ ...prev, bio: validateSingleField('bio') }));

                }}

                placeholder="Tell others a bit about your trading style…"

                rows={4}

                maxLength={500}

                className="flex-1 min-w-0 bg-transparent text-base text-ink outline-none placeholder:text-ink-muted resize-y min-h-[100px]"

              />

            </div>

          </FieldGroup>



          <div className="flex flex-col sm:flex-row gap-3 sm:items-center">

            <button

              type="button"

              onClick={handleSave}

              disabled={saving || !dirty}

              className="ibo-btn-primary px-8 py-3.5 disabled:opacity-40"

            >

              {saving ? (

                <span className="w-4 h-4 border-2 border-surface-dark border-t-transparent rounded-full animate-spin" />

              ) : (

                <><Edit2 size={15} /> Save profile</>

              )}

            </button>

            {!dirty && (

              <span className="text-sm text-ink-muted">No unsaved changes</span>

            )}

          </div>

        </div>

      </div>



      {toast && <Toast msg={toast.msg} ok={toast.ok} />}



      {user?.kyc_status !== 'approved' && (

        <div className="ibo-account-promo !items-start">

          <div className="flex items-start gap-4">

            <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 bg-gold/15 border border-gold/30">

              <Shield size={20} className="text-gold" />

            </div>

            <div className="flex-1 min-w-0">

              <p className="text-base font-display font-bold text-gold-light mb-1">Identity Verification</p>

              <p className="text-sm text-ink-secondary mb-4">

                Complete KYC to unlock spot trading, deposits, and withdrawals on Delta Exchange.

              </p>

              <Link to="/kyc" className="ibo-btn-accent !rounded-xl px-5 py-2.5 text-sm">

                Start Verification <ChevronRight size={15} />

              </Link>

            </div>

          </div>

        </div>

      )}

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

    <div className="space-y-8">

      <div className="space-y-5">

        {pwFields.map(({ key, label, placeholder, showKey, onBlur }) => (

          <FieldGroup key={key} label={label} error={showFieldError(key) ? fieldErrors[key] : ''}>

            <div className={`flex items-center bg-surface-card border rounded-xl px-4 py-3.5 focus-within:border-gold/50 transition-colors group ${

              showFieldError(key) ? 'border-red-500/50' : 'border-surface-border'

            }`}>

              <Lock size={17} className="text-ink-muted mr-3 group-focus-within:text-gold transition-colors" />

              <input

                type={showPw[showKey] ? 'text' : 'password'}

                value={form[key]}

                onChange={onPwdChange(key)}

                onBlur={onBlur}

                placeholder={placeholder}

                autoComplete={key === 'current_password' ? 'current-password' : 'new-password'}

                aria-invalid={Boolean(fieldErrors[key])}

                className="flex-1 bg-transparent text-base text-ink outline-none placeholder:text-ink-muted"

              />

              <button type="button" onClick={() => togglePw(showKey)}

                className="text-white hover:text-white transition-colors ml-2">

                {showPw[showKey] ? <EyeOff size={17} /> : <Eye size={17} />}

              </button>

            </div>

          </FieldGroup>

        ))}

      </div>



      {toast && <Toast msg={toast.msg} ok={toast.ok} />}



      <button onClick={handleChange}

        disabled={saving}

        className="flex items-center gap-2.5 px-8 py-4 bg-gold/90 hover:bg-gold

          text-surface-dark font-bold rounded-xl text-base transition-all disabled:opacity-40">

        {saving

          ? <span className="w-5 h-5 border-2 border-surface-dark border-t-transparent rounded-full animate-spin" />

          : <><Lock size={16} /> Update Password</>}

      </button>



      <TwoFactorCard />



      <SessionsCard />



      <div className="rounded-2xl p-6 space-y-3"

        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>

        <p className="text-base font-bold text-white flex items-center gap-2.5">

          <Shield size={16} className="text-gold" /> Security Recommendations

        </p>

        {[

          'Use a unique password that you don\'t use on other websites',

          'Include uppercase, lowercase letters, numbers and symbols',

          'Never share your password with anyone, including Delta support',

          'Turn on 2FA above and keep your backup codes in a safe place',

        ].map(tip => (

          <p key={tip} className="text-sm text-white flex items-start gap-3">

            <span className="text-gold mt-0.5 flex-shrink-0">✓</span> {tip}

          </p>

        ))}

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

    <div className="rounded-2xl p-6 space-y-5"

      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>

      <div className="flex items-start gap-4 flex-wrap">

        <div className="flex-1 min-w-0">

          <p className="text-base font-bold text-white flex items-center gap-2.5">

            <KeyRound size={16} className="text-gold" /> Two-Factor Authentication

          </p>

          <p className="text-sm text-ink-secondary mt-1">

            Use an authenticator app (Google Authenticator, Authy, 1Password, …) to protect sign-in and withdrawals.

          </p>

          <div className="mt-3 flex items-center gap-2 flex-wrap">

            <span className={`text-xs px-3 py-1 rounded-full border ${enabled

              ? 'border-green-500/30 text-green-400 bg-green-500/10'

              : 'border-gold-light/30 text-gold-light bg-gold-light/10'}`}>

              {loading ? 'Checking…' : enabled ? 'Enabled' : 'Not enabled'}

            </span>

            {required && (

              <span className="text-xs px-3 py-1 rounded-full border border-gold/30 text-gold bg-gold/10">

                Required for withdrawals

              </span>

            )}

            {enabled && (

              <span className="text-xs px-3 py-1 rounded-full border border-surface-border text-ink-secondary">

                {remaining} backup code{remaining === 1 ? '' : 's'} left

              </span>

            )}

          </div>

        </div>

        {!loading && !enabled && !setup && (

          <button onClick={beginSetup} disabled={busy}

            className="px-5 py-3 rounded-xl bg-gold/90 hover:bg-gold text-surface-dark text-sm font-bold disabled:opacity-50">

            {busy ? 'Preparing…' : 'Enable 2FA'}

          </button>

        )}

      </div>



      {setup && (

        <div className="rounded-xl p-5 border border-surface-border bg-surface-card/60">

          <p className="text-sm text-ink-secondary mb-4">

            1. Scan the QR with your authenticator app (or paste the secret manually).<br />

            2. Enter the 6-digit code the app shows to finish enabling 2FA.

          </p>

          <div className="flex flex-wrap items-start gap-6">

            {qrSrc && (

              <img src={qrSrc} alt="2FA QR code" width={180} height={180}

                className="rounded-lg border border-surface-border bg-white p-2" />

            )}

            <div className="flex-1 min-w-[220px] space-y-3">

              <div>

                <p className="text-xs uppercase tracking-wide text-white/50 mb-1">Secret (base32)</p>

                <div className="flex items-center gap-2">

                  <code className="flex-1 font-mono text-sm text-white bg-black/40 border border-surface-border rounded-lg px-3 py-2 break-all">

                    {setup.secret_b32}

                  </code>

                  <button onClick={() => copyText(setup.secret_b32)} type="button"

                    className="p-2 rounded-lg border border-surface-border text-ink-secondary hover:text-gold">

                    <Copy size={14} />

                  </button>

                </div>

              </div>

              <div>

                <p className="text-xs uppercase tracking-wide text-white/50 mb-1">6-digit code</p>

                <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}

                  inputMode="numeric" autoComplete="one-time-code" placeholder="123456"

                  className="w-full bg-black/40 border border-surface-border rounded-lg px-3 py-3 text-white font-mono tracking-widest text-lg outline-none focus:border-gold/50" />

              </div>

              <div className="flex items-center gap-2">

                <button onClick={verifySetup} disabled={busy || code.length !== 6}

                  className="px-4 py-2.5 rounded-lg bg-gold/90 hover:bg-gold text-surface-dark text-sm font-bold disabled:opacity-40">

                  {busy ? 'Verifying…' : 'Verify & enable'}

                </button>

                <button onClick={cancelSetup} disabled={busy}

                  className="px-4 py-2.5 rounded-lg border border-surface-border text-ink-secondary text-sm">

                  Cancel

                </button>

              </div>

            </div>

          </div>

        </div>

      )}



      {backupCodes && (

        <div className="rounded-xl p-5 border border-gold-light/30 bg-yellow-500/5">

          <p className="text-sm font-semibold text-gold-light flex items-center gap-2 mb-2">

            <AlertCircle size={14} /> Save these backup codes now — they won't be shown again.

          </p>

          <p className="text-xs text-ink-secondary mb-3">

            Each code works once. Use them to sign in / disable 2FA if you lose your authenticator.

          </p>

          <div className="grid grid-cols-2 gap-2 font-mono text-sm mb-3">

            {backupCodes.map((c) => (

              <code key={c} className="px-3 py-2 bg-black/40 border border-surface-border rounded-lg text-white tracking-widest">

                {c}

              </code>

            ))}

          </div>

          <div className="flex items-center gap-2">

            <button onClick={() => copyText(backupCodes.join('\n'))}

              className="px-3 py-2 rounded-lg border border-surface-border text-ink-secondary text-xs flex items-center gap-2">

              <Copy size={12} /> Copy all

            </button>

            <button onClick={() => setBackupCodes(null)}

              className="px-3 py-2 rounded-lg border border-surface-border text-ink-secondary text-xs">

              I've saved them

            </button>

          </div>

        </div>

      )}



      {enabled && !setup && !backupCodes && (

        <div className="flex flex-wrap gap-3 pt-1">

          <button onClick={() => setRegenForm({ open: !regenForm.open, code: '' })}

            className="px-4 py-2.5 rounded-lg border border-surface-border text-ink-secondary text-sm flex items-center gap-2">

            <RefreshCw size={14} /> Regenerate backup codes

          </button>

          <button onClick={() => setDisableForm({ open: !disableForm.open, password: '', code: '' })}

            className="px-4 py-2.5 rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/5 text-sm">

            Disable 2FA

          </button>

        </div>

      )}



      {regenForm.open && (

        <div className="rounded-xl p-4 border border-surface-border bg-surface-card/60 space-y-3">

          <p className="text-sm text-ink-secondary">

            Enter a current 6-digit code (or unused backup code) to mint a new set. All previous backup codes will stop working.

          </p>

          <input value={regenForm.code} onChange={(e) => setRegenForm(f => ({ ...f, code: e.target.value }))}

            placeholder="Authenticator or backup code"

            className="w-full bg-black/40 border border-surface-border rounded-lg px-3 py-2.5 text-white outline-none focus:border-gold/50" />

          <div className="flex gap-2">

            <button onClick={submitRegen} disabled={busy}

              className="px-4 py-2 rounded-lg bg-gold/90 hover:bg-gold text-surface-dark text-sm font-bold disabled:opacity-40">

              {busy ? 'Working…' : 'Regenerate'}

            </button>

            <button onClick={() => setRegenForm({ open: false, code: '' })} disabled={busy}

              className="px-4 py-2 rounded-lg border border-surface-border text-ink-secondary text-sm">

              Cancel

            </button>

          </div>

        </div>

      )}



      {disableForm.open && (

        <div className="rounded-xl p-4 border border-red-500/30 bg-red-500/5 space-y-3">

          <p className="text-sm text-red-300 font-semibold">Disable two-factor authentication</p>

          <p className="text-xs text-ink-secondary">Requires your current password AND a 2FA / backup code.</p>

          <input value={disableForm.password} onChange={(e) => setDisableForm(f => ({ ...f, password: e.target.value }))}

            type="password" autoComplete="current-password" placeholder="Current password"

            className="w-full bg-black/40 border border-surface-border rounded-lg px-3 py-2.5 text-white outline-none focus:border-red-500/50" />

          <input value={disableForm.code} onChange={(e) => setDisableForm(f => ({ ...f, code: e.target.value }))}

            placeholder="Authenticator or backup code"

            className="w-full bg-black/40 border border-surface-border rounded-lg px-3 py-2.5 text-white outline-none focus:border-red-500/50" />

          <div className="flex gap-2">

            <button onClick={submitDisable} disabled={busy}

              className="px-4 py-2 rounded-lg bg-red-500/80 hover:bg-red-500 text-white text-sm font-bold disabled:opacity-40">

              {busy ? 'Working…' : 'Disable 2FA'}

            </button>

            <button onClick={() => setDisableForm({ open: false, password: '', code: '' })} disabled={busy}

              className="px-4 py-2 rounded-lg border border-surface-border text-ink-secondary text-sm">

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

    <div className="rounded-2xl p-6 space-y-3"

      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>

      <p className="text-base font-bold text-white flex items-center gap-2.5">

        <LogOut size={16} className="text-gold" /> Active sessions

      </p>

      <p className="text-sm text-ink-secondary">

        Sign out of every device where you're currently logged in. Useful if you've misplaced a device or suspect your account has been accessed.

      </p>

      {!confirming ? (

        <button onClick={() => setConfirming(true)}

          className="px-4 py-2.5 rounded-lg border border-surface-border text-ink-secondary text-sm flex items-center gap-2 hover:border-red-500/40 hover:text-red-300">

          Log out of all devices

        </button>

      ) : (

        <div className="flex items-center gap-2 flex-wrap">

          <button onClick={onRevoke} disabled={busy}

            className="px-4 py-2.5 rounded-lg bg-red-500/80 hover:bg-red-500 text-white text-sm font-bold disabled:opacity-50">

            {busy ? 'Revoking…' : 'Yes, log out everywhere'}

          </button>

          <button onClick={() => setConfirming(false)} disabled={busy}

            className="px-4 py-2.5 rounded-lg border border-surface-border text-ink-secondary text-sm">

            Cancel

          </button>

        </div>

      )}

      {toast && <Toast msg={toast.msg} ok={toast.ok} />}

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
    { id: 'profile',  label: 'Profile Info', icon: User },
    { id: 'security', label: 'Security',      icon: Lock },
  ];

  const body = (
    <>
      {!accountMode || !forcedTab ? (
        <div className={`flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-surface-border pb-0 mb-6 w-full min-w-0${accountMode ? '' : ''}`}>
          <div className="flex gap-1 overflow-x-auto scrollbar-hide -mb-px flex-1 min-w-0">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                className={`flex items-center gap-2 px-4 sm:px-5 py-3 text-sm font-bold flex-shrink-0 ${
                  activeTab === id ? 'ibo-tab-active' : 'ibo-tab-idle'
                }`}
              >
                <Icon size={15} /> {label}
              </button>
            ))}
          </div>
          {!accountMode ? (
            <div className="flex items-center gap-2 shrink-0 mb-3 sm:mb-0">
              <Link to="/account/refer" className="ibo-btn-accent !rounded-lg px-3 py-2 text-xs sm:text-sm">
                <Gift size={14} /> Refer & Earn
              </Link>
              <Link to="/account/kyc" className="ibo-btn-outline !rounded-lg px-3 py-2 text-xs sm:text-sm">
                <Shield size={14} /> KYC
              </Link>
            </div>
          ) : null}
        </div>
      ) : null}

      <motion.div
        key={activeTab}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className={`w-full min-w-0 ${accountMode ? '' : 'ibo-account-panel !p-5 sm:!p-8'}`}
      >
        {activeTab === 'profile' && <ProfileTab user={user} updateUser={updateUser} />}
        {activeTab === 'security' && <SecurityTab />}
      </motion.div>
    </>
  );

  if (accountMode) {
    return <div className="font-ui min-w-0">{body}</div>;
  }

  return (
    <div className="ibo-page font-ui">
      <div className="w-full px-4 sm:px-5 md:px-6 lg:px-8 xl:px-10 2xl:px-12 py-6 sm:py-8 pb-16">
        <div className="ibo-account-hero">
          <p className="ibo-eyebrow mb-1.5">Account</p>
          <h1 className="ibo-account-title">Profile &amp; security</h1>
          <p className="ibo-account-subtitle truncate">{user?.email}</p>
        </div>
        {body}
      </div>
    </div>
  );
}

