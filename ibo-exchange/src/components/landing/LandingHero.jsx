import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, Zap } from 'lucide-react';
import HeroOrbitLines from '@/components/landing/HeroOrbitLines';
import { useTheme } from '@/context/ThemeContext';

/**
 * Floating 3D icons — positioned as a shallow arc under the copy (matches marketing hero).
 * Sizes are driven by .ibo-hero-float in CSS.
 */
const FLOAT_ICONS = [
  {
    src: '/hero-icons/shield.png?v=4',
    alt: 'Secure growth',
    className: 'ibo-hero-float--left',
    delay: 0,
    y: 12,
    rotate: 5,
    duration: 5.6,
  },
  {
    src: '/hero-icons/card.png?v=4',
    alt: 'Portfolio assets',
    className: 'ibo-hero-float--center',
    delay: 0.3,
    y: 14,
    rotate: -4,
    duration: 6.2,
  },
  {
    src: '/hero-icons/coin.png?v=4',
    alt: 'Digital assets',
    className: 'ibo-hero-float--right',
    delay: 0.12,
    y: 12,
    rotate: 6,
    duration: 5.1,
  },
];

const TYPEWRITER_PHRASES = [
  'Trade Futures & Options on Bitcoin and Ether',
  'Deposit INR, Withdraw INR',
  'Trade Crypto without owning it',
];

function TypewriterHeading({ phrases = TYPEWRITER_PHRASES }) {
  const [phraseIndex, setPhraseIndex] = useState(0);
  const [charIndex, setCharIndex] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  const phrase = phrases[phraseIndex];

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduceMotion(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (reduceMotion) return undefined;

    const atEnd = charIndex === phrase.length;
    const atStart = charIndex === 0;

    let delay = deleting ? 28 : 52;
    if (!deleting && atEnd) delay = 2400;
    if (deleting && atStart) delay = 380;

    const id = window.setTimeout(() => {
      if (!deleting && atEnd) {
        setDeleting(true);
        return;
      }
      if (deleting && atStart) {
        setDeleting(false);
        setPhraseIndex((i) => (i + 1) % phrases.length);
        return;
      }
      setCharIndex((c) => c + (deleting ? -1 : 1));
    }, delay);

    return () => window.clearTimeout(id);
  }, [charIndex, deleting, phrase, phrases.length, reduceMotion]);

  const visible = reduceMotion ? phrases[0] : phrase.slice(0, charIndex);

  const renderText = () => {
    const growAt = visible.indexOf('grow');
    if (growAt === -1) return visible;
    const before = visible.slice(0, growAt);
    const grow = visible.slice(growAt, growAt + 4);
    const after = visible.slice(growAt + 4);
    return (
      <>
        {before}
        <span className="text-gradient">{grow}</span>
        {after}
      </>
    );
  };

  return (
    <h1 className="hero-typewriter" aria-label={phrases[0]}>
      <span>{renderText()}</span>
      {!reduceMotion ? (
        <span className="hero-type-caret" aria-hidden />
      ) : null}
    </h1>
  );
}

/**
 * Marketing homepage hero — centered type, orbital backdrop, lower-arc 3D floats.
 */
export default function LandingHero() {
  const { isLight } = useTheme();

  return (
    <section className={`ibo-landing-hero ${isLight ? 'hero-light' : ''}`}>
      {/* Backdrop */}
      <div className="absolute inset-0 z-0" aria-hidden>
        {isLight ? (
          <>
            <div
              className="absolute inset-0"
              style={{
                background: 'linear-gradient(180deg, #f7f7f8 0%, #f3f4f6 48%, #f7f7f8 100%)',
              }}
            />
            <div
              className="absolute inset-0"
              style={{
                background: `
                  radial-gradient(ellipse 48% 42% at 12% 78%, rgba(254, 108, 2, 0.16) 0%, transparent 62%),
                  radial-gradient(ellipse 42% 36% at 88% 18%, rgba(0, 168, 118, 0.14) 0%, transparent 58%),
                  radial-gradient(ellipse 50% 40% at 50% 32%, rgba(254, 157, 85, 0.08) 0%, transparent 68%)
                `,
              }}
            />
            <div
              className="absolute inset-0 opacity-50"
              style={{
                backgroundImage: `
                  linear-gradient(rgba(18, 20, 24, 0.045) 1px, transparent 1px),
                  linear-gradient(90deg, rgba(18, 20, 24, 0.045) 1px, transparent 1px)
                `,
                backgroundSize: '52px 52px',
                maskImage: 'radial-gradient(ellipse 72% 62% at 50% 42%, #000 18%, transparent 78%)',
                WebkitMaskImage: 'radial-gradient(ellipse 72% 62% at 50% 42%, #000 18%, transparent 78%)',
              }}
            />
            <div
              className="absolute inset-x-0 bottom-0 h-28"
              style={{ background: 'linear-gradient(180deg, transparent 0%, #f7f7f8 95%)' }}
            />
          </>
        ) : (
          <>
            <div className="absolute inset-0" style={{ background: 'var(--ibo-bg)' }} />
            <img
              src="/hero/hero-bg-space.png?v=1"
              alt=""
              className="h-full w-full object-cover object-[center_30%] opacity-40 mix-blend-luminosity"
              draggable={false}
              decoding="async"
            />
            <div
              className="absolute inset-0"
              style={{
                background: `
                  radial-gradient(ellipse 55% 48% at 50% 30%, rgba(254, 108, 2, 0.2) 0%, transparent 62%),
                  radial-gradient(ellipse 40% 34% at 12% 76%, rgba(254, 108, 2, 0.12) 0%, transparent 58%),
                  radial-gradient(ellipse 40% 34% at 88% 18%, rgba(0, 168, 118, 0.14) 0%, transparent 56%)
                `,
              }}
            />
            <div
              className="absolute inset-0"
              style={{
                background:
                  'linear-gradient(180deg, rgb(var(--ibo-bg-rgb) / 0.5) 0%, rgb(var(--ibo-bg-rgb) / 0.28) 42%, rgb(var(--ibo-bg-rgb) / 0.9) 100%)',
              }}
            />
            <div
              className="absolute inset-x-0 bottom-0 h-28"
              style={{ background: 'linear-gradient(180deg, transparent 0%, var(--ibo-bg) 94%)' }}
            />
          </>
        )}
      </div>

      {/* Soft scrim behind copy for legibility */}
      <div className="pointer-events-none absolute inset-0 z-[1]" aria-hidden>
        <div
          className="absolute inset-0"
          style={{
            background: isLight
              ? 'radial-gradient(ellipse 48% 38% at 50% 38%, rgba(255,255,255,0.78) 0%, rgba(255,255,255,0.22) 48%, transparent 72%)'
              : 'radial-gradient(ellipse 52% 42% at 50% 36%, rgb(var(--ibo-bg-rgb) / 0.5) 0%, rgb(var(--ibo-bg-rgb) / 0.12) 48%, transparent 74%)',
          }}
        />
      </div>

      <HeroOrbitLines />

      {/* Centered copy stack */}
      <div className="ibo-landing-hero__content">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45 }}
          className="ibo-hero-badge"
        >
          Made for India
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.04, ease: [0.22, 1, 0.36, 1] }}
          className="w-full flex justify-center"
        >
          <TypewriterHeading />
        </motion.div>

        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="ibo-hero-sub"
        >
          24/7 open markets · efficient margining · INR settlement
        </motion.p>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.16 }}
          className="ibo-hero-lead"
        >
          Elevate your crypto F&amp;O trading with futures, options, and spot — deposit INR, trade without
          holding underlying coins, and track margin &amp; P/L on a pro terminal built for India.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.24 }}
          className="ibo-hero-ctas"
        >
          <Link to="/register" className="hero-cta-btn group">
            <span className="pointer-events-none absolute inset-0 hero-cta-shimmer" aria-hidden />
            <span className="relative z-[1]">Sign up</span>
            <ArrowRight
              size={15}
              className="relative z-[1] transition-transform duration-300 group-hover:translate-x-0.5"
            />
          </Link>
          <Link to="/futures/BTCUSDT-PERP" className="ibo-hero-cta-secondary">
            <Zap size={15} strokeWidth={2.25} />
            Trade futures
          </Link>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.38 }}
          className="ibo-hero-stats"
        >
          <span>Trade crypto without owning it</span>
          <span className="ibo-hero-stats__dot" aria-hidden>·</span>
          <span>Margin &amp; P/L in INR</span>
          <span className="ibo-hero-stats__dot" aria-hidden>·</span>
          <span>Deposit &amp; withdraw INR</span>
        </motion.div>
      </div>

      {/* Icons live in their own bottom band — never overlays text */}
      <div className="ibo-hero-floats" aria-hidden>
        {FLOAT_ICONS.map((icon) => (
          <motion.img
            key={icon.src}
            src={icon.src}
            alt=""
            width={400}
            height={400}
            className={`ibo-hero-float ${icon.className}`}
            decoding="async"
            draggable={false}
            initial={{ opacity: 0, y: 20, rotate: icon.rotate * -0.4 }}
            animate={{
              opacity: 1,
              y: [0, -icon.y, 0],
              rotate: [icon.rotate * -0.3, icon.rotate, icon.rotate * -0.3],
            }}
            transition={{
              opacity: { duration: 0.85, delay: 0.35 + icon.delay },
              y: {
                duration: icon.duration,
                repeat: Infinity,
                ease: 'easeInOut',
                delay: 0.55 + icon.delay,
              },
              rotate: {
                duration: icon.duration * 1.12,
                repeat: Infinity,
                ease: 'easeInOut',
                delay: 0.55 + icon.delay,
              },
            }}
          />
        ))}
      </div>
    </section>
  );
}
