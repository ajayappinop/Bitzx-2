import { motion, useInView } from 'framer-motion';
import { useRef, useState } from 'react';
import { Coins, Lock, Users, Megaphone, Code, Handshake } from 'lucide-react';
import { SITE_CONFIG } from '@/config/site';

const LOGO_ICON_URL = SITE_CONFIG.heroLogoUrl;

const tokenomicsData = [
  { name: 'Liquidity Pool', value: 40, color: '#0EA4AB', icon: Coins, description: 'Locked liquidity for stable trading' },
  { name: 'Marketing', value: 15, color: '#C5E35B', icon: Megaphone, description: 'Growth & awareness campaigns' },
  { name: 'Development', value: 15, color: '#D5D5D0', icon: Code, description: 'Platform & exchange building' },
  { name: 'Ecosystem Rewards', value: 15, color: '#1B5FFF', icon: Users, description: 'Staking & community rewards' },
  { name: 'Team & Reserve', value: 10, color: '#4A9EFF', icon: Lock, description: 'Vested team allocation' },
  { name: 'Partnerships', value: 5, color: '#8A8B90', icon: Handshake, description: 'Strategic collaborations' },
];

const tokenDetails = [
  { label: 'Token Name', value: 'IBO' },
  { label: 'Symbol', value: '$IBO', highlight: true },
  { label: 'Network', value: 'BNB Chain' },
  { label: 'Standard', value: 'BEP-20' },
  { label: 'Total Supply', value: '90,00,00,000' },
  { label: 'Decimals', value: '18' },
];

export const Tokenomics = () => {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: '-100px' });
  const [hoveredIndex, setHoveredIndex] = useState(null);

  return (
    <section
      id="tokenomics"
      ref={ref}
      className="py-20 md:py-32 xl:py-36 relative overflow-hidden bg-surface"
      data-testid="tokenomics-section"
    >
      {/* Background */}
      <div className="absolute inset-0">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[480px] h-[480px] sm:w-[620px] sm:h-[620px] md:w-[800px] md:h-[800px] bg-[#0EA4AB]/5 rounded-full blur-3xl" />
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 md:px-10 xl:px-16 relative z-10">
        {/* Section Header */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <span className="text-[#0EA4AB] text-sm font-semibold tracking-widest uppercase">
            Tokenomics
          </span>
          <h2 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold text-ink mt-3 mb-4">
            Token Distribution
          </h2>
          <p className="text-ink-muted text-lg md:text-xl max-w-2xl mx-auto">
            A balanced allocation designed for long-term growth and ecosystem sustainability
          </p>
        </motion.div>

        {/* Main Content */}
        <div className="grid lg:grid-cols-2 gap-10 lg:gap-20 xl:gap-28 items-center">
          
          {/* Left - Premium Visual */}
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={isInView ? { opacity: 1, scale: 1 } : {}}
            transition={{ duration: 1, delay: 0.2 }}
            className="relative flex items-center justify-center min-h-[300px] sm:min-h-[420px]"
          >
            {/* Outer decorative rings */}
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 60, repeat: Infinity, ease: 'linear' }}
              className="absolute w-[260px] h-[260px] sm:w-[380px] sm:h-[380px] md:w-[450px] md:h-[450px] rounded-full border border-dashed border-[#0EA4AB]/20"
            />
            <motion.div
              animate={{ rotate: -360 }}
              transition={{ duration: 90, repeat: Infinity, ease: 'linear' }}
              className="absolute w-[300px] h-[300px] sm:w-[420px] sm:h-[420px] md:w-[500px] md:h-[500px] rounded-full border border-dashed border-[#C5E35B]/10"
            />
            
            {/* Glow effect */}
            <motion.div
              animate={{
                boxShadow: [
                  '0 0 60px 20px rgba(14,164,171,0.15)',
                  '0 0 80px 30px rgba(14,164,171,0.25)',
                  '0 0 60px 20px rgba(14,164,171,0.15)',
                ],
              }}
              transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
              className="absolute w-[180px] h-[180px] sm:w-[280px] sm:h-[280px] md:w-[340px] md:h-[340px] rounded-full"
            />

            {/* Main chart container */}
            <div className="relative w-[240px] h-[240px] sm:w-[320px] sm:h-[320px] md:w-[380px] md:h-[380px]">
              {/* Segments */}
              {tokenomicsData.map((item, index) => {
                const startAngle = tokenomicsData.slice(0, index).reduce((acc, d) => acc + (d.value / 100) * 360, 0);
                const angle = (item.value / 100) * 360;
                const midAngle = startAngle + angle / 2;
                const isHovered = hoveredIndex === index;
                
                return (
                  <motion.div
                    key={item.name}
                    initial={{ opacity: 0, scale: 0 }}
                    animate={isInView ? { opacity: 1, scale: 1 } : {}}
                    transition={{ duration: 0.5, delay: 0.3 + index * 0.1 }}
                    className="absolute inset-0"
                    onMouseEnter={() => setHoveredIndex(index)}
                    onMouseLeave={() => setHoveredIndex(null)}
                  >
                    <svg viewBox="0 0 100 100" className="w-full h-full transform -rotate-90">
                      <motion.circle
                        cx="50"
                        cy="50"
                        r="40"
                        fill="none"
                        stroke={item.color}
                        strokeWidth={isHovered ? "18" : "16"}
                        strokeDasharray={`${(item.value / 100) * 251.2} 251.2`}
                        strokeDashoffset={-tokenomicsData.slice(0, index).reduce((acc, d) => acc + (d.value / 100) * 251.2, 0)}
                        className="transition-all duration-300 cursor-pointer"
                        style={{
                          filter: isHovered ? `drop-shadow(0 0 10px ${item.color})` : 'none',
                        }}
                        initial={{ strokeDasharray: '0 251.2' }}
                        animate={isInView ? { strokeDasharray: `${(item.value / 100) * 251.2} 251.2` } : {}}
                        transition={{ duration: 1, delay: 0.5 + index * 0.15, ease: 'easeOut' }}
                      />
                    </svg>
                    
                    {/* Label pointer */}
                    {isHovered && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="absolute bg-surface-card border border-[#0EA4AB]/50 rounded-xl px-4 py-2 shadow-lg z-20"
                        style={{
                          left: `${50 + 55 * Math.cos((midAngle - 90) * Math.PI / 180)}%`,
                          top: `${50 + 55 * Math.sin((midAngle - 90) * Math.PI / 180)}%`,
                          transform: 'translate(-50%, -50%)',
                        }}
                      >
                        <p className="text-ink font-semibold text-sm whitespace-normal max-w-[9rem] sm:max-w-none sm:whitespace-nowrap">{item.name}</p>
                        <p className="text-ink-accent font-bold">{item.value}%</p>
                      </motion.div>
                    )}
                  </motion.div>
                );
              })}

              {/* Center content */}
              <div className="absolute inset-0 flex items-center justify-center">
                <motion.div
                  initial={{ opacity: 0, scale: 0 }}
                  animate={isInView ? { opacity: 1, scale: 1 } : {}}
                  transition={{ duration: 0.6, delay: 0.8, type: 'spring' }}
                  className="relative"
                >
                  {/* Outer glow */}
                  <div className="absolute inset-0 bg-[#0EA4AB]/30 rounded-full blur-2xl scale-[2]" />
                  <div className="absolute inset-0 bg-[#C5E35B]/20 rounded-full blur-xl scale-150" />
                  
                  {/* Logo container */}
                  <div className="relative w-24 h-24 sm:w-36 sm:h-36 md:w-44 md:h-44 rounded-full bg-gradient-to-br from-surface-card via-surface-card to-surface border-2 border-[#0EA4AB]/50 flex items-center justify-center shadow-[0_0_40px_rgba(14,164,171,0.4),inset_0_0_30px_rgba(14,164,171,0.2)]">
                    <motion.img
                      src={LOGO_ICON_URL}
                      alt="IBO"
                      className="w-16 h-16 sm:w-24 sm:h-24 md:w-28 md:h-28 object-contain drop-shadow-[0_0_20px_rgba(197,227,91,0.5)]"
                      animate={{ rotateY: [0, 360] }}
                      transition={{ duration: 4, repeat: Infinity, ease: 'linear' }}
                    />
                  </div>
                </motion.div>
              </div>
            </div>

            {/* Floating stat badges */}
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={isInView ? { opacity: 1, x: 0 } : {}}
              transition={{ duration: 0.6, delay: 1 }}
              className="hidden sm:block absolute -left-4 md:left-0 top-1/4 bg-gradient-to-r from-surface-card to-surface-card border border-[#0EA4AB]/30 rounded-xl px-4 py-3 shadow-lg"
            >
              <p className="text-ink-muted text-xs">Total Supply</p>
              <p className="text-ink-accent font-bold text-lg">900M $IBO</p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={isInView ? { opacity: 1, x: 0 } : {}}
              transition={{ duration: 0.6, delay: 1.1 }}
              className="hidden sm:block absolute -right-4 md:right-0 bottom-1/4 bg-gradient-to-r from-surface-card to-surface-card border border-[#0EA4AB]/30 rounded-xl px-4 py-3 shadow-lg"
            >
              <p className="text-ink-muted text-xs">Network</p>
              <p className="text-ink font-bold">BNB Chain</p>
            </motion.div>
          </motion.div>

          {/* Right - Distribution List */}
          <motion.div
            initial={{ opacity: 0, x: 30 }}
            animate={isInView ? { opacity: 1, x: 0 } : {}}
            transition={{ duration: 0.6, delay: 0.3 }}
          >
            <div className="space-y-4">
              {tokenomicsData.map((item, index) => (
                <motion.div
                  key={item.name}
                  initial={{ opacity: 0, x: 20 }}
                  animate={isInView ? { opacity: 1, x: 0 } : {}}
                  transition={{ duration: 0.4, delay: 0.4 + index * 0.1 }}
                  className={`group cursor-pointer ${hoveredIndex === index ? 'scale-[1.02]' : ''} transition-transform`}
                  onMouseEnter={() => setHoveredIndex(index)}
                  onMouseLeave={() => setHoveredIndex(null)}
                  data-testid={`tokenomics-item-${index}`}
                >
                  <div className={`relative bg-gradient-to-r from-surface-card to-surface-soft border rounded-xl p-4 overflow-hidden transition-all ${
                    hoveredIndex === index ? 'border-[#0EA4AB]/50 shadow-[0_0_20px_rgba(14,164,171,0.15)]' : 'border-line'
                  }`}>
                    {/* Progress bar background */}
                    <motion.div 
                      className="absolute left-0 top-0 bottom-0 opacity-10"
                      style={{ backgroundColor: item.color }}
                      initial={{ width: 0 }}
                      animate={isInView ? { width: `${item.value}%` } : {}}
                      transition={{ duration: 1, delay: 0.6 + index * 0.1 }}
                    />
                    
                    <div className="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-start sm:items-center gap-3 sm:gap-4 min-w-0">
                        {/* Color indicator */}
                        <div 
                          className="w-10 h-10 rounded-lg flex-shrink-0 flex items-center justify-center transition-transform group-hover:scale-110"
                          style={{ backgroundColor: `${item.color}20` }}
                        >
                          <item.icon size={20} style={{ color: item.color }} />
                        </div>
                        
                        {/* Info */}
                        <div className="min-w-0">
                          <p className="text-ink font-semibold group-hover:text-ink-accent transition-colors">{item.name}</p>
                          <p className="text-ink-muted text-xs break-words">{item.description}</p>
                        </div>
                      </div>
                      
                      {/* Value */}
                      <div className="text-left sm:text-right pl-[3.25rem] sm:pl-0 flex-shrink-0">
                        <p className="text-ink-accent font-bold text-xl">{item.value}%</p>
                        <p className="text-ink-muted text-xs tabular-nums break-all">
                          {(900000000 * item.value / 100).toLocaleString('en-IN')}
                        </p>
                      </div>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>

        {/* Token Details Card */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, delay: 0.8 }}
          className="mt-16"
        >
          <div className="relative bg-gradient-to-br from-surface-card via-surface-soft to-surface-card border border-[#0EA4AB]/20 rounded-2xl overflow-hidden">
            {/* Background glow */}
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(14,164,171,0.1),transparent_60%)]" />
            
            <div className="relative p-8 md:p-10">
              <h3 className="text-xl font-bold text-ink mb-6 text-center">Token Details</h3>
              
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
                {tokenDetails.map((detail, index) => (
                  <motion.div
                    key={detail.label}
                    initial={{ opacity: 0, y: 20 }}
                    animate={isInView ? { opacity: 1, y: 0 } : {}}
                    transition={{ duration: 0.4, delay: 0.9 + index * 0.05 }}
                    className="text-center p-3 sm:p-4 bg-surface/50 rounded-xl border border-line hover:border-[#0EA4AB]/30 transition-colors min-w-0"
                  >
                    <p className="text-ink-muted text-[10px] sm:text-xs uppercase tracking-wider mb-2">{detail.label}</p>
                    <p className={`font-bold text-sm sm:text-base break-words ${detail.highlight ? 'text-ink-accent' : 'text-ink'}`}>
                      {detail.value}
                    </p>
                  </motion.div>
                ))}
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
};

export default Tokenomics;
