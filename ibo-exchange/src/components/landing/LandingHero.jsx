import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, Zap } from 'lucide-react';
import HeroOrbitLines from '@/components/landing/HeroOrbitLines';
import { useTheme } from '@/context/ThemeContext';

/* Height-locked so square coin/card match tall shield visually */
const FLOAT_ICON_SIZE = 'h-32 sm:h-40 md:h-48 lg:h-56 w-auto';

const FLOAT_ICONS = [
  {
    src: '/hero-icons/shield.png?v=4',
    alt: 'Secure growth',
    className: 'left-[3%] sm:left-[7%] bottom-[11%] sm:bottom-[15%]',
    sizeClass: FLOAT_ICON_SIZE,
    delay: 0,
    y: 18,
    rotate: 6,
    duration: 5.6,
    x: 0,
  },
  {
    src: '/hero-icons/card.png?v=4',
    alt: 'Portfolio assets',
    className: 'left-1/2 bottom-[1%] sm:bottom-[3%]',
    sizeClass: FLOAT_ICON_SIZE,
    delay: 0.35,
    y: 22,
    rotate: -5,
    duration: 6.2,
    x: '-50%',
  },
  {
    src: '/hero-icons/coin.png?v=4',
    alt: 'Digital assets',
    className: 'right-[3%] sm:right-[7%] bottom-[12%] sm:bottom-[16%]',
    sizeClass: FLOAT_ICON_SIZE,
    delay: 0.15,
    y: 16,
    rotate: 7,
    duration: 5.0,
    x: 0,
  },
];

const TYPEWRITER_PHRASES = [
  'Deposit, trade & grow on IBO Exchange',
  'Trade USDT pairs & IBO Markets',
  'Fund with USDT & BEP-20',
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

    let delay = deleting ? 28 : 55;
    if (!deleting && atEnd) delay = 2200;
    if (deleting && atStart) delay = 400;

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

  // Highlight “grow” when that word is fully visible in the first phrase
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
    <h1
      className="hero-typewriter max-w-3xl font-display font-bold tracking-tight text-white min-h-[1.3em]"
      style={{
        fontSize: 'clamp(1.65rem, 4.2vw, 2.75rem)',
        lineHeight: 1.15,
        letterSpacing: '-0.02em',
        textShadow: '0 2px 24px rgba(0,0,0,0.35), 0 12px 48px rgba(0,0,0,0.4)',
      }}
      aria-label={phrases[0]}
    >
      <span>{renderText()}</span>
      {!reduceMotion ? (
        <span
          className="hero-type-caret ml-0.5 inline-block w-[0.08em] h-[0.9em] translate-y-[0.08em] bg-[#C5E35B] align-middle"
          aria-hidden
        />
      ) : null}
    </h1>
  );
}

/**
 * Webze-style centered hero for IBO Exchange homepage.
 * Keeps existing IBO copy + brand cyan/lime/blue theme.
 */
export default function LandingHero() {
  const { isLight } = useTheme();

  return (
    // Pull under sticky home nav so the first viewport centers like the old fixed-nav hero
    <section
      className={`relative min-h-[100svh] flex flex-col overflow-hidden
        -mt-[4.75rem] sm:-mt-[5.5rem] lg:-mt-[6rem]
        pt-[4.75rem] sm:pt-[5.5rem] lg:pt-[6rem]
        pb-24 sm:pb-28 md:pb-32 ${isLight ? 'hero-light' : ''}`}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 z-0" aria-hidden>
        {isLight ? (
          <>
            {/* Cool mist base */}
            <div
              className="absolute inset-0"
              style={{
                background:
                  'linear-gradient(165deg, #eef3f6 0%, #f4f8fa 38%, #e8f2f4 68%, #eef3f6 100%)',
              }}
            />
            {/* Soft brand aurora — richer color presence */}
            <div
              className="absolute inset-0"
              style={{
                background: `
                  radial-gradient(ellipse 55% 45% at 50% 28%, rgba(14,164,171,0.32) 0%, transparent 62%),
                  radial-gradient(ellipse 40% 32% at 12% 70%, rgba(14,164,171,0.18) 0%, transparent 60%),
                  radial-gradient(ellipse 38% 30% at 88% 18%, rgba(197,227,91,0.28) 0%, transparent 58%),
                  radial-gradient(ellipse 30% 28% at 78% 78%, rgba(27,95,255,0.14) 0%, transparent 55%),
                  radial-gradient(ellipse 42% 36% at 50% 72%, rgba(91,184,255,0.16) 0%, transparent 65%)
                `,
              }}
            />
            {/* Subtle grid texture */}
            <div
              className="absolute inset-0 opacity-[0.55]"
              style={{
                backgroundImage: `
                  linear-gradient(rgba(14,164,171,0.11) 1px, transparent 1px),
                  linear-gradient(90deg, rgba(14,164,171,0.11) 1px, transparent 1px)
                `,
                backgroundSize: '48px 48px',
                maskImage: 'radial-gradient(ellipse 70% 60% at 50% 40%, #000 20%, transparent 75%)',
                WebkitMaskImage: 'radial-gradient(ellipse 70% 60% at 50% 40%, #000 20%, transparent 75%)',
              }}
            />
            {/* Bottom fade into page */}
            <div
              className="absolute inset-x-0 bottom-0 h-40"
              style={{
                background: 'linear-gradient(180deg, transparent 0%, #eef3f6 92%)',
              }}
            />
          </>
        ) : (
          <>
            <img
              src="/hero/hero-bg-space.png?v=1"
              alt=""
              className="h-full w-full object-cover object-[center_30%]"
              draggable={false}
              decoding="async"
            />
            <div
              className="absolute inset-0"
              style={{
                background:
                  'linear-gradient(180deg, rgba(5,7,12,0.45) 0%, rgba(5,7,12,0.28) 40%, rgba(5,7,12,0.78) 100%)',
              }}
            />
            <div
              className="absolute inset-0"
              style={{
                background:
                  'radial-gradient(ellipse 60% 50% at 50% 32%, rgba(5,7,12,0.35) 0%, transparent 70%)',
              }}
            />
          </>
        )}
      </div>

      {/* Soft content scrim — keeps typewriter / CTAs readable */}
      <div className="pointer-events-none absolute inset-0 z-[1]" aria-hidden>
        <div
          className="absolute inset-0"
          style={{
            background: isLight
              ? 'radial-gradient(ellipse 52% 42% at 50% 36%, rgba(255,255,255,0.72) 0%, rgba(255,255,255,0.28) 42%, transparent 70%)'
              : 'radial-gradient(ellipse 56% 46% at 50% 34%, rgba(5,7,12,0.42) 0%, rgba(5,7,12,0.16) 45%, transparent 72%)',
          }}
        />
      </div>

      {/* Animated semi-circle / orbital lines */}
      <HeroOrbitLines />

      {/* Floating 3D icons — named assets, natural aspect ratio (no stretch) */}
      {FLOAT_ICONS.map((icon) => (
        <motion.img
          key={icon.src}
          src={icon.src}
          alt={icon.alt}
          width={400}
          height={400}
          className={`pointer-events-none absolute z-[2] select-none object-contain object-center bg-transparent ${icon.className} ${icon.sizeClass} ${
            isLight ? 'opacity-90' : 'opacity-95'
          }`}
          style={{
            willChange: 'transform',
            filter: isLight
              ? 'drop-shadow(0 0 18px rgba(14,164,171,0.22)) drop-shadow(0 14px 28px rgba(12,25,34,0.12))'
              : 'drop-shadow(0 12px 28px rgba(0,0,0,0.35))',
          }}
          decoding="async"
          draggable={false}
          initial={{ opacity: 0, x: icon.x, y: 48, rotate: icon.rotate * -0.5 }}
          animate={{
            opacity: isLight ? 0.9 : 0.95,
            x: icon.x,
            y: [0, -icon.y, 0],
            rotate: [icon.rotate * -0.35, icon.rotate, icon.rotate * -0.35],
          }}
          transition={{
            opacity: { duration: 0.9, delay: 0.45 + icon.delay },
            x: { duration: 0 },
            y: {
              duration: icon.duration,
              repeat: Infinity,
              ease: 'easeInOut',
              delay: 0.7 + icon.delay,
            },
            rotate: {
              duration: icon.duration * 1.15,
              repeat: Infinity,
              ease: 'easeInOut',
              delay: 0.7 + icon.delay,
            },
          }}
        />
      ))}

      {/* Centered content — light top pad only (nav clearance is on the section) */}
      <div className="relative z-[3] flex flex-1 flex-col items-center justify-center px-4 sm:px-6 pt-2 sm:pt-4 pb-10 sm:pb-12 text-center">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className={`mb-5 sm:mb-6 inline-flex items-center rounded-full px-3.5 py-1.5 backdrop-blur-md border ${
            isLight
              ? 'border-[rgba(14,164,171,0.28)] bg-white/75 shadow-[0_8px_24px_rgba(14,164,171,0.1)]'
              : 'border-[#0EA4AB]/35 bg-[#0EA4AB]/10'
          }`}
        >
          <span
            className={`text-[10px] sm:text-[11px] font-semibold uppercase tracking-[0.2em] ${
              isLight ? 'text-[#0a8f95]' : 'text-[#C5E35B]'
            }`}
          >
            IBO · USDT · BEP-20
          </span>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.65, delay: 0.05, ease: [0.22, 1, 0.36, 1] }}
        >
          <TypewriterHeading />
        </motion.div>

        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, delay: 0.12 }}
          className="mt-3 sm:mt-4 text-sm sm:text-base md:text-lg font-semibold text-gradient leading-snug"
        >
          IBO token · USDT majors · Web3 on BNB Chain
        </motion.p>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
          className={`mt-3 sm:mt-4 max-w-lg text-xs sm:text-sm leading-relaxed ${
            isLight ? 'text-[color:var(--ibo-ink-secondary)]' : 'text-zinc-400'
          }`}
        >
          Fund with USDT or search any supported BEP-20 token — then trade on USDT pairs or IBO Markets.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.28 }}
          className="mt-7 sm:mt-8 flex flex-wrap items-center justify-center gap-3"
        >
          <Link
            to="/register"
            className={`hero-cta-btn group relative inline-flex items-center justify-center gap-2 overflow-hidden rounded-full bg-logo-gradient px-7 py-3.5 text-xs sm:text-sm font-bold uppercase tracking-wide text-[#050a1a] whitespace-nowrap ${
              isLight
                ? 'shadow-[0_14px_36px_rgba(14,164,171,0.28)]'
                : 'shadow-[0_0_28px_rgba(197,227,91,0.35)]'
            }`}
          >
            <span className="pointer-events-none absolute inset-0 hero-cta-shimmer" aria-hidden />
            <span className="relative z-[1]">Create account</span>
            <ArrowRight
              size={14}
              className="relative z-[1] transition-transform duration-300 group-hover:translate-x-1"
            />
          </Link>
          <Link
            to="/quick-trade"
            className={`ibo-hover-scale inline-flex items-center justify-center gap-2 rounded-full px-7 py-3.5 text-xs sm:text-sm font-bold whitespace-nowrap transition-all ${
              isLight ? 'ibo-btn-accent' : 'hover:brightness-110'
            }`}
            style={
              isLight
                ? { textDecoration: 'none' }
                : {
                    background: 'linear-gradient(135deg, rgba(14,164,171,0.22), rgba(197,227,91,0.18))',
                    border: '1px solid rgba(197,227,91,0.45)',
                    color: '#C5E35B',
                    boxShadow: '0 0 28px rgba(197,227,91,0.22)',
                    textDecoration: 'none',
                  }
            }
          >
            <Zap size={15} />
            Quick Trade
          </Link>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.45 }}
          className={`mt-5 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[10px] sm:text-[11px] font-medium uppercase tracking-[0.14em] ${
            isLight ? 'text-[color:var(--ibo-muted)]' : 'text-zinc-500'
          }`}
        >
          <span>Maker 0.05%</span>
          <span className={isLight ? 'text-[color:var(--ibo-border-solid)]' : 'text-white/20'}>·</span>
          <span>Taker 0.10%</span>
          <span className={isLight ? 'text-[color:var(--ibo-border-solid)]' : 'text-white/20'}>·</span>
          <span>Instant KYC</span>
          <span className={isLight ? 'text-[color:var(--ibo-border-solid)]' : 'text-white/20'}>·</span>
          <span>99.98% uptime</span>
        </motion.div>
      </div>
    </section>
  );
}
