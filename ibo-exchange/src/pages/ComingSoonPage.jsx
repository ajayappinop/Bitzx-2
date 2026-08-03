/**
 * ComingSoonPage — shown when the admin enables the "Coming Soon" gate.
 * All other routes are blocked until the admin turns it off.
 */
import { useEffect, useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { Clock, Globe, X as XIcon, Send, Star } from 'lucide-react';

import BrandLogo from '@/components/ui/BrandLogo';

const TOKEN = import.meta.env.VITE_TOKEN_URL || 'https://ibo.io';

// ── Countdown helpers ─────────────────────────────────────────────────────────
function parseDate(str) {
  if (!str) return null;
  // datetime-local gives "2026-05-20T14:00" — append seconds if missing so
  // Date() parses it consistently across browsers.
  const normalised = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(str.trim()) ? `${str}:00` : str;
  const d = new Date(normalised);
  return isNaN(d.getTime()) ? null : d;
}

function calcTimeLeft(targetIso) {
  const target = parseDate(targetIso);
  if (!target) return null;
  const diff = target.getTime() - Date.now();
  if (diff <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0, launched: true };
  return {
    days:     Math.floor(diff / 86_400_000),
    hours:    Math.floor((diff % 86_400_000) / 3_600_000),
    minutes:  Math.floor((diff % 3_600_000) / 60_000),
    seconds:  Math.floor((diff % 60_000) / 1_000),
    launched: false,
  };
}

function CountdownBlock({ value, label }) {
  return (
    <div className="flex flex-col items-center gap-1 min-w-[60px]">
      <div className="relative">
        <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl border border-gold/30 bg-black/40 backdrop-blur-sm flex items-center justify-center">
          <span className="text-2xl sm:text-3xl font-extrabold text-white tabular-nums font-mono">
            {String(value).padStart(2, '0')}
          </span>
        </div>
        <div className="absolute inset-0 rounded-2xl bg-gradient-to-b from-gold/5 to-transparent pointer-events-none" />
      </div>
      <span className="text-[10px] sm:text-xs font-bold uppercase tracking-widest text-white/45">{label}</span>
    </div>
  );
}

// ── Animated particle background ─────────────────────────────────────────────
function Particles() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
      {Array.from({ length: 18 }).map((_, i) => (
        <motion.div
          key={i}
          className="absolute rounded-full bg-gold/20"
          style={{
            width:  Math.random() * 4 + 2,
            height: Math.random() * 4 + 2,
            left:   `${Math.random() * 100}%`,
            top:    `${Math.random() * 100}%`,
          }}
          animate={{
            y:       [0, -30 - Math.random() * 60, 0],
            opacity: [0, 0.7, 0],
          }}
          transition={{
            duration: 4 + Math.random() * 6,
            repeat:   Infinity,
            delay:    Math.random() * 6,
            ease:     'easeInOut',
          }}
        />
      ))}
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────
export default function ComingSoonPage({ message, launchDate }) {
  const [timeLeft, setTimeLeft] = useState(() => calcTimeLeft(launchDate));
  const intervalRef = useRef(null);
  const hasCountdown = !!launchDate && timeLeft !== null;

  useEffect(() => {
    if (!launchDate) return;
    intervalRef.current = setInterval(() => {
      setTimeLeft(calcTimeLeft(launchDate));
    }, 1000);
    return () => clearInterval(intervalRef.current);
  }, [launchDate]);

  return (
    <div className="ibo-page flex flex-col items-center justify-center relative overflow-hidden px-4">

      {/* Radial glow background */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(254, 108, 2,0.12) 0%, transparent 70%)' }} />
        <div className="absolute top-0 right-0 w-96 h-96 rounded-full opacity-30"
          style={{ background: 'radial-gradient(circle, rgba(0, 168, 118,0.12) 0%, transparent 70%)' }} />
        <div className="absolute bottom-0 left-0 w-80 h-80 rounded-full opacity-25"
          style={{ background: 'radial-gradient(circle, rgba(180, 77, 1,0.12) 0%, transparent 70%)' }} />
      </div>

      <Particles />

      {/* Grid overlay */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.025]"
        style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.5) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.5) 1px,transparent 1px)', backgroundSize: '48px 48px' }} />

      {/* Content */}
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-10 flex flex-col items-center text-center max-w-2xl w-full"
      >
        {/* Logo */}
        <motion.div
          initial={{ scale: 0.7, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.1, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="mb-8"
        >
          <div className="relative inline-flex">
            <div className="absolute inset-0 rounded-full blur-2xl bg-[#FE6C02]/25 scale-150 opacity-50" />
            <BrandLogo alt="Exchange" className="relative h-14 sm:h-16 w-auto max-w-[240px] object-contain" />
          </div>
        </motion.div>

        {/* Badge */}
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.2 }}
          className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-gold/30 bg-gold/10 mb-5"
        >
          <Star size={13} className="text-gold-light fill-gold-light" />
          <span className="text-xs font-bold uppercase tracking-widest text-gold-light">
            Launching Soon
          </span>
          <Star size={13} className="text-gold-light fill-gold-light" />
        </motion.div>

        {/* Headline */}
        <motion.h1
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          className="font-display text-4xl sm:text-6xl font-extrabold text-white mb-4 leading-tight tracking-tight"
        >
          Delta Exchange
          <br />
          <span className="bg-gradient-to-r from-gold-light via-gold to-gold-light bg-clip-text text-transparent">
            Coming Soon
          </span>
        </motion.h1>

        {/* Custom message or default tagline */}
        <motion.p
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.32 }}
          className="text-base sm:text-lg text-white/65 max-w-lg leading-relaxed mb-10"
        >
          {message || 'The next-generation crypto exchange powered by $DELTA is almost here. Join the waitlist and be the first to trade.'}
        </motion.p>

        {/* Countdown (only when launch date is provided) */}
        {hasCountdown && timeLeft && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.38 }}
            className="mb-10"
          >
            {timeLeft.launched ? (
              <div className="flex items-center gap-2 justify-center px-6 py-3 rounded-full border border-emerald-500/30 bg-emerald-500/10">
                <span className="text-emerald-400 font-bold text-sm">🚀 We are live! Exchange opening shortly…</span>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 mb-5 justify-center">
                  <Clock size={14} className="text-gold-light" />
                  <span className="text-xs font-bold uppercase tracking-widest text-white/45">
                    Countdown to launch
                  </span>
                </div>
                <div className="flex items-start gap-3 sm:gap-4 justify-center">
                  <CountdownBlock value={timeLeft.days}    label="Days" />
                  <div className="text-2xl font-extrabold text-gold-light/60 mt-4">:</div>
                  <CountdownBlock value={timeLeft.hours}   label="Hours" />
                  <div className="text-2xl font-extrabold text-gold-light/60 mt-4">:</div>
                  <CountdownBlock value={timeLeft.minutes} label="Minutes" />
                  <div className="text-2xl font-extrabold text-gold-light/60 mt-4">:</div>
                  <CountdownBlock value={timeLeft.seconds} label="Seconds" />
                </div>
              </>
            )}
          </motion.div>
        )}

        {/* Divider */}
        <motion.div
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ delay: 0.45, duration: 0.6 }}
          className="w-32 h-px bg-gradient-to-r from-transparent via-gold/50 to-transparent mb-8"
        />

        {/* Feature pills */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="flex flex-wrap justify-center gap-2 mb-10"
        >
          {['Spot Trading', 'Delta Markets', 'Futures', 'P2P', 'Low Fees', 'Secure'].map((f) => (
            <span key={f} className="px-3 py-1.5 rounded-full border border-white/10 bg-white/[0.04] text-xs font-semibold text-white/60">
              {f}
            </span>
          ))}
        </motion.div>

        {/* Social / CTA links */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.55 }}
          className="flex flex-wrap items-center justify-center gap-3"
        >
          <a href={TOKEN} target="_blank" rel="noopener noreferrer"
            className="ibo-btn-primary px-6 py-3 shadow-[0_16px_40px_rgba(0, 168, 118,0.2)]">
            <Globe size={16} /> Visit Delta.io
          </a>
          <a href="https://twitter.com/iboofficial" target="_blank" rel="noopener noreferrer"
            className="ibo-btn-secondary">
            <XIcon size={15} /> Twitter / X
          </a>
          <a href="https://t.me/iboofficial" target="_blank" rel="noopener noreferrer"
            className="ibo-btn-secondary">
            <Send size={15} /> Telegram
          </a>
        </motion.div>

        {/* Fine print */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.65 }}
          className="mt-12 text-xs text-white/25"
        >
          © {new Date().getFullYear()} Delta Exchange · Powered by $DELTA on BNB Chain
        </motion.p>
      </motion.div>
    </div>
  );
}
