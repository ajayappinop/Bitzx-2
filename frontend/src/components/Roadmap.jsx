import { motion, useInView } from 'framer-motion';
import { useRef } from 'react';
import { Check, Circle, Loader2 } from 'lucide-react';
const roadmapPhases = [
  {
    phase: 'Phase 1',
    title: 'Foundation',
    status: 'completed',
    items: [
      'Token creation & smart contract deployment',
      'Brand identity & website launch',
      'Community building on Telegram & X',
      'Initial marketing campaigns',
    ],
  },
  {
    phase: 'Phase 2',
    title: 'Launch & Growth',
    status: 'active',
    items: [
      'PancakeSwap listing',
      'CoinGecko & CoinMarketCap listings',
      'Influencer partnerships',
      'Holder milestone rewards',
    ],
  },
  {
    phase: 'Phase 3',
    title: 'Ecosystem Expansion',
    status: 'active',
    items: [
      'Staking platform launch',
      'Strategic partnerships',
      'Cross-chain bridge development',
      'Mobile app development',
    ],
  },
  {
    phase: 'Phase 4',
    title: 'Exchange Live',
    status: 'completed',
    items: [
      'IBO Exchange live at exchange.ibo.io',
      'KYC/AML integration',
      'INR deposit & payout flows',
      'Advanced trading features',
    ],
  },
  {
    phase: 'Phase 5',
    title: 'Full Ecosystem',
    status: 'upcoming',
    items: [
      'Options & advanced products',
      'Global expansion',
      'Institutional trading desk',
      'Continuous innovation & growth',
    ],
  },
];

export const Roadmap = () => {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: '-100px' });
  const statusStyles = {
    completed: {
      badge: 'bg-emerald-500',
      badgeIcon: 'text-white',
      chip: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/25',
      dot: 'bg-emerald-500',
      card: 'border-emerald-500/30',
      node: 'bg-emerald-500 shadow-[0_0_18px_rgba(16,185,129,0.35)]',
    },
    active: {
      badge: 'bg-[#4D8AFF]',
      badgeIcon: 'text-white',
      chip: 'bg-[#4D8AFF]/15 text-[#4D8AFF] border-[#4D8AFF]/35',
      dot: 'bg-[#4D8AFF]',
      card: 'border-[#4D8AFF]/45',
      node: 'bg-[#4D8AFF] shadow-[0_0_20px_rgba(77,138,255,0.45)] animate-pulse',
    },
    upcoming: {
      badge: 'bg-[#4A4B50]',
      badgeIcon: 'text-ink-muted',
      chip: 'bg-[#4A4B50]/20 text-ink-muted border-[#4A4B50]/40',
      dot: 'bg-[#4A4B50]',
      card: 'border-line',
      node: 'bg-[#4A4B50]',
    },
  };

  const getStatusIcon = (status) => {
    const styles = statusStyles[status] || statusStyles.upcoming;
    if (status === 'completed') {
      return <Check size={15} className={styles.badgeIcon} strokeWidth={2.75} />;
    }
    if (status === 'active') {
      return <Loader2 size={14} className={`${styles.badgeIcon} animate-spin`} strokeWidth={2.5} />;
    }
    return <Circle size={12} className={styles.badgeIcon} strokeWidth={2.5} />;
  };

  return (
    <section
      id="roadmap"
      ref={ref}
      className="roadmap-section relative overflow-hidden bg-surface py-24 md:py-32 xl:py-36"
      data-testid="roadmap-section"
    >
      <div className="pointer-events-none absolute right-0 top-0 h-96 w-96 rounded-full bg-[#0EA4AB]/10 blur-3xl" />
      <div className="pointer-events-none absolute bottom-0 left-0 h-96 w-96 rounded-full bg-[#4D8AFF]/10 blur-3xl" />

      <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 md:px-10 xl:px-16">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="mb-16 text-center"
        >
          <span className="mb-4 inline-block text-sm font-semibold uppercase tracking-wider text-ink-accent">
            Roadmap
          </span>
          <h2 className="mb-6 text-3xl font-bold text-ink sm:text-4xl md:text-5xl lg:text-6xl">
            Our Journey to Success
          </h2>
          <p className="mx-auto max-w-3xl text-lg leading-relaxed text-ink-soft md:text-xl">
            A clear path from token launch to building a comprehensive crypto ecosystem
          </p>
        </motion.div>

        <div className="relative">
          {/* Desktop timeline spine */}
          <div className="roadmap-spine pointer-events-none absolute left-1/2 top-0 hidden h-full w-px -translate-x-1/2 bg-gradient-to-b from-[#0EA4AB] via-[#4D8AFF] to-[#C5D0E0] lg:block" />

          <div className="space-y-10 lg:space-y-14">
            {roadmapPhases.map((phase, index) => {
              const styles = statusStyles[phase.status] || statusStyles.upcoming;
              const isLeft = index % 2 === 0;

              return (
                <motion.div
                  key={phase.phase}
                  initial={{ opacity: 0, y: 28 }}
                  animate={isInView ? { opacity: 1, y: 0 } : {}}
                  transition={{ duration: 0.5, delay: index * 0.12 }}
                  className="relative lg:grid lg:grid-cols-2 lg:gap-16"
                  data-testid={`roadmap-phase-${index}`}
                >
                  <div
                    className={`${
                      isLeft ? 'lg:pr-4 lg:text-right' : 'lg:col-start-2 lg:pl-4'
                    }`}
                  >
                    <div
                      className={`roadmap-card relative overflow-hidden rounded-2xl border bg-surface-card p-6 shadow-[0_8px_28px_rgba(15,40,80,0.06)] backdrop-blur-sm md:p-8 ${styles.card}`}
                    >
                      <div className="absolute inset-x-0 top-0 h-[2px] bg-logo-gradient opacity-80" />

                      <div
                        className={`mb-4 flex flex-wrap items-center gap-3 ${
                          isLeft ? 'lg:justify-end' : ''
                        }`}
                      >
                        <span
                          className={`inline-flex h-8 w-8 items-center justify-center rounded-full ${styles.badge}`}
                        >
                          {getStatusIcon(phase.status)}
                        </span>
                        <span className="text-sm font-semibold text-ink-accent">
                          {phase.phase}
                        </span>
                        {phase.status === 'active' && (
                          <span
                            className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${styles.chip}`}
                          >
                            In Progress
                          </span>
                        )}
                        {phase.status === 'completed' && (
                          <span
                            className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${styles.chip}`}
                          >
                            Completed
                          </span>
                        )}
                        {phase.status === 'upcoming' && (
                          <span
                            className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${styles.chip}`}
                          >
                            Upcoming
                          </span>
                        )}
                      </div>

                      <h3 className="mb-5 text-xl font-bold text-ink md:text-2xl">
                        {phase.title}
                      </h3>

                      <ul className={`space-y-3 ${isLeft ? 'lg:ml-auto' : ''}`}>
                        {phase.items.map((item) => (
                          <li
                            key={item}
                            className={`flex items-start gap-3 text-left ${
                              isLeft ? 'lg:flex-row-reverse lg:text-right' : ''
                            }`}
                          >
                            <span
                              className={`mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full ${styles.dot}`}
                            />
                            <span
                              className={`text-sm leading-relaxed ${
                                phase.status === 'completed'
                                  ? 'text-ink-muted'
                                  : phase.status === 'active'
                                    ? 'text-ink-soft'
                                    : 'text-ink-muted'
                              }`}
                            >
                              {item}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  {/* Desktop center node */}
                  <div className="absolute left-1/2 top-10 hidden -translate-x-1/2 lg:flex">
                    <div
                      className={`h-5 w-5 rounded-full border-[3px] border-surface ${styles.node}`}
                    />
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, delay: 0.75 }}
          className="mt-12 text-center"
        >
          <p className="text-sm text-ink-muted">
            Roadmap is subject to change based on market conditions and community feedback
          </p>
        </motion.div>
      </div>
    </section>
  );
};

export default Roadmap;
