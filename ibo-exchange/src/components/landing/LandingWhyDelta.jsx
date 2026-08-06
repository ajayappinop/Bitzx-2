/**
 * Why Delta — editorial feature runway (replaces sticky stacked cards).
 * One job: show the pro-feature set as an index + spotlight, without a card grid.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight } from 'lucide-react';

const FEATURES = [
  {
    id: 'speed',
    badge: 'Execution',
    title: 'Ultra-Fast Execution',
    desc: 'Pro matching for F&O and spot — orders fill with low latency so you can react when the market moves.',
    art: '/hero/platform-dollar-medal.png?v=11',
    accent: '#00A876',
    href: '/futures/BTCUSDT-PERP',
    cta: 'Trade futures',
  },
  {
    id: 'security',
    badge: 'Security',
    title: 'Bank-Grade Security',
    desc: 'Multi-factor security, custody controls, withdrawal checks, and FIU-aligned compliance for Indian users.',
    art: '/hero/why-vault-safe.png?v=11',
    accent: '#FE6C02',
    href: '/markets',
    cta: 'Explore markets',
  },
  {
    id: 'charts',
    badge: 'Charts',
    title: 'TradingView Charts',
    desc: 'Pro charts with 100+ indicators, drawings, and multi-timeframe analysis for futures, options, and spot.',
    art: '/hero/why-btc-coins.png?v=13',
    accent: '#B44D01',
    href: '/futures/BTCUSDT-PERP',
    cta: 'Open charts',
  },
  {
    id: 'liquidity',
    badge: '24/7',
    title: '24/7 Open Markets',
    desc: 'Trade Bitcoin and Ether F&O around the clock with efficient margining and deep books.',
    art: '/hero/why-usdc-coin.png?v=1',
    accent: '#FE6C02',
    href: '/markets',
    cta: 'View markets',
  },
  {
    id: 'portfolio',
    badge: 'Portfolio',
    title: 'Positions & P/L',
    desc: 'Track futures, options, and spot in one portfolio — margin and P/L ready for INR settlement rails.',
    art: '/hero/why-crypto-cubes.png?v=11',
    accent: '#00A876',
    href: '/account/positions',
    cta: 'View positions',
  },
  {
    id: 'kyc',
    badge: 'KYC',
    title: 'Instant KYC',
    desc: 'Aadhaar, PAN, live face match, and bank verification — onboard in minutes, not days.',
    art: '/hero/why-secure-wallet.png?v=12',
    accent: '#FE6C02',
    href: '/account/kyc',
    cta: 'Start KYC',
  },
  {
    id: 'inr',
    badge: 'INR',
    title: 'Deposit & Withdraw INR',
    desc: 'Fund with bank or UPI, trade crypto without owning underlying coins, and withdraw INR to your verified account.',
    art: '/hero/why-shield.png?v=11',
    accent: '#00A876',
    href: '/wallet/deposit/inr',
    cta: 'Deposit INR',
  },
];

const ease = [0.16, 1, 0.3, 1];

export default function LandingWhyDelta() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const feature = FEATURES[active];

  const go = useCallback((i) => {
    setActive((i + FEATURES.length) % FEATURES.length);
  }, []);

  useEffect(() => {
    if (paused) return undefined;
    const id = window.setInterval(() => go(active + 1), 5200);
    return () => window.clearInterval(id);
  }, [active, paused, go]);

  return (
    <section
      className="ibo-why-delta relative border-y border-white/[0.06] overflow-x-clip"
      style={{ background: 'var(--ibo-bg)' }}
      aria-labelledby="why-delta-heading"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setPaused(false);
      }}
    >
      {/* Atmosphere — not the main visual */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 70% 45% at 12% 18%, rgba(254,108,2,0.1) 0%, transparent 55%), radial-gradient(ellipse 55% 40% at 88% 72%, rgba(0,168,118,0.08) 0%, transparent 50%)',
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{
          background: 'linear-gradient(90deg, transparent, rgba(254,108,2,0.45), rgba(0,168,118,0.3), transparent)',
        }}
      />

      <div className="relative ibo-landing-container ibo-section-y">
        {/* Header — one job */}
        <motion.header
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 0.55, ease }}
          className="max-w-2xl mb-10 md:mb-14 lg:mb-16"
        >
          <p className="ibo-eyebrow mb-4">Why Delta</p>
          <h2 id="why-delta-heading" className="ibo-title-lg mb-4">
            Best-in-class pro features for everyone
          </h2>
          <p className="ibo-lead text-zinc-400 max-w-xl">
            Trade crypto F&amp;O 24/7 with efficient margining, Instant KYC, and INR deposit &amp; withdrawal.
          </p>
        </motion.header>

        {/* Split runway: index + spotlight */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 xl:gap-16 items-start">
          {/* Feature index */}
          <motion.div
            initial={{ opacity: 0, x: -16 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: '-40px' }}
            transition={{ duration: 0.55, ease }}
            className="lg:col-span-5 xl:col-span-5 min-w-0"
            role="tablist"
            aria-label="Why Delta features"
          >
            <ol className="m-0 p-0 list-none">
              {FEATURES.map((item, i) => {
                const isOn = i === active;
                return (
                  <li
                    key={item.id}
                    className="border-b border-[color:var(--ibo-border)] last:border-b-0"
                  >
                    <button
                      type="button"
                      role="tab"
                      aria-selected={isOn}
                      aria-controls="why-delta-panel"
                      id={`why-delta-tab-${item.id}`}
                      onClick={() => go(i)}
                      onMouseEnter={() => go(i)}
                      className="ibo-why-delta__row group w-full text-left py-4 sm:py-5 flex gap-4 sm:gap-5 items-start transition-colors"
                    >
                      <span
                        className="shrink-0 pt-1 font-mono text-[11px] sm:text-[12px] font-semibold tabular-nums tracking-wider transition-colors"
                        style={{ color: isOn ? item.accent : 'var(--ibo-muted)' }}
                      >
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span
                          className="block font-display text-[0.98rem] sm:text-[1.08rem] font-bold tracking-tight transition-colors"
                          style={{ color: isOn ? 'var(--ibo-ink)' : 'var(--ibo-ink-secondary)' }}
                        >
                          {item.title}
                        </span>
                        <span
                          className={`mt-1.5 block text-[13px] leading-relaxed text-zinc-500 transition-[max-height,opacity] duration-300 overflow-hidden ${
                            isOn ? 'max-h-28 opacity-100' : 'max-h-0 opacity-0'
                          }`}
                        >
                          {item.desc}
                        </span>
                      </span>
                      <span
                        aria-hidden
                        className="mt-2.5 h-1.5 w-1.5 rounded-full shrink-0 transition-all duration-300"
                        style={{
                          background: isOn ? item.accent : 'transparent',
                          boxShadow: isOn ? `0 0 12px ${item.accent}88` : 'none',
                          transform: isOn ? 'scale(1)' : 'scale(0.5)',
                        }}
                      />
                    </button>
                    <div className="relative h-px w-full -mt-px overflow-hidden" aria-hidden>
                      {isOn && !paused && (
                        <motion.div
                          key={`rail-${item.id}`}
                          className="absolute inset-y-0 left-0 h-px origin-left"
                          style={{ background: item.accent, width: '100%' }}
                          initial={{ scaleX: 0 }}
                          animate={{ scaleX: 1 }}
                          transition={{ duration: 5.2, ease: 'linear' }}
                        />
                      )}
                      {isOn && paused && (
                        <div
                          className="absolute inset-y-0 left-0 h-px w-full opacity-70"
                          style={{ background: item.accent }}
                        />
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </motion.div>

          {/* Spotlight stage */}
          <motion.div
            initial={{ opacity: 0, x: 18 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: '-40px' }}
            transition={{ duration: 0.6, delay: 0.06, ease }}
            className="lg:col-span-7 xl:col-span-7 min-w-0 lg:sticky lg:top-20"
          >
            <div
              id="why-delta-panel"
              role="tabpanel"
              aria-labelledby={`why-delta-tab-${feature.id}`}
              className="ibo-why-delta__stage relative overflow-hidden py-2 sm:py-4"
            >
              {/* Soft stage wash — not a card */}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 transition-[background] duration-500"
                style={{
                  background: `radial-gradient(ellipse 75% 55% at 50% 28%, ${feature.accent}33 0%, transparent 62%)`,
                }}
              />
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-8 bottom-0 h-px"
                style={{
                  background: `linear-gradient(90deg, transparent, ${feature.accent}88, transparent)`,
                }}
              />

              <AnimatePresence mode="wait">
                <motion.div
                  key={feature.id}
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.4, ease }}
                  className="relative z-[1] flex flex-col items-center text-center px-2"
                >
                  {/* Fixed image slot — tight gap to copy */}
                  <motion.div
                    className="ibo-why-delta__art flex items-center justify-center w-full max-w-[300px] sm:max-w-[340px] lg:max-w-[380px] h-[220px] sm:h-[250px] lg:h-[280px] mb-4 sm:mb-5"
                    animate={{ y: [0, -6, 0] }}
                    transition={{ duration: 4.5, repeat: Infinity, ease: 'easeInOut' }}
                  >
                    <img
                      src={feature.art}
                      alt=""
                      draggable={false}
                      loading="lazy"
                      decoding="async"
                      className="ibo-3d-icon--soft max-h-full max-w-full w-auto h-auto object-contain"
                    />
                  </motion.div>

                  <div className="flex flex-col items-center w-full max-w-md">
                    <p
                      className="text-[11px] font-semibold uppercase tracking-[0.18em] mb-1.5 h-4 leading-4"
                      style={{ color: feature.accent }}
                    >
                      {feature.badge}
                    </p>
                    <h3 className="font-display text-[1.35rem] sm:text-[1.55rem] lg:text-[1.65rem] font-bold text-[color:var(--ibo-ink)] tracking-tight leading-tight mb-2 min-h-[2.5em] flex items-center justify-center">
                      {feature.title}
                    </h3>
                    <p className="text-[14px] sm:text-[15px] text-zinc-400 leading-relaxed mb-4 min-h-[4.05em] line-clamp-3">
                      {feature.desc}
                    </p>
                    <Link
                      to={feature.href}
                      className="inline-flex items-center gap-2 text-[14px] sm:text-[15px] font-semibold transition-opacity hover:opacity-90"
                      style={{ color: feature.accent }}
                    >
                      {feature.cta}
                      <ArrowRight size={16} strokeWidth={2.2} />
                    </Link>
                  </div>
                </motion.div>
              </AnimatePresence>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
