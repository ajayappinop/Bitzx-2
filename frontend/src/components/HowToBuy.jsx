import { motion, useInView } from 'framer-motion';
import { useRef } from 'react';
import { Wallet, ArrowDownUp, ExternalLink, Copy, Check } from 'lucide-react';
import { useState } from 'react';
import { useExchangeDevNotice } from '@/components/ExchangeDevNotice';

const steps = [
  {
    step: 1,
    icon: Wallet,
    title: 'Create a Wallet',
    description: 'Download MetaMask or Trust Wallet and set up your wallet. Make sure to securely store your seed phrase.',
  },
  {
    step: 2,
    icon: () => <span className="text-2xl font-bold">BNB</span>,
    title: 'Add BNB',
    description: 'Purchase BNB from an exchange like Binance and transfer it to your wallet address.',
  },
  {
    step: 3,
    icon: ExternalLink,
    title: 'Connect to PancakeSwap',
    description: 'Go to PancakeSwap and connect your wallet. Make sure you\'re on the BNB Smart Chain network.',
  },
  {
    step: 4,
    icon: ArrowDownUp,
    title: 'Swap for $IBO',
    description: 'Enter the $IBO contract address, set your slippage to 5-10%, and swap your BNB for $IBO tokens.',
  },
];

export const HowToBuy = () => {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: '-100px' });
  const [copied, setCopied] = useState(false);
  const { showBuyNotice } = useExchangeDevNotice();

  const contractAddress = '0x7962f32a587c49ad4235ddc5982a0ae1945a2c01';

  const handleCopy = () => {
    navigator.clipboard.writeText(contractAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section
      id="how-to-buy"
      ref={ref}
      className="section-padding relative overflow-hidden bg-gradient-to-b from-surface via-surface-elevated to-surface"
      data-testid="how-to-buy-section"
    >
      {/* Background */}
      <div className="absolute top-1/2 left-0 w-96 h-96 bg-[#0EA4AB]/5 rounded-full blur-3xl" />

      <div className="max-w-7xl mx-auto relative z-10">
        {/* Section Header */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <span className="inline-block text-ink-accent text-sm font-semibold tracking-wider uppercase mb-4">
            How to Buy
          </span>
          <h2 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold text-ink mb-6">
            Get $IBO in 4 Simple Steps
          </h2>
          <p className="text-ink-soft text-lg md:text-xl max-w-3xl mx-auto leading-relaxed">
            Follow these easy steps to become a $IBO holder and join the IBO ecosystem
          </p>
        </motion.div>

        {/* Steps Grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8 xl:gap-10 mb-14">
          {steps.map((item, index) => (
            <motion.div
              key={item.step}
              initial={{ opacity: 0, y: 30 }}
              animate={isInView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.5, delay: index * 0.1 }}
              className="card-glass p-6 relative group"
              data-testid={`how-to-buy-step-${index}`}
            >
              {/* Step Number */}
              <div className="absolute -top-3 -right-3 w-10 h-10 rounded-full bg-logo-gradient flex items-center justify-center text-white font-bold icon-on-gradient">
                {item.step}
              </div>

              {/* Icon */}
              <div className="w-14 h-14 rounded-xl bg-logo-gradient flex items-center justify-center mb-4 group-hover:scale-105 transition-transform icon-on-gradient text-white">
                {typeof item.icon === 'function' ? <item.icon /> : <item.icon size={28} />}
              </div>

              {/* Content */}
              <h3 className="text-lg font-semibold text-ink mb-2">{item.title}</h3>
              <p className="text-ink-muted text-sm leading-relaxed">{item.description}</p>
            </motion.div>
          ))}
        </div>

        {/* Contract Address & Buy Button */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, delay: 0.5 }}
          className="glass rounded-2xl p-8 md:p-12 text-center border border-[#0EA4AB]/20"
        >
          <h3 className="text-xl md:text-2xl font-bold text-ink mb-4">
            Contract Address
          </h3>
          
          {/* Contract Display */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-2 mb-8">
            <code className="text-ink-accent text-xs sm:text-sm md:text-base bg-surface/50 px-4 md:px-6 py-3 rounded-xl font-mono break-all leading-relaxed">
              {contractAddress}
            </code>
            <button
              onClick={handleCopy}
              className="p-3 rounded-xl bg-surface/50 hover:bg-[#0EA4AB]/20 transition-colors text-ink-accent self-center"
              data-testid="copy-contract-btn"
            >
              {copied ? <Check size={20} /> : <Copy size={20} />}
            </button>
          </div>

          {/* Buy Button */}
          <motion.button
            type="button"
            onClick={showBuyNotice}
            className="btn-primary inline-flex w-full sm:w-auto justify-center items-center gap-2 text-base sm:text-lg"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.98 }}
            data-testid="pancakeswap-buy-btn"
          >
            Buy $IBO
          </motion.button>

          <p className="text-ink-muted text-sm mt-4">
            Always verify the contract address before swapping
          </p>
        </motion.div>
      </div>
    </section>
  );
};

export default HowToBuy;
