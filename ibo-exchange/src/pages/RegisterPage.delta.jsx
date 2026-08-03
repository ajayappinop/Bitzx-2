/**
 * PARKED � Delta Exchange�inspired auth UI (temporarily disabled).
 * Not imported by routes. Keep for later; do not delete.
 * Active pages: LoginPage.jsx / RegisterPage.jsx / AuthShell.jsx (classic).
 */
import { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Eye, EyeOff, Lock, Mail, User, Phone, CheckCircle, Gift, AlertCircle,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import {
  validateRegisterFields,
  validateRegisterName,
  validateRegisterConfirm,
  firstRegisterError,
} from '@/lib/profileValidation';
import {
  getPasswordStrengthMeta,
  validateAuthEmail,
  validateStrongPassword,
  validateSignupMobile,
  authFormBannerMessage,
  isAuthRequestError,
} from '@/lib/authValidation';
import { useSignupOtpConfig } from '@/hooks/useSignupOtpConfig';
import { SITE_CONFIG } from '@/lib/siteConfig';
import {
  captureReferralCodeFromUrl,
  getStoredReferralCode,
  setStoredReferralCode,
} from '@/lib/referral';
import AuthShell, {
  AuthSocialRow,
  AuthPrimaryButton,
  AuthComplianceNote,
  AuthAppDownload,
  AuthPromoPanel,
} from '@/components/auth/AuthShell';

const emptyRegisterFieldErrors = () => ({
  name: '', email: '', mobile: '', password: '', confirm: '', terms: '', residency: '', emailOtp: '', smsOtp: '',
});

function OtpSendButton({ label, loading, disabled, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      className="flex-shrink-0 px-3 sm:px-4 h-12 rounded-xl text-xs sm:text-sm font-bold
        border border-[#0ea4ab]/40 text-[#C5E35B] bg-[#0ea4ab]/10
        hover:bg-[#0ea4ab]/20 active:scale-[0.98] transition-all disabled:opacity-40 disabled:pointer-events-none"
    >
      {loading ? (
        <span className="inline-block w-4 h-4 border-2 border-[#C5E35B] border-t-transparent rounded-full animate-spin" />
      ) : (
        label
      )}
    </button>
  );
}

export default function RegisterPage() {
  const {
    registerRequest,
    registerMobileSendOtp,
    registerVerifyEmail,
    registerVerifyMobile,
    registerComplete,
    registerResend,
  } = useAuth();
  const navigate = useNavigate();

  // ── OTP service flags (from /api/public/site-config) ─────────────────────
  const {
    loaded: serviceConfigLoaded,
    emailOtpEnabled,
    smsOtpEnabled,
    defaultCountryCode,
  } = useSignupOtpConfig();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [mobile, setMobile] = useState('');
  const [countryCode, setCountryCode] = useState('91');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [agree, setAgree] = useState(false);
  const [residency, setResidency] = useState(false);
  const [loading, setLoading] = useState(false);
  const [emailOtp, setEmailOtp] = useState('');
  const [smsOtp, setSmsOtp] = useState('');
  const [emailOtpSent, setEmailOtpSent] = useState(false);
  const [emailVerified, setEmailVerified] = useState(false);
  const [smsOtpSent, setSmsOtpSent] = useState(false);
  const [smsVerified, setSmsVerified] = useState(false);
  const [phoneHint, setPhoneHint] = useState('');
  const [success, setSuccess] = useState('');
  const [emailSendLoading, setEmailSendLoading] = useState(false);
  const [emailVerifyLoading, setEmailVerifyLoading] = useState(false);
  const [smsSendLoading, setSmsSendLoading] = useState(false);
  const [smsVerifyLoading, setSmsVerifyLoading] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState(emptyRegisterFieldErrors);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [touched, setTouched] = useState({
    name: false,
    email: false,
    mobile: false,
    password: false,
    confirm: false,
    terms: false,
  });
  const [referralCode, setReferralCode] = useState('');
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const preset = (searchParams.get('email') || '').trim();
    if (preset) setEmail(preset);
  }, [searchParams]);

  useEffect(() => {
    captureReferralCodeFromUrl();
    setReferralCode(getStoredReferralCode());
  }, []);

  useEffect(() => {
    if (defaultCountryCode) setCountryCode(defaultCountryCode);
  }, [defaultCountryCode]);

  const showFieldError = key => Boolean(fieldErrors[key]) && (submitAttempted || touched[key]);
  const strengthMeta = getPasswordStrengthMeta(password);

  const emailTrimmed = email.trim();
  const emailValidForOtp = !validateAuthEmail(emailTrimmed);
  const mobileDigits = mobile.replace(/\D/g, '');
  let mobileNat = mobileDigits;
  if (mobileNat.length === 12 && mobileNat.startsWith('91')) mobileNat = mobileNat.slice(2);
  const mobileValidForOtp = mobileNat.length === 10 && !validateSignupMobile(mobile);

  const validateSignupForm = () => {
    const nm = name.trim();
    const em = emailTrimmed;
    const mob = mobile.trim();
    const errs = emptyRegisterFieldErrors();
    if (smsOtpEnabled) {
      if (!mob) errs.mobile = 'Mobile number is required.';
      else {
        const mobErr = validateSignupMobile(mob);
        if (mobErr) errs.mobile = mobErr;
      }
    } else if (mob) {
      const mobErr = validateSignupMobile(mob);
      if (mobErr) errs.mobile = mobErr;
    }
    const regErr = validateRegisterFields({ name: nm, email: em, password });
    Object.assign(errs, regErr);
    const cErr = validateRegisterConfirm(password, confirm);
    if (cErr) errs.confirm = cErr;
    if (!agree) errs.terms = 'Please accept the Terms of Service.';
    if (!residency) errs.residency = 'Please confirm your residency declaration.';
    const filtered = Object.fromEntries(Object.entries(errs).filter(([, v]) => v));
    return { nm, em, mob, errs: filtered };
  };

  const resetEmailVerification = () => {
    setEmailOtpSent(false);
    setEmailVerified(false);
    setEmailOtp('');
  };

  const resetSmsVerification = () => {
    setSmsOtpSent(false);
    setSmsVerified(false);
    setSmsOtp('');
    setPhoneHint('');
  };

  const linkContact = () => ({
    mobile: mobileDigits || undefined,
    email: emailTrimmed || undefined,
    countryCode: countryCode || undefined,
  });

  const handleSendEmailOtp = async () => {
    setError('');
    setSuccess('');
    const em = emailTrimmed;
    const emailErr = validateAuthEmail(em);
    if (emailErr) {
      setFieldErrors(f => ({ ...emptyRegisterFieldErrors(), email: emailErr }));
      setTouched(t => ({ ...t, email: true }));
      return;
    }

    setEmailSendLoading(true);
    try {
      setStoredReferralCode(referralCode);
      if (emailOtpSent && !emailVerified) {
        await registerResend(em, 'email');
        setEmailOtp('');
        setSuccess('A new code has been sent to your email.');
      } else {
        const { mobile: mob, countryCode: cc } = linkContact();
        const data = await registerRequest(em, mob, cc);
        setEmailOtpSent(true);
        if (data.phone_hint) setPhoneHint(data.phone_hint);
        setEmailOtp('');
        setSuccess(data.message || 'Verification code sent to your email.');
      }
    } catch (err) {
      if (isAuthRequestError(err) && err.fieldErrors) {
        setFieldErrors({
          ...emptyRegisterFieldErrors(),
          name: err.fieldErrors.name || '',
          email: err.fieldErrors.email || '',
          mobile: err.fieldErrors.mobile || err.fieldErrors.phone || '',
          password: err.fieldErrors.password || '',
        });
        setError(err.message);
      } else {
        setError(err.message || 'Could not send email code.');
      }
    } finally {
      setEmailSendLoading(false);
    }
  };

  const handleVerifyEmailOtp = async () => {
    setError('');
    setSuccess('');
    const em = email.trim();
    if (!emailOtp || emailOtp.trim().length < 6) {
      setFieldErrors(f => ({ ...f, emailOtp: 'Enter the 6-digit email code' }));
      return;
    }
    setFieldErrors(f => ({ ...f, emailOtp: '' }));
    setEmailVerifyLoading(true);
    try {
      const data = await registerVerifyEmail(em, emailOtp.trim());
      setEmailVerified(true);
      setSuccess(data?.message || 'Email verified.');
    } catch (err) {
      setError(err.message || 'Invalid email code.');
    } finally {
      setEmailVerifyLoading(false);
    }
  };

  const handleSendSmsOtp = async () => {
    setError('');
    setSuccess('');
    const mobErr = validateSignupMobile(mobile);
    if (mobErr || !mobileValidForOtp) {
      setFieldErrors(f => ({
        ...emptyRegisterFieldErrors(),
        mobile: mobErr || 'Enter a valid 10-digit mobile number.',
      }));
      setTouched(t => ({ ...t, mobile: true }));
      return;
    }
    setSmsSendLoading(true);
    try {
      const em = emailTrimmed;
      let data;
      if (smsOtpSent && !smsVerified && em) {
        data = await registerResend(em, 'sms');
      } else {
        data = await registerMobileSendOtp(mobileDigits, em || undefined, countryCode);
      }
      if (data.phone_hint) setPhoneHint(data.phone_hint);
      setSmsOtpSent(true);
      setSmsOtp('');
      setSuccess(data.message || 'SMS code sent.');
    } catch (err) {
      setError(err.message || 'Could not send SMS code.');
    } finally {
      setSmsSendLoading(false);
    }
  };

  const handleVerifySmsOtp = async () => {
    setError('');
    setSuccess('');
    if (!smsOtp || smsOtp.trim().length < 6) {
      setFieldErrors(f => ({ ...f, smsOtp: 'Enter the 6-digit SMS code' }));
      return;
    }
    setFieldErrors(f => ({ ...f, smsOtp: '' }));
    setSmsVerifyLoading(true);
    try {
      const data = await registerVerifyMobile(
        emailTrimmed,
        mobileDigits,
        countryCode,
        smsOtp.trim(),
      );
      setSmsVerified(true);
      setSuccess(data?.message || 'Mobile verified.');
    } catch (err) {
      setError(err.message || 'Invalid SMS code.');
    } finally {
      setSmsVerifyLoading(false);
    }
  };

  const handleCreateAccount = async e => {
    e.preventDefault();
    setSubmitAttempted(true);
    setError('');
    setSuccess('');

    if (emailOtpEnabled && !emailVerified) {
      setError('Verify your email with the code we sent.');
      return;
    }
    if (smsOtpEnabled && !smsVerified) {
      setError('Verify your mobile with the SMS code we sent.');
      return;
    }

    const { nm, em, mob, errs } = validateSignupForm();
    if (Object.keys(errs).length) {
      setFieldErrors({ ...emptyRegisterFieldErrors(), ...errs });
      setError(firstRegisterError(errs) || authFormBannerMessage(errs, 'Please fix the highlighted fields.'));
      return;
    }

    setLoading(true);
    try {
      // When email OTP is disabled the frontend skips Send OTP; create the
      // pending record without marking email verified (verify later in Profile).
      if (!emailOtpEnabled && !emailOtpSent) {
        const emailErr = validateAuthEmail(em);
        if (emailErr) {
          setFieldErrors(f => ({ ...f, email: emailErr }));
          setError(emailErr);
          setLoading(false);
          return;
        }
        await registerRequest(em, mob || undefined, mob ? countryCode : undefined);
        setEmailOtpSent(true);
      }

      const mobToSend = mob.trim() || undefined;
      const ccToSend = mobToSend ? countryCode : undefined;
      setStoredReferralCode(referralCode);
      await registerComplete(nm, em, password, mobToSend, ccToSend);
      navigate('/kyc', { replace: true, state: { justRegistered: true } });
    } catch (err) {
      if (isAuthRequestError(err) && err.fieldErrors) {
        setFieldErrors({
          ...emptyRegisterFieldErrors(),
          name: err.fieldErrors.name || '',
          email: err.fieldErrors.email || '',
          mobile: err.fieldErrors.mobile || err.fieldErrors.phone || '',
          password: err.fieldErrors.password || '',
        });
      }
      setError(err.message || 'Could not create account.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      maxWidthClass="max-w-lg"
      side={
        <AuthPromoPanel
          title={<>Create your trading account</>}
          subtitle="Join IBO Exchange for spot markets, INR-ready funding, and a secure KYC-backed platform built for India."
          items={[
            {
              title: 'INR deposit & withdraw',
              desc: 'Fund via bank or UPI and withdraw INR after selling — no crypto ownership required to start learning.',
            },
            {
              title: 'Compliant & secure',
              desc: '2FA, custody best practices, and identity verification for safer trading.',
            },
            {
              title: 'Pro tools for everyone',
              desc: 'TradingView charts, deep liquidity, and portfolio views in one terminal.',
            },
          ]}
        />
      }
    >
      <h1 className="font-display text-[1.85rem] sm:text-[2.1rem] font-bold text-white tracking-tight mb-1">
        Create Account
      </h1>
      <p className="text-[14px] text-zinc-400 mb-7">
        {serviceConfigLoaded && !emailOtpEnabled && !smsOtpEnabled
          ? 'Free demo · Verify email and phone later from Profile'
          : 'Free demo · No deposit required'}
      </p>

      <AuthSocialRow />

      {error ? (
        <div className="flex items-start gap-2.5 rounded-xl border border-red-500/25 bg-red-500/10 px-3.5 py-3 mb-5 text-sm text-red-300">
          <AlertCircle size={15} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      ) : null}
      {success ? (
        <div className="flex items-start gap-2.5 rounded-xl border border-green-500/25 bg-green-500/10 px-3.5 py-3 mb-5 text-sm text-green-300">
          <CheckCircle size={15} className="shrink-0 mt-0.5" />
          <span>{success}</span>
        </div>
      ) : null}

          <form noValidate onSubmit={handleCreateAccount} className="space-y-4">
            {/* Name + Email row */}
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-[13px] font-semibold text-zinc-300 mb-2">Full Name</label>
                <div className={`flex items-center rounded-xl border px-3.5 h-12 transition-colors group ${
                  showFieldError('name') ? 'border-red-500/50 bg-red-500/[0.04]' : 'border-white/[0.1] bg-white/[0.03] focus-within:border-[#0ea4ab]/50'
                }`}>
                  <User size={16} className="text-zinc-500 mr-2.5 group-focus-within:text-[#0ea4ab] transition-colors" />
                  <input
                    type="text"
                    value={name}
                    onChange={e => {
                      setName(e.target.value);
                      setFieldErrors(f => ({ ...f, name: '' }));
                      setError('');
                    }}
                    onBlur={() => {
                      setTouched(t => ({ ...t, name: true }));
                      if (!name.trim()) {
                        setFieldErrors(f => ({ ...f, name: '' }));
                        return;
                      }
                      const msg = validateRegisterName(name);
                      setFieldErrors(f => ({ ...f, name: msg || '' }));
                    }}
                    placeholder="John Doe"
                    autoComplete="name"
                    aria-invalid={Boolean(fieldErrors.name)}
                    className="flex-1 bg-transparent text-[15px] text-white outline-none placeholder:text-zinc-500"
                  />
                </div>
                {showFieldError('name') && (
                  <p className="text-xs text-red-400 mt-1.5 font-medium" role="alert">{fieldErrors.name}</p>
                )}
              </div>

              {/* ── Email field ── */}
              <div className="sm:col-span-2">
                <label className="block text-[13px] font-semibold text-zinc-300 mb-2">
                  Email
                  {serviceConfigLoaded && !emailOtpEnabled && (
                    <span className="ml-2 text-xs font-normal text-[#C5E35B]/90">(OTP verification currently inactive)</span>
                  )}
                </label>
                <div className="flex gap-2">
                  <div className={`flex-1 flex items-center rounded-xl border px-3.5 h-12 transition-colors group ${
                    showFieldError('email') ? 'border-red-500/50 bg-red-500/[0.04]' : 'border-white/[0.1] bg-white/[0.03] focus-within:border-[#0ea4ab]/50'
                  }`}>
                    <Mail size={16} className="text-zinc-500 mr-2.5 group-focus-within:text-[#0ea4ab] transition-colors" />
                    <input
                      type="email"
                      value={email}
                      disabled={emailVerified && emailOtpEnabled}
                      onChange={e => {
                        setEmail(e.target.value);
                        setFieldErrors(f => ({ ...f, email: '' }));
                        setError('');
                        setSuccess('');
                        if (emailOtpSent && emailOtpEnabled) resetEmailVerification();
                      }}
                      onBlur={() => {
                        setTouched(t => ({ ...t, email: true }));
                        const msg = validateAuthEmail(email);
                        setFieldErrors(f => ({ ...f, email: msg || '' }));
                      }}
                      placeholder="you@email.com"
                      autoComplete="email"
                      aria-invalid={Boolean(fieldErrors.email)}
                      className="flex-1 bg-transparent text-[15px] text-white outline-none placeholder:text-zinc-500 disabled:opacity-60"
                    />
                  </div>
                  {emailOtpEnabled && (
                    <OtpSendButton
                      label={emailOtpSent && !emailVerified ? 'Resend' : 'Send OTP'}
                      loading={emailSendLoading}
                      disabled={emailVerified || !emailValidForOtp}
                      onClick={handleSendEmailOtp}
                    />
                  )}
                </div>
                {showFieldError('email') && (
                  <p className="text-xs text-red-400 mt-1.5 font-medium" role="alert">{fieldErrors.email}</p>
                )}
                {emailVerified && emailOtpEnabled && (
                  <p className="text-xs text-green-400 mt-1.5 font-medium flex items-center gap-1">
                    <CheckCircle size={12} /> Email verified
                  </p>
                )}
                {emailOtpEnabled && emailOtpSent && !emailVerified && (
                  <div className="flex gap-2 mt-2">
                    <div className={`flex-1 flex items-center rounded-xl border px-3.5 h-12 ${
                      fieldErrors.emailOtp ? 'border-red-500/50 bg-red-500/[0.04]' : 'border-white/[0.1] bg-white/[0.03] focus-within:border-[#0ea4ab]/50'
                    }`}>
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        value={emailOtp}
                        onChange={e => {
                          setEmailOtp(e.target.value.replace(/\D/g, '').slice(0, 6));
                          setFieldErrors(f => ({ ...f, emailOtp: '' }));
                        }}
                        placeholder="Email OTP (6 digits)"
                        autoComplete="one-time-code"
                        className="flex-1 bg-transparent text-[15px] text-white outline-none placeholder:text-zinc-500 tracking-widest"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleVerifyEmailOtp}
                      disabled={emailVerifyLoading || emailOtp.length < 6}
                      className="flex-shrink-0 px-4 py-3 rounded-xl text-sm font-bold
                        bg-logo-gradient text-[#050a1a] disabled:opacity-40"
                    >
                      {emailVerifyLoading ? (
                        <span className="inline-block w-4 h-4 border-2 border-[#050a1a] border-t-transparent rounded-full animate-spin" />
                      ) : (
                        'Verify'
                      )}
                    </button>
                  </div>
                )}
                {fieldErrors.emailOtp && (
                  <p className="text-xs text-red-400 mt-1.5 font-medium" role="alert">{fieldErrors.emailOtp}</p>
                )}
                {serviceConfigLoaded && !emailOtpEnabled && (
                  <div className="rounded-xl border border-[#0ea4ab]/25 bg-[#0ea4ab]/[0.08] px-4 py-3 mt-2 text-xs text-[#C5E35B]/80 leading-relaxed">
                    Email verification is optional during signup. Verify your email later from Profile.
                  </div>
                )}
              </div>
            </div>

            {/* ── Mobile — OTP controls only when SMS service is on ── */}
            <div>
              <label className="block text-[13px] font-semibold text-zinc-300 mb-2">
                Mobile
                {smsOtpEnabled ? (
                  <span className="text-zinc-500 font-normal"> (SMS verification)</span>
                ) : serviceConfigLoaded ? (
                  <span className="ml-2 text-xs font-normal text-[#C5E35B]/90">(SMS verification inactive)</span>
                ) : null}
              </label>
              <div className="flex gap-2">
                <div className={`flex-1 flex items-center rounded-xl border px-3.5 h-12 transition-colors group ${
                  showFieldError('mobile') ? 'border-red-500/50 bg-red-500/[0.04]' : 'border-white/[0.1] bg-white/[0.03] focus-within:border-[#0ea4ab]/50'
                }`}>
                  {countryCode ? (
                    <span className="text-sm font-bold text-[#C5E35B] mr-2 tabular-nums">+{countryCode}</span>
                  ) : null}
                  <Phone size={16} className="text-zinc-500 mr-2 group-focus-within:text-[#0ea4ab] transition-colors" />
                  <input
                    type="tel"
                    inputMode="numeric"
                    value={mobile}
                    disabled={smsOtpEnabled && smsVerified}
                    onChange={e => {
                      setMobile(e.target.value.replace(/\D/g, '').slice(0, 10));
                      setFieldErrors(f => ({ ...f, mobile: '' }));
                      setError('');
                      setSuccess('');
                      if (smsOtpEnabled && smsOtpSent) resetSmsVerification();
                    }}
                    onBlur={() => {
                      setTouched(t => ({ ...t, mobile: true }));
                      if (smsOtpEnabled && !mobile.trim()) {
                        setFieldErrors(f => ({ ...f, mobile: 'Mobile number is required.' }));
                        return;
                      }
                      if (!mobile.trim()) {
                        setFieldErrors(f => ({ ...f, mobile: '' }));
                        return;
                      }
                      const msg = validateSignupMobile(mobile);
                      setFieldErrors(f => ({ ...f, mobile: msg || '' }));
                    }}
                    placeholder={smsOtpEnabled ? '10-digit mobile number' : '10-digit mobile (optional)'}
                    autoComplete="tel-national"
                    aria-invalid={Boolean(fieldErrors.mobile)}
                    className="flex-1 bg-transparent text-[15px] text-white outline-none placeholder:text-zinc-500 disabled:opacity-60"
                  />
                </div>
                {smsOtpEnabled && (
                  <OtpSendButton
                    label={smsOtpSent && !smsVerified ? 'Resend' : 'Send OTP'}
                    loading={smsSendLoading}
                    disabled={smsVerified || !mobileValidForOtp}
                    onClick={handleSendSmsOtp}
                  />
                )}
              </div>
              {smsOtpEnabled ? (
                <p className="text-[11px] text-zinc-500 mt-1.5">
                  {smsVerified
                    ? 'Mobile verified.'
                    : smsOtpSent
                      ? `SMS code${phoneHint ? ` sent to ${phoneHint}` : ''}. Use Resend if you did not receive it.`
                      : 'Enter a valid 10-digit number and tap Send OTP — no need to verify email first.'}
                </p>
              ) : serviceConfigLoaded ? (
                <p className="text-[11px] text-zinc-500 mt-1.5">
                  Your number will be saved without SMS verification. Verify later from Profile when SMS is enabled.
                </p>
              ) : null}
              {showFieldError('mobile') && (
                <p className="text-xs text-red-400 mt-1.5 font-medium" role="alert">{fieldErrors.mobile}</p>
              )}
              {smsOtpEnabled && smsVerified && (
                <p className="text-xs text-green-400 mt-1.5 font-medium flex items-center gap-1">
                  <CheckCircle size={12} /> Mobile verified
                </p>
              )}
              {smsOtpEnabled && smsOtpSent && !smsVerified && (
                <div className="flex gap-2 mt-2">
                  <div className={`flex-1 flex items-center rounded-xl border px-3.5 h-12 ${
                    fieldErrors.smsOtp ? 'border-red-500/50 bg-red-500/[0.04]' : 'border-white/[0.1] bg-white/[0.03] focus-within:border-[#0ea4ab]/50'
                  }`}>
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      value={smsOtp}
                      onChange={e => {
                        setSmsOtp(e.target.value.replace(/\D/g, '').slice(0, 6));
                        setFieldErrors(f => ({ ...f, smsOtp: '' }));
                      }}
                      placeholder="SMS OTP (6 digits)"
                      autoComplete="one-time-code"
                      className="flex-1 bg-transparent text-[15px] text-white outline-none placeholder:text-zinc-500 tracking-widest"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleVerifySmsOtp}
                    disabled={smsVerifyLoading || smsOtp.length < 6}
                    className="flex-shrink-0 px-4 py-3 rounded-xl text-sm font-bold
                      bg-logo-gradient text-surface-dark
                      disabled:opacity-40"
                  >
                    {smsVerifyLoading ? (
                      <span className="inline-block w-4 h-4 border-2 border-[#050a1a] border-t-transparent rounded-full animate-spin" />
                    ) : (
                      'Verify'
                    )}
                  </button>
                </div>
              )}
              {smsOtpEnabled && fieldErrors.smsOtp && (
                <p className="text-xs text-red-400 mt-1.5 font-medium" role="alert">{fieldErrors.smsOtp}</p>
              )}
            </div>

            {/* Referral code (optional) */}
            <div>
              <label className="block text-[13px] font-semibold text-zinc-300 mb-2">
                Referral code
                <span className="text-zinc-500 font-normal"> (optional)</span>
              </label>
              <div className="flex items-center rounded-xl border border-white/[0.1] bg-white/[0.03] px-3.5 h-12 focus-within:border-[#0ea4ab]/50 transition-colors group">
                <Gift size={16} className="text-zinc-500 mr-2.5 group-focus-within:text-[#0ea4ab] transition-colors" />
                <input
                  type="text"
                  value={referralCode}
                  onChange={e => {
                    const next = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
                    setReferralCode(next);
                    setStoredReferralCode(next);
                  }}
                  onBlur={() => setStoredReferralCode(referralCode)}
                  placeholder="Enter a friend's code"
                  autoComplete="off"
                  className="flex-1 bg-transparent text-[15px] text-white outline-none placeholder:text-zinc-500 font-mono tracking-wide"
                />
              </div>
              <p className="text-xs text-zinc-500 mt-1.5">
                Have a referral link? The code is filled in automatically, or type it here.
              </p>
            </div>

            {/* Password */}
            <div>
              <label className="block text-[13px] font-semibold text-zinc-300 mb-2">Password</label>
              <div className={`flex items-center rounded-xl border px-3.5 h-12 transition-colors group ${
                showFieldError('password') ? 'border-red-500/50 bg-red-500/[0.04]' : 'border-white/[0.1] bg-white/[0.03] focus-within:border-[#0ea4ab]/50'
              }`}>
                <Lock size={16} className="text-zinc-500 mr-2.5 group-focus-within:text-[#0ea4ab] transition-colors" />
                <input
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={e => {
                    setPassword(e.target.value);
                    setFieldErrors(f => ({ ...f, password: '', confirm: '' }));
                    setError('');
                  }}
                  onBlur={() => {
                    setTouched(t => ({ ...t, password: true }));
                    if (!password) {
                      setFieldErrors(f => ({ ...f, password: '' }));
                      return;
                    }
                    const msg = validateStrongPassword(password);
                    setFieldErrors(f => ({ ...f, password: msg || '' }));
                  }}
                  placeholder="8+ chars: upper, lower, number, symbol"
                  autoComplete="new-password"
                  aria-invalid={Boolean(fieldErrors.password)}
                  className="flex-1 bg-transparent text-[15px] text-white outline-none placeholder:text-zinc-500"
                />
                <button type="button" onClick={() => setShowPw(v => !v)}
                  className="text-zinc-500 hover:text-white transition-colors ml-2">
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {password && (
                <div className="flex flex-col gap-1.5 mt-2">
                  <div className="flex items-center gap-2.5">
                    <div className="flex gap-1.5 flex-1">
                      {[1, 2, 3, 4].map(lvl => (
                        <div key={lvl} className="flex-1 h-1.5 rounded-full transition-all"
                          style={{ background: strengthMeta.score >= lvl ? strengthMeta.color : 'rgba(255,255,255,0.07)' }} />
                      ))}
                    </div>
                    {strengthMeta.label && (
                      <span className="text-xs font-bold whitespace-nowrap" style={{ color: strengthMeta.color }}>{strengthMeta.label}</span>
                    )}
                  </div>
                  <p className="text-[11px] text-zinc-500 leading-snug">
                    Use at least 8 characters with uppercase, lowercase, a number, and a symbol (e.g. ! or #).
                  </p>
                </div>
              )}
              {showFieldError('password') && (
                <p className="text-xs text-red-400 mt-1.5 font-medium" role="alert">{fieldErrors.password}</p>
              )}
            </div>

            {/* Confirm */}
            <div>
              <label className="block text-[13px] font-semibold text-zinc-300 mb-2">Confirm Password</label>
              <div className={`flex items-center rounded-xl border px-3.5 h-12 transition-colors ${
                showFieldError('confirm')
                  ? 'border-red-500/50 bg-red-500/[0.04]'
                  : 'border-white/[0.1] bg-white/[0.03] focus-within:border-[#0ea4ab]/50'
              }`}>
                <Lock size={16} className="text-zinc-500 mr-2.5" />
                <input
                  type="password"
                  value={confirm}
                  onChange={e => {
                    setConfirm(e.target.value);
                    setFieldErrors(f => ({ ...f, confirm: '' }));
                    setError('');
                  }}
                  onBlur={() => {
                    setTouched(t => ({ ...t, confirm: true }));
                    const msg = validateRegisterConfirm(password, confirm);
                    setFieldErrors(f => ({ ...f, confirm: msg || '' }));
                  }}
                  placeholder="Repeat your password"
                  autoComplete="new-password"
                  aria-invalid={Boolean(fieldErrors.confirm)}
                  className="flex-1 bg-transparent text-[15px] text-white outline-none placeholder:text-zinc-500"
                />
                {confirm && confirm === password && !fieldErrors.confirm && (
                  <CheckCircle size={16} className="text-green-400 ml-2" />
                )}
              </div>
              {showFieldError('confirm') && (
                <p className="text-xs text-red-400 mt-1.5 font-medium" role="alert">{fieldErrors.confirm}</p>
              )}
            </div>

            {/* Terms */}
            <label className="flex items-start gap-3 cursor-pointer group">
              <div className="mt-0.5 flex-shrink-0">
                <input
                  type="checkbox"
                  checked={agree}
                  onChange={e => {
                    setAgree(e.target.checked);
                    setFieldErrors(f => ({ ...f, terms: '' }));
                    setError('');
                  }}
                  onBlur={() => setTouched(t => ({ ...t, terms: true }))}
                  className="w-4 h-4 rounded border-white/[0.1] bg-white/[0.03] accent-[#0ea4ab] cursor-pointer"
                />
              </div>
              <span className="text-[12px] text-zinc-400 leading-relaxed">
                I agree to the{' '}
                <Link
                  to={SITE_CONFIG.termsPath}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#C5E35B] hover:underline"
                >
                  Terms of Service
                </Link>
                {' '}and{' '}
                <Link
                  to={SITE_CONFIG.privacyPolicyPath}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#C5E35B] hover:underline"
                >
                  Privacy Policy
                </Link>.
              </span>
            </label>
            {showFieldError('terms') && (
              <p className="text-xs text-red-400 font-medium -mt-2" role="alert">{fieldErrors.terms}</p>
            )}

            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={residency}
                onChange={(e) => {
                  setResidency(e.target.checked);
                  setFieldErrors((f) => ({ ...f, residency: '' }));
                  setError('');
                }}
                className="mt-0.5 h-4 w-4 rounded border-white/20 bg-white/[0.04] accent-[#0ea4ab]"
              />
              <span className="text-[12px] leading-relaxed text-zinc-400">
                I confirm that I am not a resident of a restricted jurisdiction and am eligible to use IBO Exchange services.
              </span>
            </label>
            {showFieldError('residency') && (
              <p className="text-xs text-red-400 font-medium -mt-1" role="alert">{fieldErrors.residency}</p>
            )}

            <AuthPrimaryButton
              loading={loading}
              disabled={
                !serviceConfigLoaded
                || (emailOtpEnabled && !emailVerified)
                || (smsOtpEnabled && !smsVerified)
              }
            >
              Sign Up
            </AuthPrimaryButton>

          </form>

      <p className="text-center text-[14px] text-zinc-400 mt-6">
        Already have an account?{' '}
        <Link to="/login" className="text-[#C5E35B] font-semibold hover:underline">
          Log In
        </Link>
      </p>

      <AuthComplianceNote>
        By creating an account you acknowledge trading involves risk. Demo balances are for practice only.
      </AuthComplianceNote>

      <AuthAppDownload />
    </AuthShell>
  );
}
