import { motion, useInView } from 'framer-motion';
import { useRef } from 'react';
import { FileText, Download, ArrowRight, BookOpen, Target, Coins, Building } from 'lucide-react';

const whitepaperSections = [
  {
    icon: Target,
    title: 'Vision & Mission',
    description: 'Building a comprehensive crypto ecosystem that bridges decentralized and centralized finance.',
  },
  {
    icon: Coins,
    title: 'Tokenomics',
    description: 'Detailed breakdown of token allocation, distribution schedule, and economic model.',
  },
  {
    icon: Building,
    title: 'Exchange Development',
    description: 'Technical roadmap for IBO Exchange, featuring spot trading and advanced features.',
  },
  {
    icon: BookOpen,
    title: 'Full Documentation',
    description: 'Complete technical specifications, smart contract audits, and governance framework.',
  },
];

export const Whitepaper = () => {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: '-100px' });

  return (
    <section
      id="whitepaper"
      ref={ref}
      className="section-padding relative overflow-hidden"
      data-testid="whitepaper-section"
    >
      {/* Background */}
      <div className="absolute bottom-0 right-0 w-96 h-96 bg-[#0EA4AB]/5 rounded-full blur-3xl" />

      <div className="max-w-7xl mx-auto relative z-10">
        {/* Section Header */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <span className="inline-block text-ink-accent text-sm font-semibold tracking-wider uppercase mb-4">
            Whitepaper
          </span>
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-ink mb-6">
            Deep Dive Into IBO
          </h2>
          <p className="text-ink-soft text-base md:text-lg max-w-3xl mx-auto leading-relaxed">
            Our comprehensive whitepaper covers everything from technical architecture to long-term vision
          </p>
        </motion.div>

        {/* Main Content */}
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          {/* Left: Document Preview */}
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            animate={isInView ? { opacity: 1, x: 0 } : {}}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="relative"
          >
            <div className="glass rounded-3xl p-8 md:p-12 border border-[#0EA4AB]/20">
              {/* Document Icon */}
              <div className="w-20 h-20 rounded-2xl bg-logo-gradient flex items-center justify-center mx-auto mb-8">
                <FileText size={40} className="icon-on-gradient text-white" />
              </div>

              <h3 className="text-2xl md:text-3xl font-bold text-ink text-center mb-4">
                IBO Whitepaper v1.0
              </h3>
              <p className="text-ink-muted text-center mb-8">
                The complete guide to understanding the IBO ecosystem, tokenomics, and future roadmap.
              </p>

              {/* Stats */}
              <div className="grid grid-cols-3 gap-4 mb-8">
                <div className="text-center">
                  <p className="text-2xl font-bold text-gold-gradient">24</p>
                  <p className="text-ink-muted text-xs">Pages</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-gold-gradient">v1.0</p>
                  <p className="text-ink-muted text-xs">Version</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-gold-gradient">EN</p>
                  <p className="text-ink-muted text-xs">Language</p>
                </div>
              </div>

              {/* Download Button */}
              <motion.a
                href="/whitepaper"
                target="_blank"
                rel="noopener noreferrer"
                className="btn-primary w-full flex items-center justify-center gap-2 text-center"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                data-testid="whitepaper-download-btn"
              >
                <Download size={20} />
                View Whitepaper
              </motion.a>

              <p className="text-ink-muted text-xs text-center mt-4">
                PDF available for download
              </p>
            </div>
          </motion.div>

          {/* Right: Sections */}
          <motion.div
            initial={{ opacity: 0, x: 30 }}
            animate={isInView ? { opacity: 1, x: 0 } : {}}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="space-y-6"
          >
            <h3 className="text-xl font-semibold text-ink mb-6">What's Inside</h3>
            
            {whitepaperSections.map((section, index) => (
              <motion.div
                key={section.title}
                initial={{ opacity: 0, y: 20 }}
                animate={isInView ? { opacity: 1, y: 0 } : {}}
                transition={{ duration: 0.4, delay: 0.4 + index * 0.1 }}
                className="card-glass p-5 flex items-start gap-4 group cursor-pointer"
                data-testid={`whitepaper-section-${index}`}
              >
                <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-logo-gradient flex items-center justify-center group-hover:scale-105 transition-transform">
                  <section.icon size={24} className="icon-on-gradient text-white" />
                </div>
                <div className="flex-1">
                  <h4 className="text-ink font-semibold mb-1 group-hover:text-ink-accent transition-colors flex items-center gap-2">
                    {section.title}
                    <ArrowRight size={16} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                  </h4>
                  <p className="text-ink-muted text-sm leading-relaxed">
                    {section.description}
                  </p>
                </div>
              </motion.div>
            ))}

            {/* Bottom Note */}
            <div className="pt-4 border-t border-[#4A4B50]/30">
              <p className="text-ink-muted text-sm">
                Whitepaper is regularly updated with the latest developments and roadmap changes.
              </p>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
};

export default Whitepaper;
