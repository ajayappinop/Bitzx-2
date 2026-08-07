/**

 * PARKED — Classic Delta login UI (temporarily disabled).

 * Active page: LoginPage.jsx (Delta-inspired AuthShell).

 */

import { useState } from 'react';

import { Link, useNavigate } from 'react-router-dom';

import { Eye, EyeOff, Lock, Mail, AlertCircle, TrendingUp, Shield, Zap } from 'lucide-react';

import { useAuth } from '@/context/AuthContext';

import {

  validateAuthEmail,

  validateAuthPasswordLogin,

  authFormBannerMessage,

  isAuthRequestError,

} from '@/lib/authValidation';

import { SITE_CONFIG } from '@/lib/siteConfig';

import { BRAND_LOGO } from '@/lib/brandAssets';



const LOGO = BRAND_LOGO;



const PERKS = [

  { icon: TrendingUp, title: 'Deep liquidity', desc: 'Futures and options in one terminal' },

  { icon: Zap, title: 'Fast onboarding', desc: 'Demo funds to practice — then go live when ready' },

  { icon: Shield, title: 'Secure by design', desc: '2FA, KYC, and custody best practices' },

];



export default function LoginPage() {

  const { login } = useAuth();

  const navigate = useNavigate();

  const [email, setEmail] = useState('');

  const [password, setPassword] = useState('');

  const [showPw, setShowPw] = useState(false);

  const [loading, setLoading] = useState(false);

  const [error, setError] = useState('');

  const [fieldErrors, setFieldErrors] = useState({ email: '', password: '' });

  const [submitAttempted, setSubmitAttempted] = useState(false);

  const [touched, setTouched] = useState({ email: false, password: false });



  const clearApiState = () => {

    setError('');

    setFieldErrors({ email: '', password: '' });

  };

  const showFieldError = (field) => Boolean(fieldErrors[field]) && (submitAttempted || touched[field]);



  const handleSubmit = async (e) => {

    e.preventDefault();

    setSubmitAttempted(true);

    clearApiState();

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

      navigate('/dashboard');

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

    <div className="ibo-page font-ui flex flex-col lg:flex-row min-h-[100dvh] lg:h-[100dvh] lg:max-h-[100dvh] lg:overflow-hidden">

      {/* LEFT — Brand panel */}

      <aside className="hidden lg:flex flex-col w-[min(44%,28rem)] xl:w-[30rem] shrink-0 relative overflow-hidden

        px-9 xl:px-11 pt-9 xl:pt-10 pb-9

        bg-[color:var(--ibo-surface)] border-r border-[color:var(--ibo-border-solid)]">

        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_20%_20%,rgba(254, 108, 2,0.15),transparent_55%)]" />

        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_80%_85%,rgba(96,165,250,0.06),transparent_50%)]" />

        <div

          className="absolute inset-0 opacity-[.025]"

          style={{

            backgroundImage:

              'linear-gradient(#FE6C02 1px,transparent 1px),linear-gradient(90deg,#FE6C02 1px,transparent 1px)',

            backgroundSize: '44px 44px',

          }}

        />



        <div className="relative z-10 flex flex-col gap-7 h-full min-h-0">

          <Link to="/" aria-label="Delta Exchange home" className="inline-block w-fit hover:opacity-90 transition-opacity shrink-0">

            <img

              src={LOGO}

              alt="Delta Exchange"

              className="h-10 xl:h-11 w-auto max-w-[220px] object-contain"

              style={{ background: 'transparent' }}

            />

          </Link>



          <div className="shrink-0">

            <h2 className="text-[1.75rem] xl:text-[2rem] font-extrabold text-[color:var(--ibo-ink)] leading-[1.15] tracking-tight">

              Welcome back to<br />

              <span className="text-gradient">Delta Exchange</span>

            </h2>

            <p className="mt-3 text-[color:var(--ibo-muted)] text-sm leading-relaxed max-w-[22rem]">

              Sign in to trade, manage your wallet, and track your portfolio.

            </p>

          </div>



          <div className="space-y-2.5 shrink-0">

            {PERKS.map(({ icon: Icon, title, desc }) => (

              <div

                key={title}

                className="flex items-start gap-3 rounded-xl px-3 py-2.5"

                style={{ background: 'rgba(254, 108, 2,0.06)', border: '1px solid rgba(254, 108, 2,0.14)' }}

              >

                <Icon size={15} className="text-[#FE9D55] mt-0.5 flex-shrink-0" />

                <div className="min-w-0">

                  <p className="text-sm font-bold text-[color:var(--ibo-ink)] leading-snug">{title}</p>

                  <p className="text-xs text-[color:var(--ibo-muted)] mt-0.5 leading-snug">{desc}</p>

                </div>

              </div>

            ))}

          </div>

        </div>

      </aside>



      {/* RIGHT — Form */}

      <main className="flex-1 flex flex-col min-h-0 overflow-y-auto">

        <div className="flex flex-1 flex-col px-5 sm:px-8 lg:px-12 xl:px-16

          pt-7 pb-8 sm:pt-9 sm:pb-10 lg:pt-10 lg:pb-10">

          <div className="mb-7 lg:hidden shrink-0">

            <Link to="/" aria-label="Delta Exchange home" className="inline-block hover:opacity-90 transition-opacity">

              <img

                src={LOGO}

                alt="Delta Exchange"

                className="h-9 w-auto max-w-[180px] object-contain"

                style={{ background: 'transparent' }}

              />

            </Link>

          </div>



          <div className="w-full max-w-[22.5rem] my-auto mx-auto lg:mx-0 lg:ml-[max(0px,min(3rem,8%))]">

            <header className="mb-7">

              <h1 className="text-[1.65rem] sm:text-[1.85rem] font-extrabold text-[color:var(--ibo-ink)] tracking-tight leading-tight">

                Sign in

              </h1>

              <p className="mt-2 text-sm text-[color:var(--ibo-muted)] leading-snug">

                Access your Delta Exchange account

              </p>

            </header>



            {error ? (

              <div className="flex items-start gap-2.5 bg-red-500/10 border border-red-500/25 rounded-xl px-3.5 py-3 mb-5 text-sm text-red-500">

                <AlertCircle size={15} className="shrink-0 mt-0.5" />

                <span>{error}</span>

              </div>

            ) : null}



            <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>

              <div>

                <label className="block text-[13px] font-semibold text-[color:var(--ibo-ink)] mb-1.5">Email</label>

                <div

                  className={`flex items-center bg-[color:var(--ibo-card)] border rounded-xl px-3.5 h-11 focus-within:border-[rgba(254, 157, 85,0.55)] transition-colors group ${

                    showFieldError('email') ? 'border-red-500/50' : 'border-[color:var(--ibo-border-solid)]'

                  }`}

                >

                  <Mail size={15} className="text-[color:var(--ibo-muted)] mr-2.5 group-focus-within:text-[#FE9D55] transition-colors" />

                  <input

                    type="email"

                    value={email}

                    placeholder="you@email.com"

                    autoComplete="email"

                    aria-invalid={Boolean(fieldErrors.email)}

                    onChange={(e) => {

                      setEmail(e.target.value);

                      setFieldErrors((f) => ({ ...f, email: '' }));

                      setError('');

                    }}

                    onBlur={() => {

                      setTouched((t) => ({ ...t, email: true }));

                      setFieldErrors((f) => ({ ...f, email: validateAuthEmail(email) || '' }));

                    }}

                    className="flex-1 bg-transparent text-sm text-[color:var(--ibo-ink)] outline-none placeholder:text-[color:var(--ibo-muted)]"

                  />

                </div>

                {showFieldError('email') ? (

                  <p className="text-xs text-red-500 mt-1.5 font-medium" role="alert">{fieldErrors.email}</p>

                ) : null}

              </div>



              <div>

                <div className="flex items-center justify-between gap-3 mb-1.5">

                  <label className="block text-[13px] font-semibold text-[color:var(--ibo-ink)]">Password</label>

                  <Link to="/forgot-password" className="text-xs text-[#FE9D55] hover:underline font-medium shrink-0">

                    Forgot password?

                  </Link>

                </div>

                <div

                  className={`flex items-center bg-[color:var(--ibo-card)] border rounded-xl px-3.5 h-11 focus-within:border-[rgba(254, 157, 85,0.55)] transition-colors group ${

                    showFieldError('password') ? 'border-red-500/50' : 'border-[color:var(--ibo-border-solid)]'

                  }`}

                >

                  <Lock size={15} className="text-[color:var(--ibo-muted)] mr-2.5 group-focus-within:text-[#FE9D55] transition-colors" />

                  <input

                    type={showPw ? 'text' : 'password'}

                    value={password}

                    placeholder="Your password"

                    autoComplete="current-password"

                    aria-invalid={Boolean(fieldErrors.password)}

                    onChange={(e) => {

                      setPassword(e.target.value);

                      setFieldErrors((f) => ({ ...f, password: '' }));

                      setError('');

                    }}

                    onBlur={() => {

                      setTouched((t) => ({ ...t, password: true }));

                      setFieldErrors((f) => ({

                        ...f,

                        password: validateAuthPasswordLogin(password) || '',

                      }));

                    }}

                    className="flex-1 bg-transparent text-sm text-[color:var(--ibo-ink)] outline-none placeholder:text-[color:var(--ibo-muted)]"

                  />

                  <button

                    type="button"

                    onClick={() => setShowPw((v) => !v)}

                    className="text-[color:var(--ibo-muted)] hover:text-[color:var(--ibo-ink)] transition-colors ml-2"

                    aria-label={showPw ? 'Hide password' : 'Show password'}

                  >

                    {showPw ? <EyeOff size={15} /> : <Eye size={15} />}

                  </button>

                </div>

                {showFieldError('password') ? (

                  <p className="text-xs text-red-500 mt-1.5 font-medium" role="alert">{fieldErrors.password}</p>

                ) : null}

              </div>



              <button

                type="submit"

                disabled={loading}

                className="mt-1 w-full flex items-center justify-center gap-2 bg-logo-gradient text-[#101013]

                  font-bold text-sm h-11 rounded-xl hover:brightness-110 active:scale-[0.99]

                  transition-all disabled:opacity-50"

              >

                {loading ? (

                  <div className="w-4 h-4 border-2 border-[#101013] border-t-transparent rounded-full animate-spin" />

                ) : (

                  'Sign In'

                )}

              </button>

            </form>



            <p className="text-center text-sm text-[color:var(--ibo-muted)] mt-6">

              Don&apos;t have an account?{' '}

              <Link to="/register" className="text-[#FE9D55] font-bold hover:underline">

                Create account

              </Link>

            </p>



            <p className="text-center text-[11px] text-[color:var(--ibo-muted)] mt-5 leading-relaxed">

              By continuing you agree to our{' '}

              <Link to={SITE_CONFIG.termsPath} className="text-[color:var(--ibo-ink-secondary)] hover:text-[color:var(--ibo-ink)] underline-offset-2 hover:underline">

                Terms of Service

              </Link>

              .

            </p>

          </div>

        </div>

      </main>

    </div>

  );

}

