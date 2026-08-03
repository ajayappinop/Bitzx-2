import { useState, useMemo } from 'react';

import { Link, useNavigate, useSearchParams, useParams } from 'react-router-dom';

import { Eye, EyeOff, AlertCircle, CheckCircle } from 'lucide-react';

import {

  validateStrongPassword,

  authFormBannerMessage,

  parseFastApi422FieldErrors,

  formatApiDetail,

} from '@/lib/authValidation';

import { exchangeApiOrigin } from '@/lib/apiBase';

import AuthShell, {

  AuthField,

  AuthPrimaryButton,

  AuthPromoPanel,

} from '@/components/auth/AuthShell';



const API = exchangeApiOrigin(import.meta.env.VITE_BACKEND_URL);



export default function ResetPasswordPage() {

  const [searchParams] = useSearchParams();

  const { token: pathToken } = useParams();

  const navigate = useNavigate();

  const token = useMemo(

    () => (searchParams.get('token') || pathToken || '').trim(),

    [searchParams, pathToken],

  );



  const [password, setPassword] = useState('');

  const [password2, setPassword2] = useState('');

  const [showPw, setShowPw] = useState(false);

  const [error, setError] = useState('');

  const [fieldErrors, setFieldErrors] = useState({ password: '', password2: '' });

  const [done, setDone] = useState(false);

  const [loading, setLoading] = useState(false);

  const [submitAttempted, setSubmitAttempted] = useState(false);

  const [touched, setTouched] = useState({ password: false, password2: false });

  const showFieldError = (field) => Boolean(fieldErrors[field]) && (submitAttempted || touched[field]);



  const handleSubmit = async (e) => {

    e.preventDefault();

    setSubmitAttempted(true);

    setError('');

    const fe = {};

    const p1 = validateStrongPassword(password);

    if (p1) fe.password = p1;

    if (password !== password2) fe.password2 = 'Passwords do not match.';

    if (Object.keys(fe).length) {

      setFieldErrors({ password: fe.password || '', password2: fe.password2 || '' });

      setError(authFormBannerMessage(fe, fe.password || fe.password2));

      return;

    }

    setFieldErrors({ password: '', password2: '' });

    if (!token) {

      setError('This reset link is missing a token. Open the link from your email again.');

      return;

    }

    setLoading(true);

    try {

      const res = await fetch(`${API}/api/auth/reset-password`, {

        method: 'POST',

        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },

        body: JSON.stringify({ token, new_password: password }),

      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {

        const parsed = res.status === 422 ? parseFastApi422FieldErrors(data?.detail) : {};

        const pwMsg = parsed.new_password || parsed.password || parsed.token;

        if (pwMsg) {

          setFieldErrors({ password: parsed.new_password || parsed.password || '', password2: '' });

          setError(authFormBannerMessage({ password: pwMsg }, pwMsg));

          return;

        }

        setError(formatApiDetail(data?.detail) || 'Could not reset password.');

        return;

      }

      setDone(true);

      window.setTimeout(() => navigate('/login', { replace: true }), 2200);

    } catch {

      setError('Network error. Try again.');

    } finally {

      setLoading(false);

    }

  };



  return (

    <AuthShell

      side={

        <AuthPromoPanel

          title={<>Choose a strong password</>}

          subtitle="Pick something unique to Delta Exchange — then log in and continue trading."

          items={[

            {

              title: 'Use a unique password',

              desc: 'Don’t reuse passwords from email or other exchanges.',

            },

            {

              title: 'Enable 2FA after login',

              desc: 'Add authenticator protection from security settings when you’re in.',

            },

          ]}

        />

      }

    >

      <h1 className="font-display text-[1.85rem] sm:text-[2.1rem] font-bold text-white tracking-tight mb-1">

        Choose a new password

      </h1>

      <p className="text-[14px] text-zinc-400 mb-7">

        After saving, sign in with your new password.

      </p>



      {!token && !done ? (

        <div className="rounded-xl border border-[#FE6C02]/25 bg-[#FE6C02]/10 px-4 py-3 mb-5 text-sm text-[#00A876]/90">

          No reset token in the URL. Use the link from your email, or request a new one from forgot password.

        </div>

      ) : null}



      {error ? (

        <div className="flex items-start gap-2.5 rounded-xl border border-red-500/25 bg-red-500/10 px-3.5 py-3 mb-5 text-sm text-red-300">

          <AlertCircle size={15} className="shrink-0 mt-0.5" />

          <span>{error}</span>

        </div>

      ) : null}



      {done ? (

        <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-4 text-sm text-emerald-100 flex gap-3">

          <CheckCircle className="shrink-0 text-emerald-400" size={20} />

          <p>Password updated. Redirecting to sign in…</p>

        </div>

      ) : (

        <form onSubmit={handleSubmit} className="space-y-4">

          <AuthField

            label="New password"

            type={showPw ? 'text' : 'password'}

            value={password}

            placeholder="Strong password"

            autoComplete="new-password"

            error={showFieldError('password') ? fieldErrors.password : ''}

            onChange={(ev) => {

              setPassword(ev.target.value);

              setFieldErrors((f) => ({ ...f, password: '' }));

              setError('');

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

            value={password2}

            placeholder="Repeat password"

            autoComplete="new-password"

            error={showFieldError('password2') ? fieldErrors.password2 : ''}

            onChange={(ev) => {

              setPassword2(ev.target.value);

              setFieldErrors((f) => ({ ...f, password2: '' }));

              setError('');

            }}

            onBlur={() => {

              setTouched((t) => ({ ...t, password2: true }));

              setFieldErrors((f) => ({

                ...f,

                password2: password !== password2 ? 'Passwords do not match.' : '',

              }));

            }}

          />

          <AuthPrimaryButton loading={loading} disabled={!token}>

            Update password

          </AuthPrimaryButton>

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

