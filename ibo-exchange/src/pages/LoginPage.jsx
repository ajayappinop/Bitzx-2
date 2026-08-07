/**
 * Active login UI — Delta-inspired layout via AuthShell.
 * Classic Delta layout parked in LoginPage.classic.jsx — do not delete.
 */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, AlertCircle } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import {
  validateAuthEmail,
  validateAuthPasswordLogin,
  authFormBannerMessage,
  isAuthRequestError,
} from '@/lib/authValidation';
import { SITE_CONFIG } from '@/lib/siteConfig';
import AuthShell, {
  AuthSocialRow,
  AuthField,
  AuthPrimaryButton,
  AuthComplianceNote,
  AuthAppDownload,
  AuthPromoPanel,
} from '@/components/auth/AuthShell';

export default function LoginPage() {
  const { login, loginOAuth } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({ email: '', password: '' });
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [touched, setTouched] = useState({ email: false, password: false });
  const [compliance, setCompliance] = useState(true);

  const clearApiState = () => {
    setError('');
    setFieldErrors({ email: '', password: '' });
  };
  const showFieldError = (field) => Boolean(fieldErrors[field]) && (submitAttempted || touched[field]);

  const afterAuth = () => navigate('/dashboard');

  const handleSocial = async (provider, tokens) => {
    if (!compliance) {
      setError('Please accept the compliance undertaking to continue.');
      return;
    }
    clearApiState();
    setLoading(true);
    try {
      await loginOAuth(provider, tokens);
      afterAuth();
    } catch (err) {
      setError(err.message || 'Social sign-in failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitAttempted(true);
    clearApiState();
    if (!compliance) {
      setError('Please accept the compliance undertaking to continue.');
      return;
    }
    const emErr = validateAuthEmail(email);
    const pwErr = validateAuthPasswordLogin(password);
    const fe = {};
    if (emErr) fe.email = emErr;
    if (pwErr) fe.password = pwErr;
    if (Object.keys(fe).length) {
      setFieldErrors({ email: fe.email || '', password: fe.password || '' });
      setError(authFormBannerMessage(fe, emErr || pwErr));
      return;
    }
    setLoading(true);
    try {
      await login(email.trim(), password);
      afterAuth();
    } catch (err) {
      if (isAuthRequestError(err) && err.fieldErrors) {
        setFieldErrors({
          email: err.fieldErrors.email || '',
          password: err.fieldErrors.password || '',
        });
        setError(err.message);
      } else {
        setFieldErrors({ email: '', password: '' });
        setError(err.message || 'Invalid email or password. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      side={
        <AuthPromoPanel
          title={<>Trade Futures, Options &amp; more</>}
          subtitle="Elevate your crypto trading with deep liquidity, pro charts, and INR-ready onboarding."
          items={[
            {
              title: 'Trade without friction',
              desc: 'Futures, options, and portfolio tools in one terminal.',
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
        Log In
      </h1>
      <p className="text-[14px] text-zinc-400 mb-7">
        Access your account with email or continue with Google / Apple
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

      <form onSubmit={handleSubmit} className="space-y-4">
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
          placeholder="Your password"
          autoComplete="current-password"
          error={showFieldError('password') ? fieldErrors.password : ''}
          onChange={(e) => {
            setPassword(e.target.value);
            setFieldErrors((f) => ({ ...f, password: '' }));
            setError('');
          }}
          onBlur={() => {
            setTouched((t) => ({ ...t, password: true }));
            setFieldErrors((f) => ({ ...f, password: validateAuthPasswordLogin(password) || '' }));
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

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[12px]">
          <Link to="/forgot-password" className="text-[#00A876] hover:underline font-medium">
            Forgot Password?
          </Link>
          <a href={`mailto:${SITE_CONFIG.supportEmail}`} className="text-zinc-400 hover:text-white transition-colors">
            Lost 2FA? Contact support
          </a>
        </div>

        <label className="flex items-start gap-2.5 cursor-pointer pt-1">
          <input
            type="checkbox"
            checked={compliance}
            onChange={(e) => {
              setCompliance(e.target.checked);
              setError('');
            }}
            className="mt-0.5 h-4 w-4 rounded border-white/20 bg-white/[0.04] accent-[#FE6C02]"
          />
          <span className="text-[11px] leading-relaxed text-zinc-500">
            I undertake to comply with applicable intermediary guidelines and Delta Exchange{' '}
            <Link to={SITE_CONFIG.termsPath} className="text-zinc-300 hover:text-white underline-offset-2 hover:underline">
              Terms of Service
            </Link>
            .
          </span>
        </label>

        <AuthPrimaryButton loading={loading}>Log In</AuthPrimaryButton>
      </form>

      <p className="text-center text-[14px] text-zinc-400 mt-6">
        Don&apos;t have an account?{' '}
        <Link to="/register" className="text-[#3B82F6] font-semibold hover:underline hover:text-[#60A5FA]">
          Sign Up
        </Link>
      </p>

      <AuthComplianceNote>
        Trading involves risk of loss. Only trade with funds you can afford to risk.
      </AuthComplianceNote>
      <AuthAppDownload />
    </AuthShell>
  );
}
