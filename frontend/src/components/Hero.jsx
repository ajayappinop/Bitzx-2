import { motion } from 'framer-motion';
import { ArrowRight, FileText, Copy, Check } from 'lucide-react';
import { useState } from 'react';
import ParticleBackground from './ParticleBackground';
import { SITE_CONFIG, getExchangeStatusLabel } from '@/config/site';
import { resolveBrandLogoUrl, BRAND_LOGO } from '@/lib/brandAssets';
import { useExchangeDevNotice } from '@/components/ExchangeDevNotice';

const LOGO_ICON_URL = resolveBrandLogoUrl(SITE_CONFIG.heroLogoUrl);
const LOGO_FALLBACK = BRAND_LOGO;

export const Hero = () => {
  const [copied, setCopied] = useState(false);
  const { showBuyNotice } = useExchangeDevNotice();
  
  const scrollToSection = (href) => {
    const element = document.querySelector(href);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(SITE_CONFIG.contractAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section
      id="hero"
      className="hero-section relative flex min-h-0 flex-col overflow-x-clip bg-surface lg:h-[100svh] lg:max-h-[100svh] lg:overflow-hidden"
      data-testid="hero-section"
    >
      {/* Base atmospheric wash */}
      <div
        className="absolute inset-0 hero-bg-base"
        aria-hidden="true"
      />

      {/* Particle field */}
      <ParticleBackground />

      {/* Soft color orbs — brand cyan / blue / lime */}
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 -left-24 h-[420px] w-[420px] rounded-full bg-[#0EA4AB]/25 blur-[100px] sm:h-[520px] sm:w-[520px]"
        animate={{ x: [0, 40, 0], y: [0, 24, 0], scale: [1, 1.08, 1] }}
        transition={{ duration: 14, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute top-[15%] -right-20 h-[380px] w-[380px] rounded-full bg-[#1B5FFF]/20 blur-[110px] sm:h-[480px] sm:w-[480px]"
        animate={{ x: [0, -30, 0], y: [0, 35, 0], scale: [1, 1.12, 1] }}
        transition={{ duration: 16, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute bottom-[-10%] left-[20%] h-[360px] w-[360px] rounded-full bg-[#C5E35B]/15 blur-[100px] sm:h-[460px] sm:w-[460px]"
        animate={{ x: [0, 25, 0], y: [0, -20, 0], opacity: [0.55, 0.85, 0.55] }}
        transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-1/2 h-[280px] w-[280px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#2ECAD0]/10 blur-[80px] sm:h-[360px] sm:w-[360px]"
      />

      {/* Radial spotlight behind content + logo */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[radial-gradient(ellipse_70%_55%_at_20%_40%,rgba(14,164,171,0.18),transparent_60%)]"
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[radial-gradient(ellipse_55%_50%_at_78%_45%,rgba(27,95,255,0.14),transparent_55%)]"
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[radial-gradient(ellipse_80%_40%_at_50%_100%,rgba(197,227,91,0.1),transparent_50%)]"
      />

      {/* Perspective grid floor */}
      <div
        aria-hidden="true"
        className="hero-grid pointer-events-none absolute inset-0 opacity-[0.045]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(197,227,91,0.55) 1px, transparent 1px), linear-gradient(90deg, rgba(14,164,171,0.45) 1px, transparent 1px)',
          backgroundSize: '72px 72px',
          maskImage:
            'radial-gradient(ellipse 85% 70% at 50% 40%, black 20%, transparent 75%)',
          WebkitMaskImage:
            'radial-gradient(ellipse 85% 70% at 50% 40%, black 20%, transparent 75%)',
        }}
      />

      {/* Fine diagonal sheen */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.35] mix-blend-soft-light"
        style={{
          backgroundImage:
            'linear-gradient(115deg, transparent 0%, rgba(255,255,255,0.04) 42%, transparent 58%)',
        }}
      />

      {/* Top/bottom vignette for depth */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,rgba(5,10,26,0.35)_0%,transparent_18%,transparent_78%,rgba(5,10,26,0.45)_100%)] hero-vignette"
      />

      {/* Main + contract share one viewport column on lg so the page does not scroll inside the hero */}
      <div className="relative z-10 flex min-h-0 w-full flex-1 flex-col">
        <div className="hero-main relative mx-auto flex min-h-0 w-full max-w-7xl flex-1 items-start px-4 pt-28 pb-4 sm:px-6 sm:pt-32 sm:pb-6 md:px-10 lg:items-center lg:px-10 lg:pt-24 lg:pb-4 xl:px-16 xl:pt-28 xl:pb-6">
          <div className="grid w-full min-h-0 items-center gap-6 sm:gap-8 lg:grid-cols-2 lg:gap-10 xl:gap-14">
            
            {/* Left Column - Content */}
            <motion.div
              initial={{ opacity: 0, x: -50 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.8, ease: 'easeOut' }}
              className="order-1 min-w-0"
            >
              {/* Badge */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2, duration: 0.6 }}
                className="mb-3 sm:mb-4 lg:mb-3"
              >
                <span className="hero-live-badge inline-flex max-w-full items-center gap-2 rounded-full px-4 py-2 text-xs sm:text-sm text-[#4D8AFF] font-medium">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#4D8AFF] opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-[#4D8AFF]" />
                  </span>
                  Live on BNB Chain
                </span>
              </motion.div>

              {/* Headline */}
              <motion.h1
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3, duration: 0.6 }}
                className="mb-3 text-[2rem] font-bold leading-[1.15] tracking-tight sm:mb-4 sm:text-5xl sm:leading-[1.1] lg:mb-3 lg:text-[2.5rem] xl:mb-4 xl:text-6xl 2xl:text-7xl"
                data-testid="hero-headline"
              >
                <span className="text-ink block">The Gateway to</span>
                <span className="text-[#4D8AFF] block">Next-Gen Trading</span>
              </motion.h1>

              {/* Subheadline */}
              <motion.p
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4, duration: 0.6 }}
                className="mb-5 max-w-xl text-base leading-relaxed text-ink-muted sm:mb-6 sm:text-lg lg:mb-5 lg:text-base xl:mb-6 xl:text-lg md:text-xl"
                data-testid="hero-subheadline"
              >
                Delta is a BNB Chain utility token building toward a broader trading
                ecosystem. Explore the token, review the contract, and follow official
                project updates as the platform develops.
              </motion.p>

              {/* CTA Buttons */}
              <motion.div
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5, duration: 0.6 }}
                className="mb-5 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:gap-4 lg:mb-5"
              >
                <motion.button
                  type="button"
                  onClick={showBuyNotice}
                  className="group relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-logo-gradient px-8 py-3.5 text-base font-bold text-[#050a1a] shadow-[0_0_30px_rgba(14,164,171,0.3)] sm:w-auto sm:py-4"
                  whileHover={{ scale: 1.02, boxShadow: '0 0 40px rgba(14,164,171,0.5)' }}
                  whileTap={{ scale: 0.98 }}
                  data-testid="hero-buy-btn"
                >
                  <span className="relative z-10">Buy $DELTA</span>
                  <ArrowRight size={18} className="relative z-10 group-hover:translate-x-1 transition-transform" />
                </motion.button>

                <motion.button
                  onClick={() => scrollToSection('#whitepaper')}
                  className="group flex w-full items-center justify-center gap-2 rounded-xl border-2 border-[#4A4B50] bg-transparent px-8 py-3.5 text-base font-semibold text-ink-soft transition-all duration-300 hover:border-[#4D8AFF] hover:text-[#4D8AFF] sm:w-auto sm:py-4"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  data-testid="hero-whitepaper-btn"
                >
                  <FileText size={18} />
                  Read Whitepaper
                </motion.button>
              </motion.div>

              {/* Token Stats Row */}
              <motion.div
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.6, duration: 0.6 }}
                className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3"
              >
                {[
                  { label: 'Token', value: '$DELTA', highlight: true },
                  { label: 'Network', value: 'BNB Chain', highlight: false },
                  { label: 'Supply', value: '900M', highlight: false },
                  {
                    label: 'Exchange',
                    value: getExchangeStatusLabel(),
                    highlight: true,
                  },
                ].map((stat) => (
                  <div 
                    key={stat.label}
                    className="rounded-xl border border-line bg-surface-card p-3 text-center transition-colors hover:border-[#0EA4AB]/50 sm:p-4"
                  >
                    <p className="mb-1 text-xs uppercase tracking-wider text-ink-muted">{stat.label}</p>
                    <p className={`text-sm font-bold ${stat.highlight ? 'text-[#4D8AFF]' : 'text-ink'}`}>
                      {stat.value}
                    </p>
                  </div>
                ))}
              </motion.div>
            </motion.div>

            {/* Right Column - Logo & Visual */}
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 1, ease: 'easeOut' }}
              className="hero-visual order-2 relative flex min-h-[160px] items-center justify-center sm:min-h-[220px] md:min-h-[240px] lg:min-h-0 lg:h-[min(42vh,280px)] xl:h-[min(48vh,340px)]"
            >
              {/* Glow rings behind logo */}
              <div className="absolute h-[150px] w-[150px] rounded-full border border-[#0EA4AB]/10 sm:h-[240px] sm:w-[240px] lg:h-[240px] lg:w-[240px] xl:h-[320px] xl:w-[320px] 2xl:h-[380px] 2xl:w-[380px]" />
              <div className="absolute h-[130px] w-[130px] rounded-full border border-[#0EA4AB]/20 sm:h-[200px] sm:w-[200px] lg:h-[200px] lg:w-[200px] xl:h-[270px] xl:w-[270px] 2xl:h-[320px] 2xl:w-[320px]" />
              <div className="absolute h-[110px] w-[110px] rounded-full bg-gradient-to-br from-[#0EA4AB]/10 to-transparent sm:h-[170px] sm:w-[170px] lg:h-[170px] lg:w-[170px] xl:h-[230px] xl:w-[230px] 2xl:h-[270px] 2xl:w-[270px]" />
              
              {/* Animated glow */}
              <motion.div
                animate={{
                  boxShadow: [
                    '0 0 60px 30px rgba(14,164,171,0.1)',
                    '0 0 80px 40px rgba(14,164,171,0.2)',
                    '0 0 60px 30px rgba(14,164,171,0.1)',
                  ],
                }}
                transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                className="absolute h-[100px] w-[100px] rounded-full sm:h-[150px] sm:w-[150px] lg:h-[150px] lg:w-[150px] xl:h-[210px] xl:w-[210px] 2xl:h-[250px] 2xl:w-[250px]"
              />
              
              {/* Logo Image */}
              <motion.img
                src={LOGO_ICON_URL}
                alt="Delta Token"
                className="relative z-10 h-[110px] w-[110px] object-contain drop-shadow-[0_0_50px_rgba(14,164,171,0.3)] sm:h-[170px] sm:w-[170px] lg:h-[170px] lg:w-[170px] xl:h-[240px] xl:w-[240px] 2xl:h-[290px] 2xl:w-[290px]"
                onError={(e) => {
                  if (e.currentTarget.src === LOGO_FALLBACK) return;
                  e.currentTarget.onerror = null;
                  e.currentTarget.src = LOGO_FALLBACK;
                }}
                animate={{ 
                  rotateY: [0, 5, 0, -5, 0],
                }}
                transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
                data-testid="hero-logo"
              />

              {/* Floating chips — xl+ only */}
              <motion.div
                animate={{ y: [-10, 10, -10] }}
                transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
                className="absolute right-0 top-4 hidden rounded-xl border border-line bg-surface-card/90 px-4 py-2.5 text-sm backdrop-blur-sm xl:block xl:top-8 xl:right-2 2xl:right-0"
              >
                <div className="mb-0.5 flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-400" />
                  <span className="text-xs text-ink-muted">Token Standard</span>
                </div>
                <span className="font-bold text-ink-accent">BEP-20</span>
              </motion.div>

              <motion.div
                animate={{ y: [10, -10, 10] }}
                transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
                className="absolute bottom-4 left-0 hidden rounded-xl border border-line bg-surface-card/90 px-4 py-2.5 text-sm backdrop-blur-sm xl:block xl:bottom-8 2xl:bottom-10"
              >
                <span className="mb-0.5 block text-xs text-ink-muted">Whitepaper</span>
                <span className="font-bold text-ink">Available</span>
              </motion.div>
            </motion.div>
          </div>
        </div>

        {/* Contract Address Bar */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.8, duration: 0.6 }}
          className="hero-contract relative z-20 w-full shrink-0 px-4 pb-6 sm:px-6 sm:pb-8 lg:px-6 lg:pb-5 xl:pb-7"
        >
          <div className="mx-auto max-w-3xl">
            <div className="flex flex-col items-start justify-between gap-3 rounded-2xl border border-line bg-surface-card/90 p-3.5 backdrop-blur-md sm:flex-row sm:items-center sm:gap-4 sm:p-4">
              <div className="flex min-w-0 items-start gap-3 sm:items-center">
                <div className="mt-1.5 h-2 w-2 shrink-0 animate-pulse rounded-full bg-green-500 sm:mt-0" />
                <span className="shrink-0 text-sm text-ink-muted">Contract:</span>
                <code className="break-all font-mono text-xs leading-relaxed text-ink-accent sm:text-sm">
                  {SITE_CONFIG.contractAddress}
                </code>
              </div>
              <div className="flex items-center gap-3 self-end sm:self-auto">
                <button 
                  onClick={handleCopy}
                  className="p-2 text-ink-muted transition-colors hover:text-ink-accent"
                  data-testid="copy-contract-hero"
                >
                  {copied ? <Check size={16} /> : <Copy size={16} />}
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
};

export default Hero;
