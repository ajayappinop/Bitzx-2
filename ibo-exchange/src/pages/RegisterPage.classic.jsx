/**
 * PARKED — Classic IBO registration UI (temporarily disabled).
 * Active page: RegisterPage.jsx (Delta-inspired AuthShell).
 */
import { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Eye, EyeOff, Lock, Mail, User, Phone, ArrowRight, CheckCircle,
  TrendingUp, Shield, Zap, BarChart2, Star, Gift, AlertCircle,
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
import RegisterLiveMarketPreview from '@/components/markets/RegisterLiveMarketPreview';
import { BRAND_LOGO } from '@/lib/brandAssets';

const LOGO = BRAND_LOGO;

const PERKS = [
  { icon: TrendingUp, color: '#22c55e', title: 'Professional Charts', desc: 'TradingView with 100+ indicators' },
  { icon: Zap, color: '#C5E35B', title: 'Instant Demo Balance', desc: '$5,000 USDT + multi-asset demo funds' },
  { icon: BarChart2, color: '#60a5fa', title: '100+ Trading Pairs', desc: 'Spot trade all major cryptocurrencies' },
  { icon: Shield, color: '#0EA4AB', title: 'KYC-Secured Platform', desc: 'Identity verification for safe trading' },
  { icon: Star, color: '#0EA4AB', title: 'Low Fees — 0.1%', desc: 'Maker & taker fee, no hidden charges' },
];

const emptyRegisterFieldErrors = () => ({
  name: '', email: '', mobile: '', password: '', confirm: '', terms: '', emailOtp: '', smsOtp: '',
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
    smsAvailable,
    defaultCountryCode,
  } = useSignupOtpConfig();

  /** SMS OTP is required only when enabled and deliverable. */
  const requireSmsOtp = Boolean(smsOtpEnabled && smsAvailable);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [mobile, setMobile] = useState('');
  const [countryCode, setCountryCode] = useState('91');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [agree, setAgree] = useState(false);
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
    if (requireSmsOtp) {
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
    if (requireSmsOtp && !smsVerified) {
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
    <div className="ibo-page font-ui flex flex-col lg:flex-row lg:h-[100dvh] lg:max-h-[100dvh] lg:overflow-hidden">
      {/* LEFT — Brand panel */}
      <div className="hidden lg:flex flex-col w-[400px] xl:w-[440px] flex-shrink-0
        relative overflow-hidden px-8 xl:px-10 py-8 xl:py-10
        bg-[color:var(--ibo-surface)] border-r border-[color:var(--ibo-border-solid)]">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_20%_20%,rgba(14,164,171,0.15),transparent_55%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_80%_85%,rgba(96,165,250,0.06),transparent_50%)]" />
        <div className="absolute inset-0 opacity-[.025]"
          style={{ backgroundImage: 'linear-gradient(#0EA4AB 1px,transparent 1px),linear-gradient(90deg,#0EA4AB 1px,transparent 1px)', backgroundSize: '44px 44px' }} />

        <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5 }}
          className="mb-8 relative z-10 shrink-0">
          <Link to="/" aria-label="IBO Exchange home" className="inline-block hover:opacity-90 transition-opacity">
            <img
              src={LOGO}
              alt="IBO Exchange"
              className="h-11 xl:h-12 w-auto max-w-[240px] object-contain"
              style={{ background: 'transparent' }}
            />
          </Link>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, delay: 0.1 }}
          className="relative z-10 mb-6 shrink-0">
          <h2 className="text-2xl xl:text-3xl font-extrabold text-[color:var(--ibo-ink)] leading-[1.15] mb-2.5">
            Start trading on<br />
            <span className="text-gradient">IBO Exchange</span>
          </h2>
          <p className="text-[color:var(--ibo-muted)] text-sm leading-relaxed">
            Create your free account — verify email and mobile, then complete KYC when you&apos;re ready.
          </p>
        </motion.div>

        <div className="relative z-10 space-y-2 flex-1 min-h-0 overflow-y-auto">
          {PERKS.map(({ icon: Icon, color, title, desc }) => (
            <motion.div key={title}
              initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.35, delay: 0.15 }}
              className="flex items-start gap-3 p-2.5 rounded-xl"
              style={{ background: 'rgba(14,164,171,0.06)', border: '1px solid rgba(14,164,171,0.14)' }}>
              <Icon size={15} style={{ color }} className="mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-bold text-[color:var(--ibo-ink)]">{title}</p>
                <p className="text-xs text-[color:var(--ibo-muted)] mt-0.5">{desc}</p>
              </div>
            </motion.div>
          ))}
        </div>

        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.7 }}
          className="relative z-10 mt-5 shrink-0 ibo-hover-lift rounded-2xl p-3.5 border border-[color:var(--ibo-border-solid)] bg-[color:var(--ibo-card)]">
          <p className="text-[10px] font-bold text-[color:var(--ibo-muted)] uppercase tracking-widest mb-2.5">
            Live Market
          </p>
          <RegisterLiveMarketPreview />
        </motion.div>
      </div>

      {/* RIGHT — Form */}
      <div className="flex-1 flex flex-col justify-start
        px-5 sm:px-8 lg:px-10 xl:px-14 pt-6 pb-8 sm:pt-8 sm:pb-10 lg:py-8 relative overflow-y-auto min-h-0">
        <div className="absolute top-0 right-0 w-64 h-64
          bg-[radial-gradient(ellipse,rgba(14,164,171,0.07),transparent_70%)] pointer-events-none" />

        <div className="mb-5 lg:hidden shrink-0">
          <Link to="/" aria-label="IBO Exchange home" className="inline-block hover:opacity-90 transition-opacity">
            <img
              src={LOGO}
              alt="IBO Exchange"
              className="h-9 w-auto max-w-[180px] object-contain"
              style={{ background: 'transparent' }}
            />
          </Link>
        </div>

        <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="max-w-lg w-full mx-auto">

          <h1 className="text-2xl sm:text-3xl font-extrabold text-[color:var(--ibo-ink)] mb-1.5 tracking-tight">Create your account</h1>
          <p className="text-[color:var(--ibo-muted)] text-sm sm:text-base mb-5">
            {serviceConfigLoaded && !emailOtpEnabled && !smsOtpEnabled
              ? 'Free demo · Verify email and phone later from Profile'
              : 'Free demo · No deposit required'}
          </p>

          {error && (
            <div className="flex items-start gap-3 bg-red-500/10 border border-red-500/25
              rounded-xl px-4 py-3 mb-5 text-sm text-red-500">
              <AlertCircle size={15} className="flex-shrink-0 mt-0.5" /> {error}
            </div>
          )}
          {success && (
            <div className="flex items-start gap-3 bg-green-500/10 border border-green-500/25
              rounded-xl px-4 py-3 mb-5 text-sm text-green-500">
              <CheckCircle size={16} className="flex-shrink-0 mt-0.5" /> {success}
            </div>
          )}

          <form noValidate onSubmit={handleCreateAccount} className="space-y-4">
            {/* Name + Email row */}
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-white mb-2">Full Name</label>
                <div className={`flex items-center rounded-xl border px-3.5 h-12 transition-colors group ${
                  showFieldError('name') ? 'border-red-500/50 bg-red-500/[0.04]' : 'border-surface-border focus-within:border-gold/50'
                }`}>
                  <User size={16} className="text-white/45 mr-2.5 group-focus-within:text-gold transition-colors" />
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
                    className="flex-1 bg-transparent text-base text-white outline-none placeholder:text-white/45"
                  />
                </div>
                {showFieldError('name') && (
                  <p className="text-xs text-red-400 mt-1.5 font-medium" role="alert">{fieldErrors.name}</p>
                )}
              </div>

              {/* ── Email field ── */}
              <div className="sm:col-span-2">
                <label className="block text-sm font-semibold text-white mb-2">
                  Email
                  {serviceConfigLoaded && !emailOtpEnabled && (
                    <span className="ml-2 text-xs font-normal text-gold-light/90">(OTP verification currently inactive)</span>
                  )}
                </label>
                <div className="flex gap-2">
                  <div className={`flex-1 flex items-center rounded-xl border px-3.5 h-12 transition-colors group ${
                    showFieldError('email') ? 'border-red-500/50 bg-red-500/[0.04]' : 'border-surface-border focus-within:border-gold/50'
                  }`}>
                    <Mail size={16} className="text-white/45 mr-2.5 group-focus-within:text-gold transition-colors" />
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
                      className="flex-1 bg-transparent text-base text-white outline-none placeholder:text-white/45 disabled:opacity-60"
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
                      fieldErrors.emailOtp ? 'border-red-500/50 bg-red-500/[0.04]' : 'border-surface-border focus-within:border-gold/50'
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
                        className="flex-1 bg-transparent text-base text-white outline-none placeholder:text-white/45 tracking-widest"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleVerifyEmailOtp}
                      disabled={emailVerifyLoading || emailOtp.length < 6}
                      className="flex-shrink-0 px-4 py-3 rounded-xl text-sm font-bold
                        bg-logo-gradient text-surface-dark disabled:opacity-40"
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
                  <div className="rounded-xl border border-gold/25 bg-gold/[0.08] px-4 py-3 mt-2 text-xs text-gold-light/80 leading-relaxed">
                    Email verification is optional during signup. Verify your email later from Profile.
                  </div>
                )}
              </div>
            </div>

            {/* ── Mobile — OTP controls only when SMS service is on ── */}
            <div>
              <label className="block text-sm font-semibold text-white mb-2">
                Mobile
                {requireSmsOtp ? (
                  <span className="text-white/45 font-normal"> (SMS verification)</span>
                ) : serviceConfigLoaded ? (
                  <span className="ml-2 text-xs font-normal text-gold-light/90">(SMS verification inactive)</span>
                ) : null}
              </label>
              <div className="flex gap-2">
                <div className={`flex-1 flex items-center rounded-xl border px-3.5 h-12 transition-colors group ${
                  showFieldError('mobile') ? 'border-red-500/50 bg-red-500/[0.04]' : 'border-surface-border focus-within:border-gold/50'
                }`}>
                  {countryCode ? (
                    <span className="text-sm font-bold text-gold-light mr-2 tabular-nums">+{countryCode}</span>
                  ) : null}
                  <Phone size={16} className="text-white/45 mr-2 group-focus-within:text-gold transition-colors" />
                  <input
                    type="tel"
                    inputMode="numeric"
                    value={mobile}
                    disabled={requireSmsOtp && smsVerified}
                    onChange={e => {
                      setMobile(e.target.value.replace(/\D/g, '').slice(0, 10));
                      setFieldErrors(f => ({ ...f, mobile: '' }));
                      setError('');
                      setSuccess('');
                      if (requireSmsOtp && smsOtpSent) resetSmsVerification();
                    }}
                    onBlur={() => {
                      setTouched(t => ({ ...t, mobile: true }));
                      if (requireSmsOtp && !mobile.trim()) {
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
                    placeholder={requireSmsOtp ? '10-digit mobile number' : '10-digit mobile (optional)'}
                    autoComplete="tel-national"
                    aria-invalid={Boolean(fieldErrors.mobile)}
                    className="flex-1 bg-transparent text-base text-white outline-none placeholder:text-white/45 disabled:opacity-60"
                  />
                </div>
                {requireSmsOtp && (
                  <OtpSendButton
                    label={smsOtpSent && !smsVerified ? 'Resend' : 'Send OTP'}
                    loading={smsSendLoading}
                    disabled={smsVerified || !mobileValidForOtp}
                    onClick={handleSendSmsOtp}
                  />
                )}
              </div>
              {requireSmsOtp ? (
                <p className="text-[11px] text-white/45 mt-1.5">
                  {smsVerified
                    ? 'Mobile verified.'
                    : smsOtpSent
                      ? `SMS code${phoneHint ? ` sent to ${phoneHint}` : ''}. Use Resend if you did not receive it.`
                      : 'Enter a valid 10-digit number and tap Send OTP — no need to verify email first.'}
                </p>
              ) : serviceConfigLoaded ? (
                <p className="text-[11px] text-white/45 mt-1.5">
                  Your number will be saved without SMS verification. Verify later from Profile when SMS is enabled.
                </p>
              ) : null}
              {showFieldError('mobile') && (
                <p className="text-xs text-red-400 mt-1.5 font-medium" role="alert">{fieldErrors.mobile}</p>
              )}
              {requireSmsOtp && smsVerified && (
                <p className="text-xs text-green-400 mt-1.5 font-medium flex items-center gap-1">
                  <CheckCircle size={12} /> Mobile verified
                </p>
              )}
              {requireSmsOtp && smsOtpSent && !smsVerified && (
                <div className="flex gap-2 mt-2">
                  <div className={`flex-1 flex items-center rounded-xl border px-3.5 h-12 ${
                    fieldErrors.smsOtp ? 'border-red-500/50 bg-red-500/[0.04]' : 'border-surface-border focus-within:border-gold/50'
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
                      className="flex-1 bg-transparent text-base text-white outline-none placeholder:text-white/45 tracking-widest"
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
              {requireSmsOtp && fieldErrors.smsOtp && (
                <p className="text-xs text-red-400 mt-1.5 font-medium" role="alert">{fieldErrors.smsOtp}</p>
              )}
            </div>

            {/* Referral code (optional) */}
            <div>
              <label className="block text-sm font-semibold text-white mb-2">
                Referral code
                <span className="text-white/45 font-normal"> (optional)</span>
              </label>
              <div className="flex items-center rounded-xl border border-surface-border px-3.5 h-12 focus-within:border-[#0ea4ab]/50 transition-colors group">
                <Gift size={16} className="text-white/45 mr-2.5 group-focus-within:text-gold transition-colors" />
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
                  className="flex-1 bg-transparent text-base text-white outline-none placeholder:text-white/45 font-mono tracking-wide"
                />
              </div>
              <p className="text-xs text-white/45 mt-1.5">
                Have a referral link? The code is filled in automatically, or type it here.
              </p>
            </div>

            {/* Password */}
            <div>
              <label className="block text-sm font-semibold text-white mb-2">Password</label>
              <div className={`flex items-center rounded-xl border px-3.5 h-12 transition-colors group ${
                showFieldError('password') ? 'border-red-500/50 bg-red-500/[0.04]' : 'border-surface-border focus-within:border-gold/50'
              }`}>
                <Lock size={16} className="text-white/45 mr-2.5 group-focus-within:text-gold transition-colors" />
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
                  className="flex-1 bg-transparent text-base text-white outline-none placeholder:text-white/45"
                />
                <button type="button" onClick={() => setShowPw(v => !v)}
                  className="text-white/45 hover:text-white transition-colors ml-2">
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
                  <p className="text-[11px] text-white/45 leading-snug">
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
              <label className="block text-sm font-semibold text-white mb-2">Confirm Password</label>
              <div className={`flex items-center rounded-xl border px-3.5 h-12 transition-colors ${
                showFieldError('confirm')
                  ? 'border-red-500/50 bg-red-500/[0.04]'
                  : 'border-surface-border focus-within:border-gold/50'
              }`}>
                <Lock size={16} className="text-white/45 mr-2.5" />
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
                  className="flex-1 bg-transparent text-base text-white outline-none placeholder:text-white/45"
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
                  className="w-4 h-4 rounded border-surface-border accent-gold cursor-pointer"
                />
              </div>
              <span className="text-sm text-white leading-relaxed">
                I agree to the{' '}
                <Link
                  to={SITE_CONFIG.termsPath}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gold-light hover:underline"
                >
                  Terms of Service
                </Link>
                {' '}and{' '}
                <Link
                  to={SITE_CONFIG.privacyPolicyPath}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gold-light hover:underline"
                >
                  Privacy Policy
                </Link>.
              </span>
            </label>
            {showFieldError('terms') && (
              <p className="text-xs text-red-400 font-medium -mt-2" role="alert">{fieldErrors.terms}</p>
            )}
            <button
              type="submit"
              disabled={
                loading
                || !serviceConfigLoaded
                || (emailOtpEnabled && !emailVerified)
                || (requireSmsOtp && !smsVerified)
              }
              className="w-full flex items-center justify-center gap-2.5
                bg-logo-gradient text-[#050a1a]
                font-bold text-sm sm:text-base h-12 rounded-xl mt-1
                hover:brightness-110 active:scale-[0.99] transition-all disabled:opacity-50"
            >
              {loading
                ? <div className="w-5 h-5 border-2 border-[#050a1a] border-t-transparent rounded-full animate-spin" />
                : <><span>Create Free Account</span> <ArrowRight size={18} /></>}
            </button>
          </form>

          <p className="text-center text-[color:var(--ibo-muted)] text-sm mt-5">
            Already have an account?{' '}
            <Link to="/login" className="text-[#5BB8FF] font-bold hover:underline">Sign In</Link>
          </p>
        </motion.div>
      </div>
    </div>
  );
}
