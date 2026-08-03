import { motion, useInView } from 'framer-motion';
import { useRef } from 'react';
import { Coins, Globe2, Layers3, Radio } from 'lucide-react';
import { getExchangeStatusLabel } from '@/config/site';

const PROJECT_FACTS = [
  {
    label: 'Token Symbol',
    value: '$IBO',
    icon: Coins,
    highlight: true,
  },
  {
    label: 'Network',
    value: 'BNB Chain',
    icon: Globe2,
    highlight: false,
  },
  {
    label: 'Total Supply',
    value: '90,00,00,000',
    icon: Layers3,
    highlight: false,
  },
  {
    label: 'Exchange Status',
    value: getExchangeStatusLabel(),
    icon: Radio,
    highlight: true,
  },
];

export const Stats = () => {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: '-50px' });

  return (
    <section
      id="stats-section"
      ref={ref}
      className="relative py-12 md:py-16 overflow-hidden"
      data-testid="stats-section"
    >
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-surface-card/40 to-transparent" />
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#0EA4AB]/50 to-transparent" />
      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#4D8AFF]/40 to-transparent" />

      <motion.div
        aria-hidden="true"
        animate={{ opacity: [0.25, 0.45, 0.25], x: [0, 40, 0] }}
        transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }}
        className="pointer-events-none absolute top-1/2 left-[15%] h-40 w-56 -translate-y-1/2 rounded-full bg-[#0EA4AB]/20 blur-3xl"
      />
      <motion.div
        aria-hidden="true"
        animate={{ opacity: [0.2, 0.4, 0.2], x: [0, -30, 0] }}
        transition={{ duration: 14, repeat: Infinity, ease: 'easeInOut' }}
        className="pointer-events-none absolute top-1/2 right-[12%] h-40 w-56 -translate-y-1/2 rounded-full bg-[#4D8AFF]/15 blur-3xl"
      />

      <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 md:px-10 xl:px-16">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 lg:gap-5"
        >
          {PROJECT_FACTS.map((stat, index) => {
            const Icon = stat.icon;
            return (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, y: 20 }}
                animate={isInView ? { opacity: 1, y: 0 } : {}}
                transition={{ duration: 0.45, delay: index * 0.08 }}
                className="group relative overflow-hidden rounded-2xl border border-[#0EA4AB]/20 bg-surface-card/90 p-5 sm:p-6 backdrop-blur-md transition-all duration-300 hover:-translate-y-1 hover:border-[#4D8AFF]/45 hover:shadow-[0_16px_40px_rgba(77,138,255,0.12)]"
                data-testid={`stat-card-${index}`}
              >
                <div className="absolute inset-x-0 top-0 h-[2px] bg-logo-gradient opacity-80" />
                <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-[#4D8AFF]/10 blur-2xl transition-opacity group-hover:opacity-100 opacity-60" />

                <div className="relative mb-4 flex items-center justify-between gap-3">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-muted sm:text-xs">
                    {stat.label}
                  </span>
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-logo-gradient shadow-[0_0_16px_rgba(14,164,171,0.25)]">
                    <Icon size={16} className="icon-on-gradient text-white" strokeWidth={2.4} />
                  </span>
                </div>

                <p
                  className={`relative text-xl font-bold tracking-tight break-words sm:text-2xl ${
                    stat.highlight ? 'text-[#4D8AFF]' : 'text-ink'
                  }`}
                >
                  {stat.value}
                </p>
              </motion.div>
            );
          })}
        </motion.div>
      </div>
    </section>
  );
};

export default Stats;
