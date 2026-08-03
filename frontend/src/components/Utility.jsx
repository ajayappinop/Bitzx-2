import { motion, useInView } from 'framer-motion';
import { useRef } from 'react';
import { Percent, Crown, Coins, Gift, Rocket, Key } from 'lucide-react';

const utilities = [
  {
    icon: Percent,
    title: 'Trading Fee Discounts',
    description: 'Hold $DELTA to unlock tiered discounts on trading fees across Delta Exchange.',
    size: 'large',
    color: 'from-[#0EA4AB] to-[#C5E35B]',
  },
  {
    icon: Crown,
    title: 'VIP Membership',
    description: 'Exclusive VIP tiers with premium benefits, priority support, and early feature access.',
    size: 'small',
    color: 'from-[#1B5FFF] to-[#0EA4AB]',
  },
  {
    icon: Coins,
    title: 'Staking Rewards',
    description: 'Earn passive income by staking your $DELTA tokens in our secure staking pools.',
    size: 'small',
    color: 'from-[#0EA4AB] to-[#1B5FFF]',
  },
  {
    icon: Gift,
    title: 'Referral Rewards',
    description: 'Invite friends and earn $DELTA rewards for every successful referral to our ecosystem.',
    size: 'small',
    color: 'from-[#C5E35B] to-[#0EA4AB]',
  },
  {
    icon: Rocket,
    title: 'Launchpad Access',
    description: 'Get exclusive early access to new token launches and IDO opportunities on Delta Exchange.',
    size: 'small',
    color: 'from-[#1B5FFF] to-[#C5E35B]',
  },
  {
    icon: Key,
    title: 'Premium Ecosystem',
    description: 'Unlock advanced trading tools, analytics, and features reserved for $DELTA holders.',
    size: 'large',
    color: 'from-[#0EA4AB] to-[#C5E35B]',
  },
];

export const Utility = () => {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: '-100px' });

  return (
    <section
      id="utility"
      ref={ref}
      className="py-24 md:py-32 xl:py-36 relative overflow-hidden bg-surface"
      data-testid="utility-section"
    >
      {/* Background Elements */}
      <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-[#0EA4AB]/5 rounded-full blur-3xl" />
      
      <div className="max-w-7xl mx-auto px-4 sm:px-6 md:px-10 xl:px-16 relative z-10">
        {/* Section Header */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="text-center mb-12 sm:mb-16"
        >
          <span className="inline-block text-ink-accent text-sm font-semibold tracking-wider uppercase mb-4">
            Token Utility
          </span>
          <h2 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold text-ink mb-6">
            Real Utility, Real Value
          </h2>
          <p className="text-ink-soft text-base sm:text-lg md:text-xl max-w-3xl mx-auto leading-relaxed">
            $DELTA isn't just a token — it's your key to the entire Delta ecosystem. 
            From trading benefits to exclusive access, discover what holding $DELTA can do for you.
          </p>
        </motion.div>

        {/* Bento Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-8 xl:gap-10">
          {utilities.map((utility, index) => (
            <motion.div
              key={utility.title}
              initial={{ opacity: 0, y: 30 }}
              animate={isInView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.5, delay: index * 0.1 }}
              className={`card-glass p-6 sm:p-8 relative group overflow-hidden ${
                utility.size === 'large' ? 'lg:col-span-1 row-span-1' : ''
              }`}
              data-testid={`utility-card-${index}`}
            >
              {/* Gradient Overlay on Hover */}
              <div className={`absolute inset-0 bg-gradient-to-br ${utility.color} opacity-0 group-hover:opacity-5 transition-opacity duration-500`} />
              
              {/* Icon */}
              <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${utility.color} flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300`}>
                <utility.icon size={28} className="icon-on-gradient text-white" />
              </div>

              {/* Content */}
              <h3 className="text-xl font-bold text-ink mb-3 group-hover:text-ink-accent transition-colors">
                {utility.title}
              </h3>
              <p className="text-ink-muted leading-relaxed">
                {utility.description}
              </p>

              {/* Decorative Line */}
              <div className="absolute bottom-0 left-0 w-0 h-1 bg-logo-gradient group-hover:w-full transition-all duration-500" />
            </motion.div>
          ))}
        </div>

        {/* Bottom CTA */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, delay: 0.8 }}
          className="mt-8 text-center"
        >
          <p className="text-ink-muted text-sm">
            More utility features will be unveiled as our ecosystem grows
          </p>
        </motion.div>
      </div>
    </section>
  );
};

export default Utility;
