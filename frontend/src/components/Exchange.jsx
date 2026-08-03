import { motion, useInView } from 'framer-motion';
import { useRef } from 'react';
import { 
  ArrowRight, 
  BarChart2,
  Shield, 
  Zap, 
  Wallet, 
  Users, 
  Globe,
  Rocket,
  CheckCircle,
  Sparkles
} from 'lucide-react';
import {
  SITE_CONFIG,
  getExchangeStatusLabel,
  getExchangeUrlDisplay,
  isExchangeLive,
} from '@/config/site';
import { useExchangeDevNotice } from '@/components/ExchangeDevNotice';

const EXCHANGE_URL_LABEL = getExchangeUrlDisplay();
const LOGO_ICON_URL = SITE_CONFIG.heroLogoUrl;

const exchangeFeatures = [
  {
    icon: BarChart2,
    title: 'Advanced Trading',
    description: 'Professional-grade charting with multiple order types and real-time data.',
  },
  {
    icon: Shield,
    title: 'Bank-Grade Security',
    description: 'Multi-layer protection with cold storage, 2FA, and insurance.',
  },
  {
    icon: Zap,
    title: 'Lightning Fast',
    description: 'Sub-millisecond execution with our high-performance engine.',
  },
  {
    icon: Wallet,
    title: 'Secure Wallets',
    description: 'Enterprise infrastructure with multi-signature protection.',
  },
  {
    icon: Users,
    title: 'Referral Rewards',
    description: 'Earn passive income by growing the IBO community.',
  },
  {
    icon: Globe,
    title: 'Global Access',
    description: '24/7 trading with multi-language and multi-currency support.',
  },
];

const holderBenefits = [
  'Priority beta access',
  'Reduced trading fees',
  'VIP customer support',
  'Exclusive airdrops',
  'Governance voting rights',
  'Early feature access',
];

export const Exchange = () => {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: '-100px' });
  const { showNotice, showBuyNotice } = useExchangeDevNotice();

  return (
    <section
      id="exchange"
      ref={ref}
      className="relative py-20 md:py-32 overflow-hidden bg-surface"
      data-testid="exchange-section"
    >
      {/* Background Effects */}
      <div className="absolute inset-0">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[420px] h-[420px] sm:w-[620px] sm:h-[620px] md:w-[800px] md:h-[800px] bg-[#0EA4AB]/8 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-0 w-[220px] h-[220px] sm:w-[320px] sm:h-[320px] md:w-[400px] md:h-[400px] bg-[#C5E35B]/5 rounded-full blur-3xl" />
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 md:px-10 xl:px-16 relative z-10">
        
        {/* Hero Section */}
        <div className="grid lg:grid-cols-2 gap-10 md:gap-16 xl:gap-24 items-center mb-16 md:mb-24">
          
          {/* Left Content */}
          <motion.div
            initial={{ opacity: 0, x: -40 }}
            animate={isInView ? { opacity: 1, x: 0 } : {}}
            transition={{ duration: 0.8 }}
          >
            {/* Live Badge */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={isInView ? { opacity: 1, y: 0 } : {}}
              transition={{ delay: 0.2, duration: 0.6 }}
              className="inline-flex items-center gap-2 mb-6"
            >
              {isExchangeLive() && (
                <span className="relative flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#C5E35B] opacity-75" />
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-[#C5E35B]" />
                </span>
              )}
              <span className="text-ink-accent font-semibold text-sm uppercase tracking-widest">
                {getExchangeStatusLabel()}
              </span>
            </motion.div>

            <h2 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold text-ink mb-6 leading-tight">
              IBO
              <span className="block text-ink-accent">Exchange</span>
            </h2>
            
            <p className="text-ink-muted text-lg md:text-xl mb-8 leading-relaxed max-w-lg">
              {SITE_CONFIG.exchange.summary}
            </p>

            {/* Key highlights */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
              {[
                { value: EXCHANGE_URL_LABEL, label: 'Official URL', compact: true },
                { value: 'Spot', label: 'Live Markets', compact: false },
                { value: 'IBO Utility', label: 'Token Role', compact: false },
              ].map((stat, i) => (
                <motion.div
                  key={stat.label}
                  initial={{ opacity: 0, y: 20 }}
                  animate={isInView ? { opacity: 1, y: 0 } : {}}
                  transition={{ delay: 0.4 + i * 0.1, duration: 0.5 }}
                  className="text-center min-w-0 px-1"
                >
                  <p
                    className={`font-bold text-ink-accent ${
                      stat.compact
                        ? 'text-sm sm:text-base leading-snug break-all'
                        : 'text-2xl md:text-3xl'
                    }`}
                  >
                    {stat.value}
                  </p>
                  <p className="text-ink-muted text-xs uppercase tracking-wider mt-1">{stat.label}</p>
                </motion.div>
              ))}
            </div>

            {/* CTAs */}
            <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-4">
              <motion.button
                type="button"
                onClick={showNotice}
                className="group inline-flex w-full sm:w-auto justify-center items-center gap-3 bg-logo-gradient text-[#050a1a] font-bold px-8 py-4 rounded-xl shadow-[0_0_40px_rgba(14,164,171,0.3)] hover:shadow-[0_0_50px_rgba(14,164,171,0.5)] transition-all"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                data-testid="exchange-cta-btn"
              >
                <Rocket size={20} />
                Trade on Exchange
                <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
              </motion.button>
              <motion.button
                type="button"
                onClick={showBuyNotice}
                className="inline-flex w-full sm:w-auto justify-center items-center gap-2 border-2 border-[#0EA4AB]/30 text-ink-accent font-bold px-6 py-4 rounded-xl bg-[#0EA4AB]/8 hover:border-[#C5E35B]/50 transition-colors"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                Buy $IBO
              </motion.button>
            </div>
          </motion.div>

          {/* Right Visual */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={isInView ? { opacity: 1, scale: 1 } : {}}
            transition={{ duration: 1, delay: 0.3 }}
            className="relative flex items-center justify-center min-h-[300px] sm:min-h-[420px]"
          >
            {/* Decorative rings */}
            <div className="absolute w-[240px] h-[240px] sm:w-[400px] sm:h-[400px] md:w-[500px] md:h-[500px] rounded-full border border-[#0EA4AB]/10" />
            <div className="absolute w-[190px] h-[190px] sm:w-[320px] sm:h-[320px] md:w-[400px] md:h-[400px] rounded-full border border-[#0EA4AB]/20" />
            <div className="absolute w-[150px] h-[150px] sm:w-[240px] sm:h-[240px] md:w-[300px] md:h-[300px] rounded-full border border-[#0EA4AB]/30" />
            
            {/* Animated glow */}
            <motion.div
              animate={{
                boxShadow: [
                  '0 0 80px 40px rgba(14,164,171,0.15)',
                  '0 0 120px 60px rgba(14,164,171,0.25)',
                  '0 0 80px 40px rgba(14,164,171,0.15)',
                ],
              }}
              transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
              className="absolute w-[120px] h-[120px] sm:w-[180px] sm:h-[180px] md:w-[220px] md:h-[220px] rounded-full bg-surface"
            />

            {/* Center content */}
            <div className="relative z-10 text-center">
              <motion.img
                src={LOGO_ICON_URL}
                alt="IBO Exchange"
                className="w-24 h-24 sm:w-32 sm:h-32 md:w-40 md:h-40 mx-auto mb-4 sm:mb-6 drop-shadow-[0_0_30px_rgba(14,164,171,0.4)]"
                animate={{ rotateY: [0, 10, 0, -10, 0] }}
                transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
              />
              
              {/* Live exchange card */}
              <button
                type="button"
                onClick={showNotice}
                className="block w-full bg-gradient-to-br from-surface-card to-surface-card border border-[#0EA4AB]/40 rounded-2xl px-5 sm:px-8 py-4 sm:py-6 shadow-[0_0_30px_rgba(14,164,171,0.15)] hover:border-[#C5E35B]/60 transition-colors"
              >
                <div className="flex items-center justify-center gap-2 mb-2">
                  <Sparkles size={18} className="text-ink-accent" />
                  <span className="text-ink-accent font-bold uppercase tracking-wider text-sm">{getExchangeStatusLabel()}</span>
                  <Sparkles size={18} className="text-ink-accent" />
                </div>
                <p className="text-ink font-semibold text-sm sm:text-base break-all">{EXCHANGE_URL_LABEL}</p>
                <p className="text-ink-muted text-sm mt-1">Open the live exchange</p>
              </button>
            </div>

            {/* Floating feature badges */}
            <motion.div
              animate={{ y: [-8, 8, -8] }}
              transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
              className="hidden sm:block absolute top-10 right-0 md:right-10 bg-surface-card border border-line rounded-xl px-4 py-3 shadow-lg"
            >
              <div className="flex items-center gap-2">
                <Shield size={18} className="text-ink-accent" />
                <span className="text-ink text-sm font-medium">Secure</span>
              </div>
            </motion.div>

            <motion.div
              animate={{ y: [8, -8, 8] }}
              transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
              className="hidden sm:block absolute bottom-10 left-0 md:left-10 bg-surface-card border border-line rounded-xl px-4 py-3 shadow-lg"
            >
              <div className="flex items-center gap-2">
                <Zap size={18} className="text-ink-accent" />
                <span className="text-ink text-sm font-medium">Fast</span>
              </div>
            </motion.div>

            <motion.div
              animate={{ y: [-5, 10, -5] }}
              transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
              className="hidden sm:block absolute top-1/2 -right-4 md:right-0 bg-surface-card border border-line rounded-xl px-4 py-3 shadow-lg"
            >
              <div className="flex items-center gap-2">
                <Globe size={18} className="text-ink-accent" />
                <span className="text-ink text-sm font-medium">Global</span>
              </div>
            </motion.div>
          </motion.div>
        </div>

        {/* Features Grid */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, delay: 0.4 }}
          className="mb-20"
        >
          <div className="text-center mb-12">
            <span className="text-[#0EA4AB] text-sm font-semibold tracking-widest uppercase">Platform Features</span>
            <h3 className="text-3xl md:text-4xl font-bold text-ink mt-3">
              Built for Traders
            </h3>
          </div>
          
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {exchangeFeatures.map((feature, index) => (
              <motion.div
                key={feature.title}
                initial={{ opacity: 0, y: 20 }}
                animate={isInView ? { opacity: 1, y: 0 } : {}}
                transition={{ duration: 0.5, delay: 0.5 + index * 0.1 }}
                className="group"
                data-testid={`exchange-feature-${index}`}
              >
                <div className="relative h-full bg-gradient-to-br from-surface-card to-surface-soft border border-line rounded-2xl p-6 overflow-hidden hover:border-[#0EA4AB]/50 transition-all duration-500">
                  {/* Hover gradient */}
                  <div className="absolute inset-0 bg-gradient-to-br from-[#0EA4AB]/0 to-[#C5E35B]/0 group-hover:from-[#0EA4AB]/5 group-hover:to-transparent transition-all duration-500" />
                  
                  {/* Icon */}
                  <div className="relative w-14 h-14 rounded-2xl bg-logo-gradient flex items-center justify-center mb-5 group-hover:scale-110 transition-transform duration-300">
                    <feature.icon size={26} className="icon-on-gradient text-white" />
                  </div>
                  
                  {/* Content */}
                  <h4 className="relative text-lg font-bold text-ink mb-2 group-hover:text-ink-accent transition-colors">
                    {feature.title}
                  </h4>
                  <p className="relative text-ink-muted text-sm leading-relaxed">
                    {feature.description}
                  </p>

                  {/* Bottom accent line */}
                  <div className="absolute bottom-0 left-0 w-0 h-1 bg-logo-gradient group-hover:w-full transition-all duration-500" />
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* $IBO Holder Benefits */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, delay: 0.6 }}
        >
          <div className="relative bg-gradient-to-br from-surface-card via-surface-soft to-surface-card border border-[#0EA4AB]/30 rounded-3xl overflow-hidden">
            {/* Background decoration */}
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(14,164,171,0.15),transparent_60%)]" />
            
            <div className="relative p-8 md:p-12 lg:p-16">
              <div className="grid lg:grid-cols-2 gap-8 md:gap-12 items-center">
                {/* Left content */}
                <div>
                  <div className="inline-flex items-center gap-2 bg-[#0EA4AB]/10 border border-[#0EA4AB]/30 px-4 py-2 rounded-full mb-6">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#C5E35B] opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-[#C5E35B]" />
                    </span>
                    <span className="text-ink-accent text-sm font-medium">Exclusive for $IBO Holders</span>
                  </div>
                  
                  <h3 className="text-2xl md:text-3xl lg:text-4xl font-bold text-ink mb-4">
                    Early Supporters Get
                    <span className="text-ink-accent"> Premium Access</span>
                  </h3>
                  
                  <p className="text-ink-muted text-lg mb-8 leading-relaxed">
                    The exchange is live — trade on the platform and unlock holder benefits
                    as new features roll out.
                  </p>

                  <motion.button
                    type="button"
                    onClick={showNotice}
                    className="inline-flex w-full sm:w-auto justify-center items-center gap-2 bg-logo-gradient text-[#050a1a] font-bold px-8 py-4 rounded-xl shadow-[0_0_30px_rgba(14,164,171,0.3)]"
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    Open {EXCHANGE_URL_LABEL}
                    <ArrowRight size={18} />
                  </motion.button>
                </div>

                {/* Right - Benefits list */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                  {holderBenefits.map((benefit, index) => (
                    <motion.div
                      key={benefit}
                      initial={{ opacity: 0, x: 20 }}
                      animate={isInView ? { opacity: 1, x: 0 } : {}}
                      transition={{ duration: 0.4, delay: 0.7 + index * 0.08 }}
                      className="group relative flex items-center gap-3 overflow-hidden rounded-2xl border border-[#0EA4AB]/25 bg-surface/60 px-4 py-4 backdrop-blur-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-[#4D8AFF]/50 hover:shadow-[0_10px_28px_rgba(77,138,255,0.12)]"
                    >
                      <div className="absolute inset-0 bg-gradient-to-br from-[#4D8AFF]/0 via-transparent to-[#0EA4AB]/0 opacity-0 transition-opacity duration-300 group-hover:from-[#4D8AFF]/8 group-hover:to-[#0EA4AB]/5 group-hover:opacity-100" />
                      <div className="relative flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-logo-gradient shadow-[0_0_16px_rgba(14,164,171,0.25)]">
                        <CheckCircle size={18} className="icon-on-gradient text-white" strokeWidth={2.5} />
                      </div>
                      <span className="relative text-sm font-semibold text-ink leading-snug">
                        {benefit}
                      </span>
                    </motion.div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
};

export default Exchange;
