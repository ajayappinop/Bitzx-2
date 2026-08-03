import { useState, useEffect, useRef, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { motion, useInView } from 'framer-motion';
import {
  ArrowRight, BarChart2, CheckCircle, X, Star, Quote,
  Sparkles, Cpu, Eye, Zap,
} from 'lucide-react';
import { COIN_ICONS, PAIRS } from '@/services/marketApi';
import { useLiveMarkets } from '@/hooks/useLiveMarkets';
import { useMarketIntel } from '@/components/markets/CryptoMarketToday';
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

import { BRAND_LOGO, BRAND_MARK } from '@/lib/brandAssets';

const LOGO = BRAND_LOGO;
const MARK = BRAND_MARK;

// ── Data ──────────────────────────────────────────────────────────────────────
const FEATURES_BENTO = [
  {
    key: 'speed',
    title: 'Ultra-Fast Execution',
    desc: 'Sub-millisecond matching engine handles 1M+ TPS. Orders confirmed before you blink.',
    art: '/hero/platform-dollar-medal.png?v=11',
    artFit: 'wide',
    span: 'sm:col-span-2 lg:col-span-7',
    layout: 'wide',
    glow: 'rgba(197,227,91,0.42)',
  },
  {
    key: 'security',
    title: 'Bank-Grade Security',
    desc: '95% cold wallet storage, 2FA, whitelisting, and real-time threat monitoring.',
    art: '/hero/why-vault-safe.png?v=11',
    artFit: 'wide',
    span: 'sm:col-span-2 lg:col-span-5 lg:row-span-2',
    layout: 'tall',
    glow: 'rgba(14,164,171,0.45)',
  },
  {
    key: 'charts',
    title: 'TradingView Charts',
    desc: 'Full-feature charts with 100+ indicators, drawing tools, and multi-timeframe analysis.',
    art: '/hero/why-btc-coins.png?v=13',
    span: 'sm:col-span-1 lg:col-span-4',
    layout: 'square',
    glow: 'rgba(27,95,255,0.32)',
  },
  {
    key: 'liquidity',
    title: 'Global Liquidity',
    desc: 'Deep order books aggregated across providers for tight spreads around the clock.',
    art: '/hero/why-usdc-coin.png?v=1',
    span: 'sm:col-span-1 lg:col-span-3',
    layout: 'square',
    glow: 'rgba(14,164,171,0.4)',
  },
  {
    key: 'portfolio',
    title: 'Multi-Asset Portfolio',
    desc: 'Trade 100+ pairs. Manage USDT, crypto assets, and INR deposit/withdraw flow in one place.',
    art: '/hero/why-crypto-cubes.png?v=11',
    artFit: 'wide',
    span: 'sm:col-span-1 lg:col-span-4',
    layout: 'square',
    glow: 'rgba(197,227,91,0.38)',
  },
  {
    key: 'kyc',
    title: 'Instant KYC',
    desc: 'Aadhaar, PAN, live face match, and bank verification — onboard in minutes, not days.',
    art: '/hero/why-secure-wallet.png?v=12',
    artFit: 'tall',
    span: 'sm:col-span-1 lg:col-span-4',
    layout: 'square',
    glow: 'rgba(14,164,171,0.4)',
  },
  {
    key: 'inr',
    title: 'INR Deposit & Payout',
    desc: 'Deposit INR via bank or UPI; sell IBO and withdraw INR to your bank or UPI account.',
    art: '/hero/why-shield.png?v=11',
    artFit: 'wide',
    span: 'sm:col-span-1 lg:col-span-4',
    layout: 'square',
    glow: 'rgba(197,227,91,0.4)',
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


const TESTIMONIALS = [
  { name: 'Alex R.',     role: 'Day Trader',         avatar: 'A', text: 'IBO execution speed is unreal. My limit orders fill almost instantly and the fees are the lowest I have seen on any exchange.', rating: 5 },
  { name: 'Priya S.',    role: 'Crypto Investor',    avatar: 'P', text: 'The KYC process was smooth and the interface is very intuitive. Best exchange UI I have used. Charts are top notch.', rating: 5 },
  { name: 'Marcus K.',   role: 'Portfolio Manager',  avatar: 'M', text: 'Love the portfolio P&L tracking in real time. Makes it very easy to monitor my positions and decide when to take profit.', rating: 5 },
];

const VS_TABLE = [
  { feature: 'Trading fee (spot)', ibo: 'From 0.05% maker', other: 'Often 0.1–0.5%' },
  { feature: 'Markets snapshot',   ibo: 'Full 24h OHLC + vol', other: 'Varies by app' },
  { feature: 'Charting',           ibo: 'TradingView-grade', other: 'Basic' },
  { feature: 'Portfolio & P&L',    ibo: 'Unified dashboard', other: 'Split tools' },
  { feature: 'Quick trade',        ibo: 'Dedicated flow',   other: 'Not always' },
  { feature: 'BEP-20 deposit search', ibo: 'Full Web3 catalog', other: 'Limited' },
  { feature: 'IBO-quoted markets', ibo: 'IBO Markets hub', other: 'USDT only' },
  { feature: 'KYC & withdrawals', ibo: 'Guided, secure', other: 'Slow / opaque' },
  { feature: 'INR fiat (India)', ibo: 'Deposit & INR payout', other: 'Crypto-only' },
];

/** Landing market table — volume helpers */
function fmtLandingVol(v) {
  const n = parseFloat(v);
  if (!Number.isFinite(n) || n === 0) return '—';
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  return n.toFixed(2);
}

// ── Animated counter ──────────────────────────────────────────────────────────
function AnimatedCounter({ end, duration = 2 }) {
  const [count, setCount] = useState(0);
  const ref = useRef(null);
  const inView = useInView(ref, { once: true });
  useEffect(() => {
    if (!inView) return;
    const numEnd = parseFloat(end.replace(/[^0-9.]/g, ''));
    let start = 0;
    const step = numEnd / (duration * 60);
    const timer = setInterval(() => {
      start += step;
      if (start >= numEnd) { setCount(numEnd); clearInterval(timer); }
      else setCount(start);
    }, 1000 / 60);
    return () => clearInterval(timer);
  }, [inView, end, duration]);
  const display = end.includes('B') ? `$${count.toFixed(2)}B`
    : end.includes('M') ? `${count.toFixed(2)}M+`
    : end.includes('%') ? `${count.toFixed(2)}%`
    : `${Math.round(count)}+`;
  return <span ref={ref}>{display}</span>;
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function LandingPage() {
  const { markets } = useLiveMarkets();

  const marketIntel = useMarketIntel(markets);

  const heroStatCards = useMemo(() => {
    const volDisplay =
      marketIntel.totalQuoteVol > 0
        ? `$${fmtLandingVol(marketIntel.totalQuoteVol)}`
        : '—';
    return [
      {
        key: 'volume',
        label: '24h volume',
        value: volDisplay,
        sub: 'USDT quote volume across all pairs',
        accent: true,
      },
      {
        key: 'pairs',
        label: 'Spot pairs',
        value: String(marketIntel.pairCount || '—'),
        sub: 'Live USDT markets',
      },
      {
        key: 'breadth',
        label: '24h breadth',
        value: null,
        up: marketIntel.pairCount ? marketIntel.upCount : null,
        down: marketIntel.pairCount ? marketIntel.downCount : null,
        sub: 'Gainers vs losers',
      },
      {
        key: 'users',
        label: 'Traders',
        value: '2.55M+',
        sub: 'Registered globally',
        animate: true,
      },
    ];
  }, [marketIntel]);

  return (
    <div style={{ background: 'transparent' }}>
      <MobileAppStickyBar />

      <LandingHero />

      <LandingHomeBanners />

      <LandingProductStrip />

      <LandingInstantKyc />

      <LandingPlatformFlow />

      <LandingInrFiat />

      {/* APK download — primary banner */}
      <section className="relative ibo-landing-container py-6 md:py-8">
        <MobileAppDownload variant="banner" />
      </section>

      {/* ══════════════════════════════════════════════════════════════════
          STATS — live metrics band (no icons)
          ══════════════════════════════════════════════════════════════════ */}
      <section
        className="relative border-y border-white/[0.06] overflow-hidden"
        style={{ background: 'linear-gradient(180deg, var(--ibo-bg) 0%, var(--ibo-surface) 100%)' }}
      >
        <div
          className="pointer-events-none absolute inset-0 opacity-70"
          style={{
            background:
              'radial-gradient(ellipse 60% 80% at 10% 50%, rgba(14,164,171,0.07) 0%, transparent 55%), radial-gradient(ellipse 50% 70% at 90% 40%, rgba(197,227,91,0.05) 0%, transparent 50%)',
          }}
        />
        <div className="relative ibo-landing-container ibo-section-y">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mb-8 md:mb-10 max-w-xl"
          >
            <p className="ibo-eyebrow mb-2">Live platform</p>
            <h2 className="font-display text-[1.35rem] sm:text-[1.5rem] font-bold text-white tracking-tight">
              Numbers that move with the market
            </h2>
          </motion.div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-y-10 gap-x-6 sm:gap-x-8 lg:gap-0">
            {heroStatCards.map((s, i) => (
              <motion.div
                key={s.key}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.07, duration: 0.45 }}
                className={`min-w-0 lg:px-8 first:lg:pl-0 last:lg:pr-0 ${
                  i > 0 ? 'lg:border-l lg:border-white/[0.07]' : ''
                }`}
              >
                <p className="text-[11px] sm:text-[12px] font-semibold uppercase tracking-[0.14em] text-zinc-500 mb-3">
                  {s.label}
                </p>
                {s.key === 'breadth' ? (
                  <p className="font-display text-[1.85rem] sm:text-[2.15rem] lg:text-[2.35rem] font-bold tracking-tight tabular-nums leading-none">
                    {s.up == null ? (
                      <span className="text-white">—</span>
                    ) : (
                      <>
                        <span className="text-emerald-400">{s.up}</span>
                        <span className="text-zinc-600 font-medium mx-1.5">/</span>
                        <span className="text-red-400">{s.down}</span>
                      </>
                    )}
                  </p>
                ) : (
                  <p
                    className={`font-display text-[1.85rem] sm:text-[2.15rem] lg:text-[2.35rem] font-bold tracking-tight tabular-nums leading-none ${
                      s.accent ? 'text-gradient' : 'text-white'
                    }`}
                  >
                    {s.animate ? <AnimatedCounter end="2.55M+" /> : s.value}
                  </p>
                )}
                <p className="mt-3 text-[13px] sm:text-[14px] text-zinc-500 leading-relaxed max-w-[16rem]">
                  {s.sub}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════
          PLATFORM PREVIEW STRIP
          ══════════════════════════════════════════════════════════════════ */}
      <section className="relative ibo-section-y overflow-x-hidden" style={{ background: 'var(--ibo-surface)' }}>
        <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_50%_50%,rgba(96,165,250,0.04),transparent_65%)]" />
        <div className="ibo-landing-container">
          <motion.div initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
            className="text-center mb-12 md:mb-16 max-w-3xl mx-auto">
            <p className="ibo-eyebrow mb-4">Pro platform</p>
            <h2 className="ibo-title-lg mb-5">Spot · Charts · Portfolio in one place</h2>
            <p className="ibo-lead-wide mx-auto text-zinc-400">
              Same workflow as leading pro apps: pick a market, read full 24h stats, trade with depth, track P&amp;L — without switching tools.
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
                    'linear-gradient(180deg, rgba(197,227,91,0.55) 0%, rgba(96,165,250,0.4) 35%, rgba(34,197,94,0.35) 70%, rgba(249,115,22,0.3) 100%)',
                }}
              />

              <div className="relative space-y-0">
                {[
                  {
                    title: 'Matching Engine',
                    stat: '< 1ms latency',
                    accent: '#C5E35B',
                    icon: Cpu,
                    blurb: 'Sub-millisecond order matching built for high-frequency flow.',
                  },
                  {
                    title: 'TradingView Charts',
                    stat: '100+ indicators',
                    accent: '#60a5fa',
                    icon: BarChart2,
                    blurb: 'Pro charting with indicators, drawings, and multi-timeframes.',
                  },
                  {
                    title: 'Live P&L Tracking',
                    stat: 'Real-time updates',
                    accent: '#22c55e',
                    icon: Eye,
                    blurb: 'See open positions and performance update as the market moves.',
                  },
                  {
                    title: 'Quick Trade',
                    stat: '1-click orders',
                    accent: '#f97316',
                    icon: Zap,
                    blurb: 'Place orders in one click from markets, charts, or the terminal.',
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
                          <Icon size={18} strokeWidth={2.1} className="text-[#050a1a]" />
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
          <div className="relative -mx-4 sm:mx-0 py-2">
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
                          className="h-9 w-9 sm:h-10 sm:w-10 rounded-full object-cover ring-1 ring-white/10 group-hover:ring-[#0ea4ab]/50 transition-[box-shadow]"
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
            ariaLabel="Why IBO stacked feature cards"
            stackDepth={5}
            eyebrow="Why IBO"
            title="Built for serious traders"
            lead="Everything you need to trade with confidence — from beginner to professional."
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
                    : f.key === 'liquidity' ? 'Liquidity'
                      : f.key === 'portfolio' ? 'Portfolio'
                        : f.key === 'kyc' ? 'KYC'
                          : 'INR',
              ctaHref: '/markets',
              ctaLabel: f.key === 'speed' ? 'Open terminal' : 'Explore markets',
            }))}
          />
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════
          COMPARISON
          ══════════════════════════════════════════════════════════════════ */}
      <section
        className="relative border-y border-white/[0.06] overflow-hidden"
        style={{
          background:
            'linear-gradient(180deg, var(--ibo-bg) 0%, var(--ibo-surface) 50%, var(--ibo-bg) 100%)',
        }}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(ellipse 60% 50% at 80% 25%, rgba(197,227,91,0.1) 0%, transparent 55%), radial-gradient(ellipse 50% 45% at 15% 70%, rgba(14,164,171,0.12) 0%, transparent 50%), radial-gradient(ellipse 40% 40% at 55% 90%, rgba(77,138,255,0.08) 0%, transparent 55%)',
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px"
          style={{
            background:
              'linear-gradient(90deg, transparent, rgba(14,164,171,0.4), rgba(197,227,91,0.45), rgba(77,138,255,0.3), transparent)',
          }}
        />

        <div className="ibo-landing-container relative ibo-section-y">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-10 md:mb-14 max-w-2xl mx-auto"
          >
            <p className="ibo-eyebrow mb-4">Why choose IBO</p>
            <h2 className="ibo-title-lg mb-5">We stack up against anyone</h2>
            <p className="ibo-lead-wide mx-auto" style={{ color: 'var(--ibo-ink-secondary)' }}>
              Side-by-side with typical exchanges — clearer fees, deeper tools, and India-ready rails.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="relative max-w-4xl mx-auto"
          >
            {/* Desktop / tablet comparison — soft cyan / lime / blue panel */}
            <div
              className="hidden sm:block relative overflow-hidden rounded-2xl border"
              style={{
                borderColor: 'rgba(14,164,171,0.28)',
                background:
                  'linear-gradient(155deg, rgba(14,164,171,0.14) 0%, color-mix(in srgb, var(--ibo-card) 92%, transparent) 38%, rgba(77,138,255,0.07) 68%, rgba(197,227,91,0.12) 100%)',
                boxShadow: '0 16px 40px rgba(14,164,171,0.08), var(--ibo-shadow)',
              }}
            >
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 top-0 h-px"
                style={{
                  background:
                    'linear-gradient(90deg, transparent, rgba(14,164,171,0.5), rgba(197,227,91,0.45), transparent)',
                }}
              />
              <div
                aria-hidden
                className="pointer-events-none absolute -right-10 -top-12 w-48 h-48 rounded-full blur-3xl opacity-50"
                style={{
                  background:
                    'radial-gradient(circle, rgba(197,227,91,0.22) 0%, rgba(77,138,255,0.1) 45%, transparent 70%)',
                }}
              />
              <div
                aria-hidden
                className="pointer-events-none absolute -left-12 bottom-0 w-40 h-40 rounded-full blur-3xl opacity-40"
                style={{
                  background: 'radial-gradient(circle, rgba(14,164,171,0.22) 0%, transparent 70%)',
                }}
              />

              <div className="relative overflow-x-auto touch-manipulation [-webkit-overflow-scrolling:touch]">
                <div className="min-w-[560px]">
                  <div
                    className="grid grid-cols-[1.2fr_1fr_1fr] border-b"
                    style={{
                      borderColor: 'rgba(14,164,171,0.16)',
                      background:
                        'linear-gradient(90deg, rgba(14,164,171,0.1) 0%, rgba(197,227,91,0.1) 45%, rgba(77,138,255,0.08) 100%)',
                    }}
                  >
                    <div
                      className="px-5 lg:px-6 py-4 text-[11px] font-bold uppercase tracking-[0.16em] flex items-center"
                      style={{ color: 'var(--ibo-muted)' }}
                    >
                      Feature
                    </div>
                    <div
                      className="px-4 py-4 flex items-center justify-center gap-2 border-x"
                      style={{
                        borderColor: 'rgba(14,164,171,0.16)',
                        background:
                          'linear-gradient(145deg, rgba(14,164,171,0.16) 0%, rgba(197,227,91,0.12) 100%)',
                      }}
                    >
                      <img src={MARK} alt="" className="w-5 h-5 object-contain" />
                      <span
                        className="font-display text-sm font-bold tracking-tight"
                        style={{ color: 'var(--ibo-ink)' }}
                      >
                        IBO
                      </span>
                    </div>
                    <div className="px-4 py-4 flex items-center justify-center">
                      <span className="text-sm font-semibold" style={{ color: 'var(--ibo-muted)' }}>
                        Others
                      </span>
                    </div>
                  </div>

                  {VS_TABLE.map((row, i) => (
                    <motion.div
                      key={row.feature}
                      initial={{ opacity: 0, y: 10 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true }}
                      transition={{ delay: i * 0.03 }}
                      className="grid grid-cols-[1.2fr_1fr_1fr] items-stretch group transition-colors"
                      style={{
                        borderBottom:
                          i < VS_TABLE.length - 1 ? '1px solid rgba(14,164,171,0.1)' : 'none',
                      }}
                    >
                      <div className="flex items-center px-5 lg:px-6 py-4">
                        <p
                          className="text-[13px] sm:text-[14px] font-semibold"
                          style={{ color: 'var(--ibo-ink-secondary)' }}
                        >
                          {row.feature}
                        </p>
                      </div>

                      <div
                        className="flex items-center justify-center gap-2 px-3 py-4 border-x"
                        style={{
                          borderColor: 'rgba(14,164,171,0.12)',
                          background:
                            'linear-gradient(145deg, rgba(14,164,171,0.1) 0%, rgba(197,227,91,0.08) 100%)',
                        }}
                      >
                        <CheckCircle size={15} className="text-[#a8c73a] flex-shrink-0" />
                        <span
                          className="text-[12px] sm:text-[13px] font-semibold text-center leading-snug"
                          style={{ color: 'var(--ibo-ink)' }}
                        >
                          {row.ibo}
                        </span>
                      </div>

                      <div className="flex items-center justify-center gap-2 px-3 py-4">
                        <X size={14} className="flex-shrink-0" style={{ color: 'var(--ibo-muted)' }} />
                        <span
                          className="text-[12px] sm:text-[13px] text-center leading-snug"
                          style={{ color: 'var(--ibo-muted)' }}
                        >
                          {row.other}
                        </span>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            </div>

            {/* Mobile stacked comparison */}
            <div className="sm:hidden space-y-3">
              {VS_TABLE.map((row, i) => (
                <motion.div
                  key={row.feature}
                  initial={{ opacity: 0, y: 12 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.04 }}
                  className="relative rounded-2xl border overflow-hidden"
                  style={{
                    borderColor: 'rgba(14,164,171,0.28)',
                    background:
                      'linear-gradient(155deg, rgba(14,164,171,0.14) 0%, color-mix(in srgb, var(--ibo-card) 92%, transparent) 42%, rgba(197,227,91,0.1) 100%)',
                    boxShadow: '0 12px 28px rgba(14,164,171,0.08), var(--ibo-shadow)',
                  }}
                >
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-x-0 top-0 h-px"
                    style={{
                      background:
                        'linear-gradient(90deg, transparent, rgba(14,164,171,0.45), rgba(197,227,91,0.4), transparent)',
                    }}
                  />
                  <div
                    className="px-4 py-3 border-b"
                    style={{ borderColor: 'rgba(14,164,171,0.14)' }}
                  >
                    <p className="text-[13px] font-semibold" style={{ color: 'var(--ibo-ink)' }}>
                      {row.feature}
                    </p>
                  </div>
                  <div className="grid grid-cols-2">
                    <div
                      className="px-4 py-3 border-r"
                      style={{
                        borderColor: 'rgba(14,164,171,0.14)',
                        background:
                          'linear-gradient(145deg, rgba(14,164,171,0.12) 0%, rgba(197,227,91,0.1) 100%)',
                      }}
                    >
                      <p
                        className="text-[10px] font-bold uppercase tracking-wider mb-1.5"
                        style={{ color: '#0ea4ab' }}
                      >
                        IBO
                      </p>
                      <p
                        className="text-[12px] font-semibold leading-snug flex items-start gap-1.5"
                        style={{ color: 'var(--ibo-ink)' }}
                      >
                        <CheckCircle size={13} className="text-[#a8c73a] mt-0.5 flex-shrink-0" />
                        {row.ibo}
                      </p>
                    </div>
                    <div className="px-4 py-3">
                      <p
                        className="text-[10px] font-bold uppercase tracking-wider mb-1.5"
                        style={{ color: 'var(--ibo-muted)' }}
                      >
                        Others
                      </p>
                      <p
                        className="text-[12px] leading-snug flex items-start gap-1.5"
                        style={{ color: 'var(--ibo-muted)' }}
                      >
                        <X size={13} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--ibo-muted)' }} />
                        {row.other}
                      </p>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>

            <div className="mt-10 md:mt-12 flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link
                to="/register"
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-logo-gradient px-7 py-3.5 text-[14px] font-bold text-[#050a1a] shadow-[0_12px_28px_rgba(14,164,171,0.22)] hover:brightness-110 transition-[filter]"
              >
                Trade on IBO <ArrowRight size={16} />
              </Link>
              <Link
                to="/markets"
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/12 px-7 py-3.5 text-[14px] font-medium text-white/80 hover:bg-white/[0.04] transition-colors ibo-btn-outline"
              >
                Explore markets
              </Link>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════
          TESTIMONIALS
          ══════════════════════════════════════════════════════════════════ */}
      <section
        className="relative w-full overflow-hidden border-y border-white/[0.06]"
        style={{ background: 'var(--ibo-surface)' }}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(ellipse 50% 55% at 50% 0%, rgba(14,164,171,0.1) 0%, transparent 58%), radial-gradient(ellipse 35% 40% at 90% 80%, rgba(197,227,91,0.08) 0%, transparent 55%)',
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px"
          style={{
            background: 'linear-gradient(90deg, transparent, rgba(14,164,171,0.45), rgba(197,227,91,0.35), transparent)',
          }}
        />

        <div className="relative ibo-landing-container ibo-section-y">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-12 md:mb-14 max-w-2xl mx-auto"
          >
            <p className="ibo-eyebrow mb-4">Community</p>
            <h2 className="ibo-title-lg mb-4">Loved by traders</h2>
            <p className="ibo-lead-wide mx-auto" style={{ color: 'var(--ibo-ink-secondary)' }}>
              Join thousands of traders who trust IBO for their daily trading.
            </p>
          </motion.div>

          <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-6 lg:gap-8">
            {TESTIMONIALS.map((t, i) => (
              <motion.div
                key={t.name}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.12, type: 'tween', duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
                whileHover={{ y: -4 }}
                className="group relative overflow-hidden rounded-[1.35rem] p-7 sm:p-8 cursor-default"
                style={{
                  border: '1px solid rgba(14,164,171,0.28)',
                  background:
                    'linear-gradient(155deg, rgba(14,164,171,0.12) 0%, color-mix(in srgb, var(--ibo-card) 94%, transparent) 48%, rgba(197,227,91,0.1) 100%)',
                  boxShadow: '0 14px 36px rgba(14,164,171,0.08), var(--ibo-shadow)',
                }}
              >
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 top-0 h-px"
                  style={{
                    background:
                      'linear-gradient(90deg, transparent, rgba(14,164,171,0.5), rgba(197,227,91,0.4), transparent)',
                  }}
                />
                <div
                  aria-hidden
                  className="pointer-events-none absolute -right-10 -top-12 w-36 h-36 rounded-full blur-3xl opacity-50 transition-opacity duration-300 group-hover:opacity-80"
                  style={{ background: 'radial-gradient(circle, rgba(14,164,171,0.28) 0%, transparent 70%)' }}
                />

                <div className="relative flex items-center justify-between gap-3 mb-5">
                  <div className="flex gap-1.5">
                    {[...Array(t.rating)].map((_, si) => (
                      <motion.div
                        key={si}
                        initial={{ scale: 0 }}
                        whileInView={{ scale: 1 }}
                        viewport={{ once: true }}
                        transition={{ delay: i * 0.1 + si * 0.06 }}
                      >
                        <Star
                          size={20}
                          strokeWidth={0}
                          className="fill-[#C5E35B] text-[#C5E35B]"
                          style={{ filter: 'drop-shadow(0 0 8px rgba(197,227,91,0.55))' }}
                        />
                      </motion.div>
                    ))}
                  </div>
                  <Quote
                    size={28}
                    strokeWidth={1.75}
                    className="shrink-0 opacity-30"
                    style={{ color: 'var(--ibo-accent)' }}
                    aria-hidden
                  />
                </div>

                <p
                  className="relative text-[15px] leading-[1.75] mb-7"
                  style={{ color: 'var(--ibo-ink-secondary)' }}
                >
                  {t.text}
                </p>

                <div className="relative flex items-center gap-3 pt-5 border-t border-[rgba(14,164,171,0.15)]">
                  <div
                    className="w-11 h-11 rounded-full flex items-center justify-center font-bold text-base text-[#050a1a] shadow-[0_8px_20px_rgba(14,164,171,0.25)]"
                    style={{ background: 'linear-gradient(135deg, #0EA4AB 0%, #C5E35B 100%)' }}
                  >
                    {t.avatar}
                  </div>
                  <div>
                    <p className="font-semibold text-[15px]" style={{ color: 'var(--ibo-ink)' }}>
                      {t.name}
                    </p>
                    <p className="text-[13px] mt-0.5" style={{ color: 'var(--ibo-muted)' }}>
                      {t.role}
                    </p>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <LandingFaqSupport />

      {/* ══════════════════════════════════════════════════════════════════
          CTA BANNER
          ══════════════════════════════════════════════════════════════════ */}
      <section
        className="relative overflow-hidden border-t border-white/[0.06]"
        style={{ background: 'var(--ibo-bg)' }}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(ellipse 55% 70% at 50% -10%, rgba(14,164,171,0.22) 0%, transparent 58%), radial-gradient(ellipse 40% 50% at 85% 80%, rgba(197,227,91,0.1) 0%, transparent 55%), radial-gradient(ellipse 35% 45% at 10% 70%, rgba(77,138,255,0.08) 0%, transparent 50%)',
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px"
          style={{ background: 'linear-gradient(90deg, transparent, rgba(14,164,171,0.45), rgba(197,227,91,0.35), transparent)' }}
        />

        <div className="relative ibo-landing-container py-20 md:py-28 lg:py-32">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.65, ease: [0.16, 1, 0.3, 1] }}
            className="mx-auto max-w-3xl text-center"
          >
            <p className="ibo-eyebrow mb-5 inline-flex items-center gap-2 justify-center">
              <Sparkles size={12} className="text-[#C5E35B]" />
              Free demo balance
            </p>

            <h2 className="ibo-title-lg mb-5">
              Ready to start{' '}
              <span className="text-gradient">trading?</span>
            </h2>

            <p className="ibo-lead-wide mx-auto mb-10 text-zinc-400">
              Create your account, deposit USDT or any supported BEP-20 token, and trade USDT or IBO pairs
              with pro charts — or start with a free demo balance, no deposit required.
            </p>

            <div className="flex flex-col sm:flex-row flex-wrap justify-center gap-3 sm:gap-4 mb-10">
              <Link
                to="/register"
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-logo-gradient px-8 py-3.5 text-[15px] font-bold text-[#050a1a] shadow-[0_16px_48px_rgba(197,227,91,0.2)] hover:brightness-110 transition-[filter]"
              >
                Create free account <ArrowRight size={18} />
              </Link>
              <Link
                to="/markets"
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/12 px-8 py-3.5 text-[15px] font-medium text-white/85 hover:bg-white/[0.04] hover:border-white/20 transition-colors ibo-btn-outline"
              >
                <BarChart2 size={17} /> Explore markets
              </Link>
            </div>

            <div className="mx-auto max-w-xl">
              <MobileAppDownload variant="card" compact title="Trade on your phone" />
            </div>
          </motion.div>
        </div>
      </section>

    </div>
  );
}
