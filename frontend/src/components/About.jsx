import { motion, useInView } from 'framer-motion';
import { useRef } from 'react';
import { Shield, Zap, Globe, TrendingUp } from 'lucide-react';
import { SITE_CONFIG } from '@/config/site';

const features = [
  {
    icon: Shield,
    title: 'Security First',
    description: 'Built with enterprise-grade security protocols to protect your assets and transactions.',
  },
  {
    icon: Zap,
    title: 'Lightning Fast',
    description: 'Experience near-instant transactions powered by BNB Chain\'s high-performance network.',
  },
  {
    icon: Globe,
    title: 'Global Reach',
    description: 'Join a worldwide community of traders and investors shaping the future of finance.',
  },
  {
    icon: TrendingUp,
    title: 'Growth Potential',
    description: 'Early holders benefit from ecosystem expansion and utility on the live IBO Exchange.',
  },
];

export const About = () => {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: '-100px' });

  return (
    <section
      id="about"
      ref={ref}
      className="section-padding relative overflow-hidden"
      data-testid="about-section"
    >
      {/* Background Elements */}
      <div className="absolute top-1/4 left-0 w-96 h-96 bg-[#0EA4AB]/5 rounded-full blur-3xl" />
      <div className="absolute bottom-1/4 right-0 w-96 h-96 bg-[#C5E35B]/5 rounded-full blur-3xl" />

      <div className="max-w-7xl mx-auto relative z-10">
        {/* Section Header */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <span className="inline-block text-ink-accent text-sm font-semibold tracking-wider uppercase mb-4">
            About IBO
          </span>
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-ink mb-6">
            More Than Just a Token
          </h2>
          <p className="text-ink-soft text-base md:text-lg max-w-3xl mx-auto leading-relaxed">
            IBO is the cornerstone of an ambitious crypto ecosystem. We're building real utility, 
            real infrastructure, and a real community — not just another speculative asset.
          </p>
        </motion.div>

        {/* Main Content Grid */}
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          {/* Left: Image/Visual */}
          <motion.div
            initial={{ opacity: 0, x: -50 }}
            animate={isInView ? { opacity: 1, x: 0 } : {}}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="relative"
          >
            <div className="relative rounded-3xl overflow-hidden border border-[#4A4B50]/30">
              <img
                src={SITE_CONFIG.brandLogoUrl}
                alt="IBO Logo"
                className="w-full h-80 md:h-96 object-contain p-10 bg-[radial-gradient(circle_at_center,rgba(14,164,171,0.18),transparent_65%)]"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-surface via-transparent to-transparent" />
              
              {/* Floating Badge */}
              <div className="absolute bottom-6 left-6 right-6 glass rounded-xl p-4">
                <p className="text-ink-accent font-semibold mb-1">Our Mission</p>
                <p className="text-ink-soft text-sm">
                  To democratize access to advanced trading infrastructure through the IBO ecosystem.
                </p>
              </div>
            </div>
          </motion.div>

          {/* Right: Features */}
          <motion.div
            initial={{ opacity: 0, x: 50 }}
            animate={isInView ? { opacity: 1, x: 0 } : {}}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="space-y-6"
          >
            {features.map((feature, index) => (
              <motion.div
                key={feature.title}
                initial={{ opacity: 0, y: 20 }}
                animate={isInView ? { opacity: 1, y: 0 } : {}}
                transition={{ duration: 0.5, delay: 0.4 + index * 0.1 }}
                className="card-glass p-6 flex gap-4 group"
                data-testid={`about-feature-${index}`}
              >
                <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-logo-gradient flex items-center justify-center group-hover:scale-110 transition-transform icon-on-gradient text-white">
                  <feature.icon size={24} />
                </div>
                <div>
                  <h3 className="text-ink font-semibold text-lg mb-1">{feature.title}</h3>
                  <p className="text-ink-muted text-sm leading-relaxed">{feature.description}</p>
                </div>
              </motion.div>
            ))}
          </motion.div>
        </div>

        {/* Bottom Stats */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, delay: 0.6 }}
          className="mt-16 grid grid-cols-2 md:grid-cols-4 gap-6"
        >
          {[
            { value: '900M', label: 'Total Supply' },
            { value: 'BEP-20', label: 'Token Standard' },
            { value: SITE_CONFIG.launchYear, label: 'Launch Year' },
            { value: 'Public docs', label: 'Whitepaper Available' },
          ].map((item, index) => (
            <div
              key={item.label}
              className="text-center p-6 card-glass"
              data-testid={`about-stat-${index}`}
            >
              <p className="text-3xl md:text-4xl font-bold text-gold-gradient mb-2">{item.value}</p>
              <p className="text-ink-muted text-sm">{item.label}</p>
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  );
};

export default About;
