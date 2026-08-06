/**
 * Active registration UI — email + password, plus Google / Apple.
 * Classic multi-step OTP flow parked in RegisterPage.classic.jsx — do not delete.
 */
import { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Eye, EyeOff, AlertCircle } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import {
  validateRegisterConfirm,
  firstRegisterError,
} from '@/lib/profileValidation';
import {
  validateAuthEmail,
  validateStrongPassword,
  authFormBannerMessage,
  isAuthRequestError,
} from '@/lib/authValidation';
import {
  captureReferralCodeFromUrl,
  getStoredReferralCode,
  setStoredReferralCode,
} from '@/lib/referral';
import AuthShell, {
  AuthSocialRow,
  AuthField,
  AuthPrimaryButton,
  AuthComplianceNote,
  AuthAppDownload,
  AuthPromoPanel,
} from '@/components/auth/AuthShell';

const emptyErrors = () => ({
  email: '', password: '', confirm: '',
});

function displayNameFromEmail(email) {
  const local = String(email || '').split('@')[0]?.trim() || 'User';
  const cleaned = local.replace(/[._+-]+/g, ' ').trim();
  if (cleaned.length >= 2) return cleaned.slice(0, 50);
  return 'User';
}

export default function RegisterPage() {
  const { register, loginOAuth } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState(emptyErrors);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [touched, setTouched] = useState({
    email: false, password: false, confirm: false,
  });
  const [referralCode, setReferralCode] = useState('');

  useEffect(() => {
    const preset = (searchParams.get('email') || '').trim();
    if (preset) setEmail(preset);
  }, [searchParams]);

  useEffect(() => {
    captureReferralCodeFromUrl();
    setReferralCode(getStoredReferralCode());
  }, []);

  const showFieldError = (key) => Boolean(fieldErrors[key]) && (submitAttempted || touched[key]);

  const afterAuth = (isNew = true) => {
    navigate(isNew ? '/kyc' : '/dashboard', {
      replace: true,
      state: isNew ? { justRegistered: true } : undefined,
    });
  };

  const handleSocial = async (provider, tokens) => {
    setError('');
    setLoading(true);
    try {
      setStoredReferralCode(referralCode);
      await loginOAuth(provider, tokens);
      afterAuth(true);
    } catch (err) {
      setError(err.message || 'Social sign-up failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitAttempted(true);
    setError('');

    const em = email.trim();
    const errs = emptyErrors();
    const emailErr = validateAuthEmail(em);
    const pwErr = validateStrongPassword(password);
    const cErr = validateRegisterConfirm(password, confirm);
    if (emailErr) errs.email = emailErr;
    if (pwErr) errs.password = pwErr;
    if (cErr) errs.confirm = cErr;

    const filtered = Object.fromEntries(Object.entries(errs).filter(([, v]) => v));
    if (Object.keys(filtered).length) {
      setFieldErrors({ ...emptyErrors(), ...filtered });
      setError(firstRegisterError(filtered) || authFormBannerMessage(filtered, 'Please fix the highlighted fields.'));
      return;
    }

    setLoading(true);
    try {
      setStoredReferralCode(referralCode);
      await register(displayNameFromEmail(em), em, password, referralCode || undefined);
      afterAuth(true);
    } catch (err) {
      if (isAuthRequestError(err) && err.fieldErrors) {
        setFieldErrors({
          ...emptyErrors(),
          email: err.fieldErrors.email || '',
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
      maxWidthClass="max-w-[420px]"
      side={
        <AuthPromoPanel
          title={<>Trade Spot, Futures &amp; more</>}
          subtitle="Join Delta Exchange for deep liquidity, pro charts, and INR-ready onboarding."
          items={[
            {
              title: 'Trade without friction',
              desc: 'Spot USDT pairs, Delta markets, and portfolio tools in one terminal.',
            },
            {
              title: 'INR deposit & payout',
              desc: 'Fund via bank or UPI and withdraw INR after selling — built for India.',
            },
            {
              title: 'Bank-grade security',
              desc: '2FA, cold-wallet custody practices, and real-time monitoring.',
            },
          ]}
        />
      }
    >
      <h1 className="font-display text-[1.85rem] sm:text-[2.1rem] font-bold text-white tracking-tight mb-1">
        Sign Up
      </h1>
      <p className="text-[14px] text-zinc-400 mb-7">
        Create your account with email or continue with Google / Apple
      </p>

      <AuthSocialRow
        disabled={loading}
        onError={setError}
        onGoogle={(tokens) => handleSocial('google', tokens)}
        onApple={(tokens) => handleSocial('apple', tokens)}
      />

      {error ? (
        <div className="flex items-start gap-2.5 rounded-xl border border-red-500/25 bg-red-500/10 px-3.5 py-3 mb-5 text-sm text-red-300">
          <AlertCircle size={15} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      ) : null}

      <form noValidate onSubmit={handleSubmit} className="space-y-4">
        <AuthField
          label="Email"
          type="email"
          value={email}
          placeholder="you@email.com"
          autoComplete="email"
          error={showFieldError('email') ? fieldErrors.email : ''}
          onChange={(e) => {
            setEmail(e.target.value);
            setFieldErrors((f) => ({ ...f, email: '' }));
            setError('');
          }}
          onBlur={() => {
            setTouched((t) => ({ ...t, email: true }));
            setFieldErrors((f) => ({ ...f, email: validateAuthEmail(email) || '' }));
          }}
        />

        <AuthField
          label="Password"
          type={showPw ? 'text' : 'password'}
          value={password}
          placeholder="Create a strong password"
          autoComplete="new-password"
          error={showFieldError('password') ? fieldErrors.password : ''}
          onChange={(e) => {
            setPassword(e.target.value);
            setFieldErrors((f) => ({ ...f, password: '' }));
          }}
          onBlur={() => {
            setTouched((t) => ({ ...t, password: true }));
            setFieldErrors((f) => ({ ...f, password: validateStrongPassword(password) || '' }));
          }}
          rightSlot={
            <button
              type="button"
              onClick={() => setShowPw((v) => !v)}
              className="text-zinc-500 hover:text-white transition-colors ml-2"
              aria-label={showPw ? 'Hide password' : 'Show password'}
            >
              {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          }
        />

        <AuthField
          label="Confirm password"
          type={showPw ? 'text' : 'password'}
          value={confirm}
          placeholder="Re-enter password"
          autoComplete="new-password"
          error={showFieldError('confirm') ? fieldErrors.confirm : ''}
          onChange={(e) => {
            setConfirm(e.target.value);
            setFieldErrors((f) => ({ ...f, confirm: '' }));
          }}
          onBlur={() => {
            setTouched((t) => ({ ...t, confirm: true }));
            setFieldErrors((f) => ({ ...f, confirm: validateRegisterConfirm(password, confirm) || '' }));
          }}
        />

        <AuthPrimaryButton loading={loading}>Create account</AuthPrimaryButton>
      </form>

      <p className="text-center text-[14px] text-zinc-400 mt-6">
        Already have an account?{' '}
        <Link to="/login" className="text-[#3B82F6] font-semibold hover:underline hover:text-[#60A5FA]">
          Log In
        </Link>
      </p>

      <AuthComplianceNote>
        By signing up you agree to our Terms of Service. Trading involves risk of loss.
      </AuthComplianceNote>
      <AuthAppDownload />
    </AuthShell>
  );
}
