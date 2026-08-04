import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowRight, BarChart2,
  Cpu, Eye, Zap, UserPlus, IndianRupee, LineChart, Smartphone,
} from 'lucide-react';
import { COIN_ICONS, PAIRS } from '@/services/marketApi';
import MobileAppDownload from '@/components/ui/MobileAppDownload';
import MobileAppStickyBar from '@/components/ui/MobileAppStickyBar';
import LandingPlatformFlow from '@/components/landing/LandingPlatformFlow';
import LandingInstantKyc from '@/components/landing/LandingInstantKyc';
import LandingInrFiat from '@/components/landing/LandingInrFiat';
import StackedFeatureCards from '@/components/landing/StackedFeatureCards';
import PlatformFeatureVisual from '@/components/landing/PlatformFeatureVisual';
import { LandingHomeBanners } from '@/components/dashboard/HomeBannerCarousel';
import LandingHero from '@/components/landing/LandingHero';
import LandingProductStrip from '@/components/landing/LandingProductStrip';
import LandingFaqSupport from '@/components/landing/LandingFaqSupport';

// ── Data ──────────────────────────────────────────────────────────────────────
const FEATURES_BENTO = [
  {
    key: 'speed',
    title: 'Ultra-Fast Execution',
    desc: 'Pro matching for F&O and spot — orders fill with low latency so you can react when the market moves.',
    art: '/hero/platform-dollar-medal.png?v=11',
    artFit: 'wide',
    span: 'sm:col-span-2 lg:col-span-7',
    layout: 'wide',
    glow: 'rgba(0, 168, 118,0.42)',
  },
  {
    key: 'security',
    title: 'Bank-Grade Security',
    desc: 'Multi-factor security, custody controls, withdrawal checks, and FIU-aligned compliance for Indian users.',
    art: '/hero/why-vault-safe.png?v=11',
    artFit: 'wide',
    span: 'sm:col-span-2 lg:col-span-5 lg:row-span-2',
    layout: 'tall',
    glow: 'rgba(254, 108, 2,0.45)',
  },
  {
    key: 'charts',
    title: 'TradingView Charts',
    desc: 'Pro charts with 100+ indicators, drawings, and multi-timeframe analysis for futures, options, and spot.',
    art: '/hero/why-btc-coins.png?v=13',
    span: 'sm:col-span-1 lg:col-span-4',
    layout: 'square',
    glow: 'rgba(180, 77, 1,0.32)',
  },
  {
    key: 'liquidity',
    title: '24/7 Open Markets',
    desc: 'Trade Bitcoin and Ether F&O around the clock with efficient margining and deep books.',
    art: '/hero/why-usdc-coin.png?v=1',
    span: 'sm:col-span-1 lg:col-span-3',
    layout: 'square',
    glow: 'rgba(254, 108, 2,0.4)',
  },
  {
    key: 'portfolio',
    title: 'Positions & P/L',
    desc: 'Track futures, options, and spot in one portfolio — margin and P/L ready for INR settlement rails.',
    art: '/hero/why-crypto-cubes.png?v=11',
    artFit: 'wide',
    span: 'sm:col-span-1 lg:col-span-4',
    layout: 'square',
    glow: 'rgba(0, 168, 118,0.38)',
  },
  {
    key: 'kyc',
    title: 'Instant KYC',
    desc: 'Aadhaar, PAN, live face match, and bank verification — onboard in minutes, not days.',
    art: '/hero/why-secure-wallet.png?v=12',
    artFit: 'tall',
    span: 'sm:col-span-1 lg:col-span-4',
    layout: 'square',
    glow: 'rgba(254, 108, 2,0.4)',
  },
  {
    key: 'inr',
    title: 'Deposit & Withdraw INR',
    desc: 'Fund with bank or UPI, trade crypto without owning underlying coins, and withdraw INR to your verified account.',
    art: '/hero/why-shield.png?v=11',
    artFit: 'wide',
    span: 'sm:col-span-1 lg:col-span-4',
    layout: 'square',
    glow: 'rgba(0, 168, 118,0.4)',
  },
];

function FeatureBentoCard({ feature, index }) {
  const tall = feature.layout === 'tall';
  const wide = feature.layout === 'wide';
  const radius = tall
    ? 'rounded-[1.55rem] sm:rounded-[1.65rem]'
    : wide
      ? 'rounded-[1.4rem] sm:rounded-[1.55rem]'
      : 'rounded-[1.25rem] sm:rounded-[1.45rem]';

  return (
    <motion.article
      initial={{ opacity: 0, y: 22 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ delay: Math.min(index * 0.06, 0.3), duration: 0.5 }}
      className={`group relative overflow-hidden ibo-feature-bento ${radius} border border-white/[0.08] min-h-[220px] ${
        tall ? 'min-h-[280px] lg:min-h-0' : ''
      } ${wide ? 'min-h-[260px] sm:min-h-[280px]' : ''} ${feature.span}`}
      style={{
        background:
          'linear-gradient(155deg, color-mix(in srgb, var(--ibo-card) 92%, transparent) 0%, var(--ibo-surface) 48%, var(--ibo-bg) 100%)',
        borderColor: feature.glow,
      }}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-90"
        style={{
          background: `radial-gradient(ellipse 70% 60% at ${tall ? '50% 70%' : wide ? '75% 40%' : '70% 30%'}, ${feature.glow} 0%, transparent 62%)`,
        }}
      />
      <div
        className="pointer-events-none absolute -right-8 -top-8 h-40 w-40 rounded-full blur-3xl opacity-40"
        style={{ background: feature.glow }}
      />

      <div
        className={`relative z-[1] flex h-full ${
          tall
            ? 'flex-col p-6 sm:p-7 lg:p-8'
            : wide
              ? 'flex-col justify-end p-6 sm:p-8 min-h-[260px] sm:min-h-[300px]'
              : 'flex-col p-5 sm:p-6'
        }`}
      >
        {tall ? (
          <>
            <div className="min-w-0 mb-4">
              <h3 className="font-display text-[1.25rem] sm:text-[1.4rem] font-bold text-white tracking-tight leading-tight mb-2">
                {feature.title}
              </h3>
              <p className="text-zinc-400 text-[14px] sm:text-[15px] leading-relaxed">{feature.desc}</p>
            </div>
            <div className="relative flex flex-1 items-center justify-center min-h-[220px] lg:min-h-[260px]">
              <img
                src={feature.art}
                alt=""
                className="ibo-3d-icon--soft relative z-[1] w-[min(100%,240px)] lg:w-[min(100%,280px)] h-auto object-contain transition-transform duration-500 group-hover:-translate-y-1"
                draggable={false}
                loading="lazy"
                decoding="async"
              />
            </div>
          </>
        ) : wide ? (
          <>
            <div className="absolute inset-0 flex items-center justify-end pr-2 sm:pr-6 pt-4 pointer-events-none">
              <img
                src={feature.art}
                alt=""
                className="ibo-3d-icon--soft w-[min(58%,340px)] sm:w-[min(52%,380px)] h-auto object-contain transition-transform duration-500 group-hover:-translate-y-1"
                draggable={false}
                loading="lazy"
                decoding="async"
              />
            </div>
            <div className="relative z-[2] max-w-[min(100%,22rem)] mt-auto">
              <h3 className="font-display text-[1.35rem] sm:text-[1.55rem] font-bold text-white tracking-tight leading-tight mb-2">
                {feature.title}
              </h3>
              <p className="text-zinc-400 text-[14px] sm:text-[15px] leading-relaxed">{feature.desc}</p>
            </div>
          </>
        ) : (
          <>
            <div className="min-w-0 mb-3">
              <h3 className="font-display text-[1.15rem] sm:text-[1.25rem] font-bold text-white tracking-tight leading-tight mb-2">
                {feature.title}
              </h3>
              <p className="text-zinc-400 text-[13px] sm:text-[14px] leading-relaxed">{feature.desc}</p>
            </div>
            <div className="relative flex items-center justify-center flex-1 min-h-[120px] sm:min-h-[140px]">
              <img
                src={feature.art}
                alt=""
                className="ibo-3d-icon--soft w-[min(100%,160px)] sm:w-[min(100%,180px)] h-auto object-contain transition-transform duration-500 group-hover:-translate-y-1"
                draggable={false}
                loading="lazy"
                decoding="async"
              />
            </div>
          </>
        )}
      </div>
    </motion.article>
  );
}


// ── Main page ─────────────────────────────────────────────────────────────────
export default function LandingPage() {
  return (
    <div className="ibo-landing-page" style={{ background: 'transparent' }}>
      <MobileAppStickyBar />

      <LandingHero />

      <LandingHomeBanners />

      <LandingProductStrip />

      <LandingInstantKyc />

      <LandingPlatformFlow />

      <LandingInrFiat />

      {/* ══════════════════════════════════════════════════════════════════
          PLATFORM PREVIEW STRIP
          ══════════════════════════════════════════════════════════════════ */}
      <section className="relative ibo-section-y overflow-x-hidden" style={{ background: 'var(--ibo-surface)' }}>
        <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_50%_50%,rgba(96,165,250,0.04),transparent_65%)]" />
        <div className="ibo-landing-container">
          <motion.div initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
            className="text-center mb-12 md:mb-16 max-w-3xl mx-auto">
            <p className="ibo-eyebrow mb-4">Pro platform</p>
            <h2 className="ibo-title-lg mb-5">Futures · Options · Spot in one place</h2>
            <p className="ibo-lead-wide mx-auto text-zinc-400">
              Best-in-class pro features: open a market, read 24h stats, trade with depth, and track margin &amp; P/L — without switching tools.
            </p>
          </motion.div>

          {/* Feature highlights — 3D art + vertical rail */}
          <div className="relative mb-14 md:mb-20 grid grid-cols-1 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] gap-10 lg:gap-14 xl:gap-16 items-center">
            {/* Left — interactive 3D visual */}
            <PlatformFeatureVisual src="/hero/platform-coin-machine.png?v=11" />

            {/* Right — vertical feature line */}
            <div className="relative">
              {/* Line centered through the 44px icon column (22px midpoint) */}
              <div
                aria-hidden
                className="absolute left-[21px] sm:left-[21px] top-5 bottom-5 w-px"
                style={{
                  background:
                    'linear-gradient(180deg, rgba(0, 168, 118,0.55) 0%, rgba(96,165,250,0.4) 35%, rgba(34,197,94,0.35) 70%, rgba(249,115,22,0.3) 100%)',
                }}
              />

              <div className="relative space-y-0">
                {[
                  {
                    title: 'Matching Engine',
                    stat: 'Pro latency',
                    accent: '#00A876',
                    icon: Cpu,
                    blurb: 'Fast order matching built for liquid F&O and spot flows.',
                  },
                  {
                    title: 'TradingView Charts',
                    stat: '100+ indicators',
                    accent: '#60a5fa',
                    icon: BarChart2,
                    blurb: 'Pro charting for futures, options underlyings, and spot pairs.',
                  },
                  {
                    title: 'Live P&L Tracking',
                    stat: 'Real-time updates',
                    accent: '#22c55e',
                    icon: Eye,
                    blurb: 'See open positions and performance update as the market moves — INR-ready.',
                  },
                  {
                    title: 'Quick Trade',
                    stat: '1-click orders',
                    accent: '#f97316',
                    icon: Zap,
                    blurb: 'Place orders fast from markets, charts, or the terminal.',
                  },
                ].map((item, i) => {
                  const Icon = item.icon;
                  return (
                    <motion.div
                      key={item.title}
                      initial={{ opacity: 0, x: 20 }}
                      whileInView={{ opacity: 1, x: 0 }}
                      viewport={{ once: true }}
                      transition={{ delay: i * 0.08, duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
                      className="group relative grid grid-cols-[44px_minmax(0,1fr)] gap-5 sm:gap-6 py-5 sm:py-6 items-start"
                    >
                      <div className="relative z-[1] flex justify-center">
                        <div
                          className="h-11 w-11 rounded-full grid place-items-center border-0 transition-transform duration-300 group-hover:scale-105"
                          style={{
                            background: item.accent,
                            boxShadow: `0 0 0 4px var(--ibo-surface), 0 0 22px ${item.accent}66, 0 0 40px ${item.accent}33`,
                          }}
                        >
                          <Icon size={18} strokeWidth={2.1} className="text-[#101013]" />
                        </div>
                      </div>

                      <div className="min-w-0 border-b border-white/[0.06] pb-5 sm:pb-6 group-last:border-b-0 group-last:pb-0 pt-1.5">
                        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                          <h3 className="font-display text-[1.05rem] sm:text-[1.2rem] font-bold tracking-tight text-white">
                            {item.title}
                          </h3>
                          <span
                            className="text-[12px] sm:text-[13px] font-semibold tabular-nums"
                            style={{ color: item.accent }}
                          >
                            {item.stat}
                          </span>
                        </div>
                        <p className="mt-2 text-[13px] sm:text-[14px] text-zinc-500 leading-relaxed max-w-[36ch]">
                          {item.blurb}
                        </p>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Coin showcase — infinite auto-loop carousel */}
          <div className="relative -mx-[var(--ibo-shell-pad-x)] sm:mx-0 py-2 overflow-x-hidden">
            <div
              className="pointer-events-none absolute inset-y-0 left-0 z-[2] w-12 sm:w-20 md:w-28"
              style={{ background: 'linear-gradient(90deg, var(--ibo-surface) 0%, transparent 100%)' }}
            />
            <div
              className="pointer-events-none absolute inset-y-0 right-0 z-[2] w-12 sm:w-20 md:w-28"
              style={{ background: 'linear-gradient(270deg, var(--ibo-surface) 0%, transparent 100%)' }}
            />

            <div className="coin-marquee" aria-label="Supported markets carousel">
              <div className="coin-marquee-track">
                {[...PAIRS, ...PAIRS].map((pair, i) => {
                  const icon = COIN_ICONS[pair.base];
                  return (
                    <Link
                      key={`${pair.symbol}-${i}`}
                      to={`/trade/${pair.symbol}`}
                      className="coin-marquee-item group"
                    >
                      {icon ? (
                        <img
                          src={icon}
                          alt=""
                          className="h-9 w-9 sm:h-10 sm:w-10 rounded-full object-cover ring-1 ring-white/10 group-hover:ring-[#FE6C02]/50 transition-[box-shadow]"
                          draggable={false}
                        />
                      ) : (
                        <div className="h-9 w-9 sm:h-10 sm:w-10 rounded-full bg-white/[0.06] ring-1 ring-white/10 grid place-items-center font-bold text-gold-light text-sm">
                          {pair.base[0]}
                        </div>
                      )}
                      <span className="text-[12px] sm:text-[13px] font-bold tracking-wide text-white/85 group-hover:text-white transition-colors">
                        {pair.base}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════
          FEATURES — sticky stack contained so it cannot cover footer
          ══════════════════════════════════════════════════════════════════ */}
      <section
        className="border-y border-white/[0.06] relative overflow-x-clip overflow-y-clip isolate"
        style={{ background: 'var(--ibo-bg)' }}
      >
        <div className="ibo-landing-container pt-14 md:pt-20 pb-16 md:pb-24">
          <StackedFeatureCards
            ariaLabel="Why Delta stacked feature cards"
            stackDepth={5}
            eyebrow="Why Delta"
            title="Best-in-class pro features for everyone"
            lead="Trade crypto F&O 24/7 with efficient margining, Instant KYC, and INR deposit & withdrawal."
            cards={FEATURES_BENTO.map((f) => ({
              id: f.key,
              title: f.title,
              desc: f.desc,
              art: f.art,
              artFit: f.artFit,
              accentColor: f.glow,
              badge: f.key === 'speed' ? 'Execution'
                : f.key === 'security' ? 'Security'
                  : f.key === 'charts' ? 'Charts'
                    : f.key === 'liquidity' ? '24/7'
                      : f.key === 'portfolio' ? 'Portfolio'
                        : f.key === 'kyc' ? 'KYC'
                          : 'INR',
              ctaHref: f.key === 'speed' || f.key === 'charts' ? '/futures/BTCUSDT-PERP'
                : f.key === 'inr' ? '/wallet/deposit/inr'
                  : f.key === 'kyc' ? '/account/kyc'
                    : f.key === 'portfolio' ? '/account/positions'
                      : '/markets',
              ctaLabel: f.key === 'speed' ? 'Trade futures'
                : f.key === 'inr' ? 'Deposit INR'
                  : f.key === 'kyc' ? 'Start KYC'
                    : f.key === 'portfolio' ? 'View positions'
                      : 'Explore markets',
            }))}
          />
        </div>
      </section>

      <LandingFaqSupport />

      {/* ══════════════════════════════════════════════════════════════════
          CTA — split layout: pitch + start path
          ══════════════════════════════════════════════════════════════════ */}
      <section className="ibo-landing-cta relative overflow-hidden border-t border-white/[0.06]">
        <div aria-hidden className="ibo-landing-cta__glow" />
        <div aria-hidden className="ibo-landing-cta__grid" />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px"
          style={{
            background:
              'linear-gradient(90deg, transparent, rgba(254, 108, 2,0.5), rgba(0, 168, 118,0.35), transparent)',
          }}
        />

        <div className="relative ibo-landing-container py-16 sm:py-20 md:py-24 lg:py-28">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-10 xl:gap-14 items-stretch">
            {/* Left — editorial pitch */}
            <motion.div
              initial={{ opacity: 0, x: -18 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, margin: '-40px' }}
              transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
              className="lg:col-span-7 flex flex-col justify-center min-w-0"
            >
              <p className="ibo-eyebrow mb-4">Made for India</p>

              <h2 className="ibo-title-lg mb-5 max-w-[16ch] sm:max-w-[18ch]">
                Start trading crypto F&amp;O in{' '}
                <span className="text-gradient">three steps</span>
              </h2>

              <p className="ibo-lead text-zinc-400 max-w-lg mb-8">
                Instant KYC, deposit INR, then futures, options, and spot on one pro terminal —
                margin &amp; P/L in rupees, withdraw to your bank when you&#39;re ready.
              </p>

              <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-3 mb-8">
                <Link
                  to="/register"
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-logo-gradient px-7 py-3.5 text-[15px] font-bold text-[#101013] shadow-[0_14px_36px_rgba(254,108,2,0.22)] hover:brightness-110 transition-[filter]"
                >
                  Sign up free <ArrowRight size={18} />
                </Link>
                <Link
                  to="/futures/BTCUSDT-PERP"
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/12 bg-white/[0.02] px-7 py-3.5 text-[15px] font-medium text-white/85 hover:bg-white/[0.05] hover:border-white/20 transition-colors ibo-btn-outline"
                >
                  <BarChart2 size={17} /> Trade futures
                </Link>
              </div>

              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-zinc-500">
                <Link to="/wallet/deposit/inr" className="hover:text-[#FE6C02] transition-colors">
                  Deposit INR
                </Link>
                <span className="text-white/15 hidden sm:inline" aria-hidden>
                  |
                </span>
                <Link to="/options/BTCUSDT" className="hover:text-[#FE6C02] transition-colors">
                  Options chain
                </Link>
                <span className="text-white/15 hidden sm:inline" aria-hidden>
                  |
                </span>
                <Link to="/account/kyc" className="hover:text-[#FE6C02] transition-colors">
                  Instant KYC
                </Link>
              </div>
            </motion.div>

            {/* Right — numbered start path (no card grid) */}
            <motion.div
              initial={{ opacity: 0, x: 18 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, margin: '-40px' }}
              transition={{ duration: 0.55, delay: 0.08, ease: [0.16, 1, 0.3, 1] }}
              className="lg:col-span-5 min-w-0"
            >
              <div className="ibo-landing-cta__path relative h-full">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500 mb-6">
                  Your first session
                </p>

                <ol className="relative m-0 p-0 list-none space-y-0">
                  {[
                    {
                      n: '01',
                      icon: UserPlus,
                      title: 'Sign up & Instant KYC',
                      desc: 'Aadhaar, PAN, face match — go live in minutes.',
                      to: '/register',
                    },
                    {
                      n: '02',
                      icon: IndianRupee,
                      title: 'Deposit INR',
                      desc: 'Link bank / UPI and fund margin in rupees.',
                      to: '/wallet/deposit/inr',
                    },
                    {
                      n: '03',
                      icon: LineChart,
                      title: 'Trade F&O or spot',
                      desc: 'Open BTC & ETH markets 24/7 on the pro terminal.',
                      to: '/futures/BTCUSDT-PERP',
                    },
                  ].map((step, i) => {
                    const Icon = step.icon;
                    return (
                      <motion.li
                        key={step.n}
                        initial={{ opacity: 0, y: 12 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        transition={{ delay: 0.12 + i * 0.08, duration: 0.45 }}
                      >
                        <Link to={step.to} className="ibo-landing-cta__step group">
                          <span className="ibo-landing-cta__step-n" aria-hidden>
                            {step.n}
                          </span>
                          <span className="ibo-landing-cta__step-icon" aria-hidden>
                            <Icon size={18} strokeWidth={2.1} className="text-[#FE6C02]" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block font-display text-[1.05rem] sm:text-[1.12rem] font-bold text-white tracking-tight group-hover:text-[#FE6C02] transition-colors">
                              {step.title}
                            </span>
                            <span className="mt-1 block text-[13px] sm:text-[14px] text-zinc-500 leading-relaxed">
                              {step.desc}
                            </span>
                          </span>
                          <ArrowRight
                            size={16}
                            className="shrink-0 text-zinc-600 opacity-0 -translate-x-1 transition-all duration-250 group-hover:opacity-100 group-hover:translate-x-0 group-hover:text-[#FE6C02] mt-1"
                          />
                        </Link>
                      </motion.li>
                    );
                  })}
                </ol>
              </div>
            </motion.div>
          </div>

          {/* App download — magazine split + phone mock */}
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.15 }}
            className="mt-12 md:mt-16"
          >
            <div className="ibo-cta-app">
              <div className="ibo-cta-app__bg" aria-hidden />

              <div className="ibo-cta-app__grid">
                {/* Editorial column */}
                <div className="ibo-cta-app__editorial">
                  <div className="ibo-cta-app__status">
                    <span className="ibo-cta-app__pulse" aria-hidden />
                    Android app · launching soon
                  </div>

                  <h3 className="ibo-cta-app__headline">
                    Your exchange,
                    <br />
                    <span>in your hand</span>
                  </h3>

                  <p className="ibo-cta-app__sub">
                    Native Android is on the way. Trade futures, options, and spot on web now —
                    same account when the app drops.
                  </p>

                  <div className="ibo-cta-app__cta-row">
                    <Link
                      to="/futures/BTCUSDT-PERP"
                      className="ibo-cta-app__btn-primary bg-logo-gradient text-[#101013]"
                    >
                      Trade on web
                      <ArrowRight size={16} className="text-[#101013]" strokeWidth={2.2} />
                    </Link>
                    <MobileAppDownload variant="pill" className="ibo-cta-app__status-pill" />
                  </div>
                </div>

                {/* Phone mock */}
                <div className="ibo-cta-app__device" aria-hidden>
                  <div className="ibo-cta-app__phone">
                    <div className="ibo-cta-app__notch" />
                    <div className="ibo-cta-app__screen">
                      <div className="ibo-cta-app__screen-top">
                        <Smartphone size={14} strokeWidth={2.2} />
                        <span>Delta · Markets</span>
                      </div>
                      <div className="ibo-cta-app__screen-rows">
                        {[
                          { k: 'BTC-PERP', v: 'Futures', d: '+1.2%' },
                          { k: 'ETH Options', v: 'Chain', d: 'Live' },
                          { k: 'INR Wallet', v: 'Deposit', d: 'Bank' },
                        ].map((row) => (
                          <div key={row.k} className="ibo-cta-app__screen-row">
                            <div>
                              <span className="ibo-cta-app__row-k">{row.k}</span>
                              <span className="ibo-cta-app__row-v">{row.v}</span>
                            </div>
                            <span className="ibo-cta-app__row-d">{row.d}</span>
                          </div>
                        ))}
                      </div>
                      <div className="ibo-cta-app__screen-bar">Open 24/7 · INR P/L</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

    </div>
  );
}
