import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, CheckCircle } from 'lucide-react';
import { validateAuthEmail, authFormBannerMessage } from '@/lib/authValidation';
import { exchangeApiOrigin } from '@/lib/apiBase';
import AuthShell, {
  AuthField,
  AuthPrimaryButton,
  AuthPromoPanel,
} from '@/components/auth/AuthShell';

const API = exchangeApiOrigin(import.meta.env.VITE_BACKEND_URL);

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [touched, setTouched] = useState(false);
  const showFieldError = Boolean(fieldError) && (submitAttempted || touched);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitAttempted(true);
    setError('');
    const emErr = validateAuthEmail(email);
    if (emErr) {
      setFieldError(emErr);
      setError(authFormBannerMessage({ email: emErr }, emErr));
      return;
    }
    setFieldError('');
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data?.detail === 'string' ? data.detail : 'Request failed. Try again later.');
        return;
      }
      setDone(true);
    } catch {
      setError('Network error. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      side={
        <AuthPromoPanel
          title={<>Secure account recovery</>}
          subtitle="Reset access with a time-limited email link — same protection you get on login."
          items={[
            {
              title: 'Email link only',
              desc: 'We never ask for your password over chat or SMS.',
            },
            {
              title: 'Link expires quickly',
              desc: 'Use the reset email promptly, then sign in with your new password.',
            },
          ]}
        />
      }
    >
      <h1 className="font-display text-[1.85rem] sm:text-[2.1rem] font-bold text-white tracking-tight mb-1">
        Reset Password
      </h1>
      <p className="text-[14px] text-zinc-400 mb-7">
        We will email you a secure link if the account exists.
      </p>

      {error ? (
        <div className="flex items-start gap-2.5 rounded-xl border border-red-500/25 bg-red-500/10 px-3.5 py-3 mb-5 text-sm text-red-300">
          <AlertCircle size={15} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      ) : null}

      {done ? (
        <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-4 text-sm text-emerald-100 flex gap-3">
          <CheckCircle className="shrink-0 text-emerald-400" size={20} />
          <p>
            If an account exists for that email, password reset instructions were sent. Check your inbox and spam folder.
          </p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-5">
          <AuthField
            label="Email"
            type="email"
            value={email}
            placeholder="you@email.com"
            autoComplete="email"
            error={showFieldError ? fieldError : ''}
            onChange={(ev) => {
              setEmail(ev.target.value);
              setFieldError('');
              setError('');
            }}
            onBlur={() => {
              setTouched(true);
              setFieldError(validateAuthEmail(email) || '');
            }}
          />
          <AuthPrimaryButton loading={loading}>Send reset link</AuthPrimaryButton>
        </form>
      )}

      <p className="text-center text-[14px] text-zinc-400 mt-8">
        <Link to="/login" className="text-[#00A876] font-semibold hover:underline">
          ← Back to Log In
        </Link>
      </p>
    </AuthShell>
  );
}
