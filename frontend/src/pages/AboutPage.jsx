import { motion, useInView } from 'framer-motion';
import { useRef } from 'react';
import { Link } from 'react-router-dom';
import ProjectTransparency from '@/components/ProjectTransparency';
import { useExchangeDevNotice } from '@/components/ExchangeDevNotice';
import { SITE_CONFIG, getExchangeUrlDisplay } from '@/config/site';
import { 
  ArrowLeft, 
  Target, 
  Rocket, 
  Shield, 
  Globe, 
  Zap, 
  TrendingUp, 
  Users, 
  Building, 
  Coins,
  CheckCircle,
  ArrowRight,
  Sparkles,
  Lock,
  BarChart3,
  Layers
} from 'lucide-react';

const LOGO_ICON_URL = SITE_CONFIG.brandLogoUrl;
const EXCHANGE_URL_LABEL = getExchangeUrlDisplay();

// Animation variants
const fadeInUp = {
  hidden: { opacity: 0, y: 40 },
  visible: { opacity: 1, y: 0 }
};

const staggerContainer = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1 }
  }
};

// Section Component
const Section = ({ children, className = '', id = '' }) => {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: '-100px' });
  
  return (
    <motion.section
      ref={ref}
      id={id}
      initial="hidden"
      animate={isInView ? "visible" : "hidden"}
      variants={staggerContainer}
      className={`py-20 md:py-28 ${className}`}
    >
      {children}
    </motion.section>
  );
};

// Mission Values
const missionValues = [
  {
    icon: Shield,
    title: 'Security & Trust',
    description: 'We prioritize the safety of our community\'s assets with enterprise-grade security protocols, regular audits, and transparent operations.'
  },
  {
    icon: Users,
    title: 'Community First',
    description: 'Every decision we make is guided by our community. We believe in collective growth where success is shared among all stakeholders.'
  },
  {
    icon: Zap,
    title: 'Innovation',
    description: 'We continuously push boundaries, adopting cutting-edge technology to deliver faster, more efficient, and user-friendly solutions.'
  },
  {
    icon: Globe,
    title: 'Global Accessibility',
    description: 'We\'re building infrastructure that empowers anyone, anywhere to participate in the digital economy without barriers.'
  }
];

// Why Different Points
const differentiators = [
  {
    title: 'Real Utility, Not Speculation',
    description: 'Unlike countless tokens that rely solely on hype and speculation, IBO is engineered with tangible utility at its core. Every token serves a purpose within our expanding ecosystem.',
    icon: Coins
  },
  {
    title: 'Exchange-Backed Token',
    description: `IBO isn't just a standalone token — it is the foundation for IBO Exchange, the project's live centralized trading platform at ${EXCHANGE_URL_LABEL}.`,
    icon: Building
  },
  {
    title: 'Sustainable Tokenomics',
    description: 'Our carefully designed token distribution ensures long-term sustainability, with allocations dedicated to liquidity, development, marketing, and community rewards.',
    icon: BarChart3
  },
  {
    title: 'Transparent Development',
    description: 'We maintain complete transparency with our community through regular updates, public roadmaps, and open communication channels.',
    icon: Lock
  }
];

// Ecosystem Components
const ecosystemPillars = [
  {
    phase: '01',
    title: 'IBO Token',
    subtitle: 'Foundation Layer',
    description: 'The native utility token powering all ecosystem transactions, governance, and rewards. Built on BNB Chain for speed and efficiency.',
    features: ['Trading Fee Discounts', 'Staking Rewards', 'Governance Rights', 'VIP Access']
  },
  {
    phase: '02',
    title: 'IBO Exchange',
    subtitle: 'Trading Infrastructure',
    description: `IBO Exchange is live at ${EXCHANGE_URL_LABEL}, offering spot trading, professional charting tools, secure wallets, and INR deposit and payout flows for eligible Indian users.`,
    features: ['Spot Trading', 'Advanced Charts', 'Secure Wallets', 'Fast Execution']
  },
  {
    phase: '03',
    title: 'IBO Launchpad',
    subtitle: 'Growth Engine',
    description: 'Exclusive access to vetted token launches and IDO opportunities for IBO holders, creating additional value streams.',
    features: ['Early Access', 'Vetted Projects', 'Allocation Tiers', 'Fair Launch']
  },
  {
    phase: '04',
    title: 'IBO Ecosystem',
    subtitle: 'Future Expansion',
    description: 'Continuous expansion into DeFi, NFTs, and cross-chain solutions, ensuring IBO remains at the forefront of innovation.',
    features: ['DeFi Integration', 'Cross-Chain', 'NFT Support', 'API Access']
  }
];

// Vision Timeline
const visionTimeline = [
  {
    year: '2026',
    title: 'Foundation & Launch',
    points: [
      'Token launch on BNB Chain',
      'Community building & growth',
      'Strategic partnerships',
      'IBO Exchange development & launch'
    ]
  },
  {
    year: '2026',
    title: 'Exchange Live',
    points: [
      `IBO Exchange live at ${EXCHANGE_URL_LABEL}`,
      'Spot trading & INR flows',
      'Staking platform activation',
      'Mobile app development'
    ]
  },
  {
    year: '2027',
    title: 'Global Expansion',
    points: [
      'Multi-region expansion',
      'Institutional trading desk',
      'Advanced trading features',
      'Cross-chain integration'
    ]
  },
  {
    year: '2028+',
    title: 'Ecosystem Maturity',
    points: [
      'Full ecosystem deployment',
      'DAO governance transition',
      'Industry leadership position',
      'Continuous innovation'
    ]
  }
];

export const AboutPage = () => {
  const { showBuyNotice } = useExchangeDevNotice();

  return (
    <div className="min-h-screen bg-surface" data-testid="about-page">
      {/* Navigation Header */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-surface/90 backdrop-blur-xl border-b border-line">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 md:px-10 xl:px-16 py-4 flex items-center justify-between gap-3">
          <Link to="/" className="flex items-center gap-2 sm:gap-3 group min-w-0">
            <img src={LOGO_ICON_URL} alt="IBO" className="h-8 w-8 object-contain flex-shrink-0" />
            <span className="text-lg font-bold">
              <span className="text-ink">IBO</span>
            </span>
          </Link>
          <Link 
            to="/" 
            className="flex items-center gap-2 text-ink-muted hover:text-ink-accent transition-colors flex-shrink-0"
          >
            <ArrowLeft size={18} />
            <span className="hidden sm:inline">Back to Home</span>
            <span className="sm:hidden">Home</span>
          </Link>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative pt-32 pb-20 overflow-hidden">
        {/* Background elements */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(14,164,171,0.15),transparent)]" />
        <div className="absolute top-1/2 left-1/4 w-96 h-96 bg-[#0EA4AB]/10 rounded-full blur-3xl" />
        <div className="absolute top-1/3 right-1/4 w-64 h-64 bg-[#C5E35B]/5 rounded-full blur-3xl" />
        
        <div className="max-w-5xl mx-auto px-6 relative z-10">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            className="text-center"
          >
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
              className="inline-flex items-center gap-2 bg-[#0EA4AB]/10 border border-[#0EA4AB]/30 px-4 py-2 rounded-full text-sm text-ink-accent font-medium mb-8"
            >
              <Sparkles size={16} />
              About IBO
            </motion.div>
            
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-ink mb-6 leading-tight">
              Building the Future of
              <span className="block text-ink-accent">Cryptocurrency Trading</span>
            </h1>
            
            <p className="text-lg md:text-xl text-ink-muted max-w-3xl mx-auto leading-relaxed">
              IBO is more than a token — it's the foundation of a comprehensive crypto ecosystem 
              designed to bridge decentralized and centralized finance, empowering traders and 
              investors worldwide.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Our Mission Section */}
      <Section className="bg-surface" id="mission">
        <div className="max-w-7xl mx-auto px-6 md:px-10 xl:px-16">
          <motion.div variants={fadeInUp} className="text-center mb-16">
            <span className="text-[#0EA4AB] text-sm font-semibold tracking-widest uppercase">
              Our Mission
            </span>
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-ink mt-4 mb-6">
              Democratizing Access to
              <span className="text-ink-accent"> Advanced Trading</span>
            </h2>
            <p className="text-ink-muted text-lg max-w-3xl mx-auto">
              We believe everyone deserves access to professional-grade trading infrastructure. 
              Our mission is to eliminate barriers and create an inclusive ecosystem where 
              anyone can participate in the digital economy.
            </p>
          </motion.div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {missionValues.map((value, index) => (
              <motion.div
                key={value.title}
                variants={fadeInUp}
                className="group relative"
              >
                <div className="relative h-full bg-gradient-to-b from-surface-card to-surface-elevated border border-line rounded-2xl p-8 overflow-hidden hover:border-[#0EA4AB]/50 transition-all duration-500">
                  {/* Hover gradient */}
                  <div className="absolute inset-0 bg-gradient-to-b from-[#0EA4AB]/0 to-[#0EA4AB]/0 group-hover:from-[#0EA4AB]/5 group-hover:to-transparent transition-all duration-500" />
                  
                  {/* Icon */}
                  <div className="relative w-14 h-14 rounded-2xl bg-logo-gradient flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
                    <value.icon size={26} className="icon-on-gradient text-white" />
                  </div>
                  
                  {/* Content */}
                  <h3 className="relative text-xl font-bold text-ink mb-3 group-hover:text-ink-accent transition-colors">
                    {value.title}
                  </h3>
                  <p className="relative text-ink-muted leading-relaxed">
                    {value.description}
                  </p>
                  
                  {/* Bottom accent */}
                  <div className="absolute bottom-0 left-0 w-0 h-1 bg-logo-gradient group-hover:w-full transition-all duration-500" />
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </Section>

      {/* Why IBO is Different Section */}
      <Section className="bg-gradient-to-b from-surface via-surface-elevated to-surface" id="different">
        <div className="max-w-7xl mx-auto px-6 md:px-10 xl:px-16">
          <motion.div variants={fadeInUp} className="text-center mb-16">
            <span className="text-[#0EA4AB] text-sm font-semibold tracking-widest uppercase">
              Why We're Different
            </span>
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-ink mt-4 mb-6">
              Not Just Another Token
            </h2>
            <p className="text-ink-muted text-lg max-w-3xl mx-auto">
              In a market flooded with speculative tokens and empty promises, IBO stands apart 
              with real utility, transparent development, and a clear path to sustainable growth.
            </p>
          </motion.div>

          <div className="grid md:grid-cols-2 gap-8">
            {differentiators.map((item, index) => (
              <motion.div
                key={item.title}
                variants={fadeInUp}
                className="group relative"
              >
                <div className="relative flex gap-6 p-8 bg-surface-card/50 border border-line rounded-2xl overflow-hidden hover:border-[#0EA4AB]/30 transition-all duration-300">
                  {/* Number indicator */}
                  <div className="absolute top-4 right-4 text-6xl font-bold text-[#1a2748] group-hover:text-[#0EA4AB]/20 transition-colors">
                    0{index + 1}
                  </div>
                  
                  {/* Icon */}
                  <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-[#0EA4AB]/10 flex items-center justify-center text-ink-accent group-hover:bg-[#0EA4AB]/20 transition-colors">
                    <item.icon size={24} />
                  </div>
                  
                  {/* Content */}
                  <div className="relative">
                    <h3 className="text-xl font-bold text-ink mb-3 group-hover:text-ink-accent transition-colors">
                      {item.title}
                    </h3>
                    <p className="text-ink-muted leading-relaxed">
                      {item.description}
                    </p>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </Section>

      {/* The Ecosystem Section */}
      <Section className="bg-surface relative overflow-hidden" id="ecosystem">
        {/* Background decoration */}
        <div className="absolute inset-0 opacity-30">
          <div className="absolute top-1/4 left-0 w-full h-px bg-gradient-to-r from-transparent via-[#0EA4AB]/30 to-transparent" />
          <div className="absolute top-2/4 left-0 w-full h-px bg-gradient-to-r from-transparent via-[#0EA4AB]/20 to-transparent" />
          <div className="absolute top-3/4 left-0 w-full h-px bg-gradient-to-r from-transparent via-[#0EA4AB]/30 to-transparent" />
        </div>

        <div className="max-w-7xl mx-auto px-6 md:px-10 xl:px-16 relative z-10">
          <motion.div variants={fadeInUp} className="text-center mb-16">
            <span className="text-[#0EA4AB] text-sm font-semibold tracking-widest uppercase">
              The Ecosystem
            </span>
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-ink mt-4 mb-6">
              Built Around <span className="text-ink-accent">Real Utility</span>
            </h2>
            <p className="text-ink-muted text-lg max-w-3xl mx-auto">
              Every component of the IBO ecosystem is designed to work together seamlessly, 
              creating compounding value for token holders and users alike.
            </p>
          </motion.div>

          <div className="space-y-6">
            {ecosystemPillars.map((pillar, index) => (
              <motion.div
                key={pillar.title}
                variants={fadeInUp}
                className="group"
              >
                <div className="relative bg-gradient-to-r from-surface-card via-surface-soft to-surface-card border border-line rounded-2xl p-8 md:p-10 overflow-hidden hover:border-[#0EA4AB]/30 transition-all duration-500">
                  {/* Phase number */}
                  <div className="absolute top-6 right-6 md:top-10 md:right-10">
                    <span className="text-5xl md:text-6xl font-bold text-[#1a2748] group-hover:text-[#0EA4AB]/30 transition-colors">
                      {pillar.phase}
                    </span>
                  </div>
                  
                  <div className="grid md:grid-cols-2 gap-8 items-center">
                    {/* Left content */}
                    <div>
                      <span className="text-[#0EA4AB] text-sm font-medium tracking-wider uppercase">
                        {pillar.subtitle}
                      </span>
                      <h3 className="text-2xl md:text-3xl font-bold text-ink mt-2 mb-4 group-hover:text-ink-accent transition-colors">
                        {pillar.title}
                      </h3>
                      <p className="text-ink-muted leading-relaxed">
                        {pillar.description}
                      </p>
                    </div>
                    
                    {/* Right features */}
                    <div className="grid grid-cols-2 gap-4">
                      {pillar.features.map((feature, fIndex) => (
                        <div 
                          key={feature}
                          className="flex items-center gap-3 bg-surface/50 rounded-xl px-4 py-3"
                        >
                          <CheckCircle size={18} className="text-ink-accent flex-shrink-0" />
                          <span className="text-ink text-sm font-medium">{feature}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  
                  {/* Bottom progress line */}
                  <div className="absolute bottom-0 left-0 h-1 bg-logo-gradient" style={{ width: `${(index + 1) * 25}%` }} />
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </Section>

      {/* Long-Term Vision Section */}
      <Section className="bg-gradient-to-b from-surface via-surface-elevated to-surface" id="vision">
        <div className="max-w-7xl mx-auto px-6 md:px-10 xl:px-16">
          <motion.div variants={fadeInUp} className="text-center mb-16">
            <span className="text-[#0EA4AB] text-sm font-semibold tracking-widest uppercase">
              Long-Term Vision
            </span>
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-ink mt-4 mb-6">
              Building for the <span className="text-ink-accent">Future</span>
            </h2>
            <p className="text-ink-muted text-lg max-w-3xl mx-auto">
              IBO isn't a short-term project — we're building infrastructure designed to 
              grow and evolve over years, not months. Here's our vision for the future.
            </p>
          </motion.div>

          <div className="relative">
            {/* Timeline line */}
            <div className="absolute left-4 sm:left-8 md:left-1/2 top-0 bottom-0 w-px bg-gradient-to-b from-[#0EA4AB] via-[#C5E35B] to-[#0EA4AB]/30" />

            <div className="space-y-12">
              {visionTimeline.map((item, index) => (
                <motion.div
                  key={item.year}
                  variants={fadeInUp}
                  className={`relative flex flex-col md:flex-row gap-6 sm:gap-8 ${
                    index % 2 === 0 ? 'md:flex-row' : 'md:flex-row-reverse'
                  }`}
                >
                  {/* Timeline node */}
                  <div className="absolute left-4 sm:left-8 md:left-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-logo-gradient shadow-[0_0_20px_rgba(14,164,171,0.5)]" />
                  
                  {/* Year badge */}
                  <div className={`md:w-1/2 flex ${index % 2 === 0 ? 'md:justify-end md:pr-16' : 'md:justify-start md:pl-16'}`}>
                    <div className="ml-10 sm:ml-16 md:ml-0">
                      <span className="inline-block px-4 sm:px-6 py-2 bg-logo-gradient text-[#050a1a] font-bold text-lg sm:text-xl rounded-full">
                        {item.year}
                      </span>
                    </div>
                  </div>
                  
                  {/* Content card */}
                  <div className={`md:w-1/2 ml-10 sm:ml-16 md:ml-0 ${index % 2 === 0 ? 'md:pl-16' : 'md:pr-16'}`}>
                    <div className="bg-surface-card border border-line rounded-2xl p-5 sm:p-6 hover:border-[#0EA4AB]/30 transition-colors">
                      <h3 className="text-lg sm:text-xl font-bold text-ink mb-4">{item.title}</h3>
                      <ul className="space-y-3">
                        {item.points.map((point, pIndex) => (
                          <li key={pIndex} className="flex items-start gap-3">
                            <ArrowRight size={16} className="text-ink-accent mt-1 flex-shrink-0" />
                            <span className="text-ink-muted">{point}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </Section>

      {/* CTA Section */}
      <Section className="bg-surface">
        <div className="max-w-4xl mx-auto px-6">
          <motion.div
            variants={fadeInUp}
            className="relative bg-gradient-to-br from-surface-card via-surface-soft to-surface-card border border-[#0EA4AB]/30 rounded-3xl p-10 md:p-16 text-center overflow-hidden"
          >
            {/* Background glow */}
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(14,164,171,0.15),transparent_70%)]" />
            
            {/* Corner decorations */}
            <div className="absolute top-0 left-0 w-16 h-16 border-t-2 border-l-2 border-[#0EA4AB] rounded-tl-3xl" />
            <div className="absolute top-0 right-0 w-16 h-16 border-t-2 border-r-2 border-[#0EA4AB] rounded-tr-3xl" />
            <div className="absolute bottom-0 left-0 w-16 h-16 border-b-2 border-l-2 border-[#0EA4AB] rounded-bl-3xl" />
            <div className="absolute bottom-0 right-0 w-16 h-16 border-b-2 border-r-2 border-[#0EA4AB] rounded-br-3xl" />
            
            <div className="relative">
              <h2 className="text-3xl md:text-4xl font-bold text-ink mb-4">
                Explore the IBO Ecosystem
              </h2>
              <p className="text-ink-muted text-lg mb-8 max-w-2xl mx-auto">
                Be part of the IBO ecosystem and help shape the future of cryptocurrency trading. 
                Early supporters will benefit from exclusive perks and opportunities.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <button
                  type="button"
                  onClick={showBuyNotice}
                  className="inline-flex items-center gap-2 bg-logo-gradient text-[#050a1a] font-bold px-8 py-4 rounded-xl hover:scale-105 transition-transform shadow-[0_0_30px_rgba(14,164,171,0.3)]"
                >
                  Buy $IBO Now
                  <ArrowRight size={18} />
                </button>
                <Link
                  to="/whitepaper"
                  className="inline-flex items-center gap-2 border-2 border-[#4A4B50] hover:border-[#C5E35B] text-ink-soft hover:text-ink-accent font-semibold px-8 py-4 rounded-xl transition-all"
                >
                  Read Whitepaper
                </Link>
              </div>
            </div>
          </motion.div>
        </div>
      </Section>

      <ProjectTransparency />

      {/* Footer */}
      <footer className="py-8 border-t border-line">
        <div className="max-w-7xl mx-auto px-6 md:px-10 xl:px-16">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4 text-ink-muted text-sm">
            <p>&copy; {new Date().getFullYear()} IBO. All rights reserved.</p>
            <div className="flex items-center gap-6">
              <Link to="/" className="hover:text-ink-accent transition-colors">Home</Link>
              <Link to="/whitepaper" className="hover:text-ink-accent transition-colors">Whitepaper</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default AboutPage;
