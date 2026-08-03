import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Mail, ArrowLeft, RefreshCw, CheckCircle2, AlertTriangle, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

import { BRAND_LOGO } from '@/lib/brandAssets';

const LOGO = BRAND_LOGO;
const OTP_LENGTH = 6;
const RESEND_COOLDOWN_SEC = 60; // 1-minute UI cooldown between resend clicks

// ── OTP input box (single digit) ─────────────────────────────────────────────

function OtpBox({ value, focused, inputRef, onChange, onKeyDown, onFocus, onPaste, index, hasError }) {
  return (
    <input
      ref={inputRef}
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      maxLength={1}
      value={value}
      onChange={onChange}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      onPaste={index === 0 ? onPaste : undefined}
      autoComplete="one-time-code"
      aria-label={`Digit ${index + 1}`}
      className="w-12 h-14 text-center text-xl font-extrabold rounded-xl outline-none transition-all
        bg-surface-card text-white caret-gold
        focus:ring-2 focus:ring-gold/40"
      style={{
        border: hasError
          ? '1.5px solid rgba(239,68,68,0.6)'
          : focused
          ? '1.5px solid rgba(197,227,91,0.7)'
          : value
          ? '1.5px solid rgba(14,164,171,0.5)'
          : '1.5px solid rgba(255,255,255,0.1)',
        boxShadow: focused ? '0 0 0 3px rgba(14,164,171,0.12)' : 'none',
      }}
    />
  );
}

// ── Countdown timer hook ──────────────────────────────────────────────────────

function useCountdown(initialSeconds) {
  const [seconds, setSeconds] = useState(initialSeconds);
  const intervalRef = useRef(null);

  const start = useCallback((from = initialSeconds) => {
    setSeconds(from);
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      setSeconds(s => {
        if (s <= 1) {
          clearInterval(intervalRef.current);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  }, [initialSeconds]);

  const reset = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    setSeconds(initialSeconds);
  }, [initialSeconds]);

  useEffect(() => () => { if (intervalRef.current) clearInterval(intervalRef.current); }, []);

  const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  return { seconds, start, reset, formatted: fmt(seconds), expired: seconds === 0 };
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function EmailVerificationPage() {
  const { registerVerify, registerResend } = useAuth();
  const navigate   = useNavigate();
  const location   = useLocation();

  // Email passed from RegisterPage via router state
  const email = location.state?.email || '';

  const [digits,    setDigits]    = useState(Array(OTP_LENGTH).fill(''));
  const [focusIdx,  setFocusIdx]  = useState(0);
  const [loading,   setLoading]   = useState(false);
  const [resending, setResending] = useState(false);
  const [error,     setError]     = useState('');
  const [success,   setSuccess]   = useState('');
  const [verified,  setVerified]  = useState(false);

  const inputRefs = useRef(Array.from({ length: OTP_LENGTH }, () => null));
  const timer     = useCountdown(RESEND_COOLDOWN_SEC);

  // Auto-start resend cooldown on mount
  useEffect(() => { timer.start(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Redirect to register if no email in state
  useEffect(() => {
    if (!email) navigate('/register', { replace: true });
  }, [email, navigate]);

  // Auto-focus first box on mount
  useEffect(() => {
    setTimeout(() => inputRefs.current[0]?.focus(), 120);
  }, []);

  const focusBox = (idx) => {
    const clamped = Math.max(0, Math.min(OTP_LENGTH - 1, idx));
    inputRefs.current[clamped]?.focus();
    setFocusIdx(clamped);
  };

  const handleChange = (idx, e) => {
    const val = e.target.value.replace(/\D/g, '').slice(-1);
    if (!val) return;
    const next = [...digits];
    next[idx] = val;
    setDigits(next);
    setError('');
    if (idx < OTP_LENGTH - 1) focusBox(idx + 1);
  };

  const handleKeyDown = (idx, e) => {
    if (e.key === 'Backspace') {
      e.preventDefault();
      const next = [...digits];
      if (next[idx]) {
        next[idx] = '';
        setDigits(next);
      } else if (idx > 0) {
        next[idx - 1] = '';
        setDigits(next);
        focusBox(idx - 1);
      }
      setError('');
    } else if (e.key === 'ArrowLeft' && idx > 0) {
      focusBox(idx - 1);
    } else if (e.key === 'ArrowRight' && idx < OTP_LENGTH - 1) {
      focusBox(idx + 1);
    } else if (e.key === 'Enter') {
      handleVerify();
    }
  };

  const handlePaste = (e) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, OTP_LENGTH);
    if (!pasted) return;
    const next = Array(OTP_LENGTH).fill('');
    for (let i = 0; i < pasted.length; i++) next[i] = pasted[i];
    setDigits(next);
    setError('');
    const nextFocus = Math.min(pasted.length, OTP_LENGTH - 1);
    focusBox(nextFocus);
  };

  const code = digits.join('');
  const isFull = code.length === OTP_LENGTH;

  const handleVerify = async () => {
    if (!isFull || loading || verified) return;
    setLoading(true);
    setError('');
    try {
      await registerVerify(email, code);
      setVerified(true);
      setSuccess('Email verified! Redirecting…');
      setTimeout(() => navigate('/kyc', { replace: true }), 1500);
    } catch (err) {
      setError(err.message || 'Invalid code. Please try again.');
      // Shake boxes on error — clear and refocus
      setDigits(Array(OTP_LENGTH).fill(''));
      setTimeout(() => focusBox(0), 80);
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (!timer.expired || resending) return;
    setResending(true);
    setError('');
    setSuccess('');
    setDigits(Array(OTP_LENGTH).fill(''));
    try {
      await registerResend(email);
      setSuccess('A new code has been sent to your email.');
      timer.start(RESEND_COOLDOWN_SEC);
      setTimeout(() => focusBox(0), 80);
    } catch (err) {
      setError(err.message || 'Could not resend. Please try again.');
    } finally {
      setResending(false);
    }
  };

  const maskedEmail = email
    ? (() => {
        const [local, domain] = email.split('@');
        if (!domain) return email;
        const hint = local.length <= 2 ? `${local[0]}***` : `${local.slice(0, 2)}***`;
        return `${hint}@${domain}`;
      })()
    : '';

  return (
    <div className="ibo-page flex flex-col lg:flex-row">

      {/* ── LEFT brand panel (same style as RegisterPage) ── */}
      <div className="hidden lg:flex flex-col w-[420px] xl:w-[480px] flex-shrink-0
        relative overflow-hidden px-12 py-12
        bg-[#0c0f18] border-r border-white/[.05]">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_20%_20%,rgba(14,164,171,0.15),transparent_55%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_80%_85%,rgba(96,165,250,0.06),transparent_50%)]" />
        <div className="absolute inset-0 opacity-[.025]"
          style={{ backgroundImage: 'linear-gradient(#0EA4AB 1px,transparent 1px),linear-gradient(90deg,#0EA4AB 1px,transparent 1px)', backgroundSize: '44px 44px' }} />

        {/* Logo */}
        <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5 }}
          className="mb-12 relative z-10">
          <Link to="/" aria-label="IBO Exchange home" className="inline-block hover:opacity-90 transition-opacity">
            <img
              src={LOGO}
              alt="IBO Exchange"
              className="h-12 sm:h-14 w-auto max-w-[260px] object-contain"
              style={{ background: 'transparent' }}
            />
          </Link>
        </motion.div>

        {/* Central icon + copy */}
        <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, delay: 0.1 }}
          className="relative z-10 flex flex-col items-start flex-1">

          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-8 flex-shrink-0"
            style={{ background: 'rgba(14,164,171,0.15)', border: '1px solid rgba(197,227,91,0.25)' }}>
            <Mail size={28} className="text-gold-light" />
          </div>

          <h2 className="text-4xl xl:text-5xl font-extrabold text-white leading-[1.1] mb-4">
            Check your<br />
            <span className="text-gradient">inbox</span>
          </h2>
          <p className="text-white/60 text-base leading-relaxed mb-10">
            We sent a 6-digit code to your email to confirm it's really you.
            The code expires in&nbsp;<span className="text-gold-light font-semibold">15 minutes</span>.
          </p>

          {/* Info cards */}
          <div className="space-y-4 w-full">
            {[
              { icon: ShieldCheck, title: 'Secure verification', desc: 'Your code is hashed — we never store it in plain text.' },
              { icon: RefreshCw,   title: 'Resend if needed',    desc: 'Didn\'t receive it? Check spam or request a new code after 60 seconds.' },
            ].map(({ icon: Icon, title, desc }) => (
              <div key={title} className="flex items-start gap-3 p-3.5 rounded-xl"
                style={{ background: 'rgba(14,164,171,0.06)', border: '1px solid rgba(197,227,91,0.1)' }}>
                <Icon size={16} className="text-gold-light mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-bold text-white">{title}</p>
                  <p className="text-xs text-white/50 mt-0.5">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      </div>

      {/* ── RIGHT — OTP form ── */}
      <div className="flex-1 flex flex-col justify-center
        px-6 sm:px-10 lg:px-14 xl:px-16 py-8 sm:py-10 relative">

        {/* Glow */}
        <div className="absolute top-0 right-0 w-64 h-64
          bg-[radial-gradient(ellipse,rgba(14,164,171,0.07),transparent_70%)] pointer-events-none" />

        {/* Mobile logo */}
        <div className="mb-8 lg:hidden">
          <Link to="/" aria-label="IBO Exchange home" className="inline-block hover:opacity-90 transition-opacity">
            <img
              src={LOGO}
              alt="IBO Exchange"
              className="h-10 w-auto max-w-[200px] object-contain"
              style={{ background: 'transparent' }}
            />
          </Link>
        </div>

        <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="max-w-lg w-full mx-auto">

          {/* Back */}
          <Link to="/register"
            className="inline-flex items-center gap-2 text-sm text-white/50 hover:text-white
              transition-colors mb-6 group">
            <ArrowLeft size={15} className="group-hover:-translate-x-0.5 transition-transform" />
            Back to registration
          </Link>

          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl xl:text-4xl font-extrabold text-white mb-2">
              Verify your email
            </h1>
            <p className="text-white/55 text-base">
              Enter the 6-digit code sent to{' '}
              <span className="text-gold-light font-semibold">{maskedEmail}</span>
            </p>
          </div>

          {/* Success state */}
          <AnimatePresence>
            {verified && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex flex-col items-center justify-center py-10 gap-4"
              >
                <div className="w-16 h-16 rounded-full bg-green-500/15 border border-green-500/30 flex items-center justify-center">
                  <CheckCircle2 size={32} className="text-green-400" />
                </div>
                <p className="text-lg font-extrabold text-white">Email verified!</p>
                <p className="text-sm text-white/50">Taking you to KYC setup…</p>
                <div className="w-5 h-5 border-2 border-gold border-t-transparent rounded-full animate-spin mt-2" />
              </motion.div>
            )}
          </AnimatePresence>

          {!verified && (
            <>
              {/* Error banner */}
              <AnimatePresence>
                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                    className="flex items-start gap-3 bg-red-500/10 border border-red-500/25
                      rounded-xl px-4 py-3 mb-5 text-sm text-red-400"
                  >
                    <AlertTriangle size={15} className="flex-shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Success banner */}
              <AnimatePresence>
                {success && !verified && (
                  <motion.div
                    initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                    className="flex items-start gap-3 bg-green-500/10 border border-green-500/25
                      rounded-xl px-4 py-3 mb-5 text-sm text-green-400"
                  >
                    <CheckCircle2 size={15} className="flex-shrink-0 mt-0.5" />
                    <span>{success}</span>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* OTP Boxes */}
              <motion.div
                animate={error ? { x: [0, -8, 8, -6, 6, -3, 3, 0] } : {}}
                transition={{ duration: 0.45 }}
              >
                <div className="flex items-center justify-center gap-2 sm:gap-3 mb-2">
                  {digits.map((d, i) => (
                    <OtpBox
                      key={i}
                      index={i}
                      value={d}
                      focused={focusIdx === i}
                      hasError={Boolean(error)}
                      inputRef={el => { inputRefs.current[i] = el; }}
                      onChange={e => handleChange(i, e)}
                      onKeyDown={e => handleKeyDown(i, e)}
                      onFocus={() => setFocusIdx(i)}
                      onPaste={handlePaste}
                    />
                  ))}
                </div>
              </motion.div>

              {/* Expiry hint */}
              <p className="text-center text-xs text-white/35 mb-7 mt-1">
                Code valid for <span className="text-gold-light font-semibold">15 minutes</span>
              </p>

              {/* Verify button */}
              <button
                type="button"
                onClick={handleVerify}
                disabled={!isFull || loading}
                className="w-full flex items-center justify-center gap-2.5
                  bg-logo-gradient text-surface-dark
                  font-bold text-base py-4 rounded-xl
                  hover:shadow-lg hover:shadow-gold/20 hover:scale-[1.01]
                  active:scale-[0.99] transition-all disabled:opacity-40 disabled:cursor-not-allowed
                  disabled:hover:scale-100 disabled:hover:shadow-none"
              >
                {loading
                  ? <div className="w-5 h-5 border-2 border-surface-dark border-t-transparent rounded-full animate-spin" />
                  : 'Confirm & Create Account'}
              </button>

              {/* Resend section */}
              <div className="mt-6 text-center">
                {!timer.expired ? (
                  <p className="text-sm text-white/40">
                    Resend code in{' '}
                    <span className="font-mono font-semibold text-gold-light">{timer.formatted}</span>
                  </p>
                ) : (
                  <button
                    type="button"
                    onClick={handleResend}
                    disabled={resending}
                    className="inline-flex items-center gap-2 text-sm font-semibold text-gold-light
                      hover:text-white transition-colors disabled:opacity-50"
                  >
                    {resending
                      ? <div className="w-3.5 h-3.5 border-2 border-gold-light border-t-transparent rounded-full animate-spin" />
                      : <RefreshCw size={14} />}
                    {resending ? 'Sending…' : 'Resend verification code'}
                  </button>
                )}
              </div>

              {/* Footer hint */}
              <p className="text-center text-white/30 text-xs mt-5">
                Check your spam folder if you don't see the email.
              </p>
            </>
          )}

        </motion.div>
      </div>
    </div>
  );
}
