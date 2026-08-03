/**
 * Landing — F.I.U. Registered & Ledger Safe Custody trust badges.
 */
import { motion } from 'framer-motion';
import fiuRegisteredImg from '@/assets/fiu-registered.png';
import ledgerSafeCustodyImg from '@/assets/ledger-safe-custody.png';

function TrustBadgeImage({ src, alt }) {
  return (
    <img
      src={src}
      alt={alt}
      className="h-[52px] sm:h-[56px] w-auto object-contain rounded-xl block"
      loading="lazy"
      draggable={false}
    />
  );
}

function FiuRegisteredBadge() {
  return <TrustBadgeImage src={fiuRegisteredImg} alt="F.I.U. Registered" />;
}

function LedgerSafeCustodyBadge() {
  return <TrustBadgeImage src={ledgerSafeCustodyImg} alt="Ledger Safe Custody" />;
}

export default function LandingTrustBadges({ className = '', animateOnMount = false }) {
  const motionProps = animateOnMount
    ? { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.45, delay: 0.48 } }
    : { initial: { opacity: 0, y: 12 }, whileInView: { opacity: 1, y: 0 }, viewport: { once: true }, transition: { duration: 0.45 } };

  return (
    <motion.div
      {...motionProps}
      className={`flex flex-wrap items-center gap-3 ${className}`}
      data-testid="landing-trust-badges"
    >
      <FiuRegisteredBadge />
      <LedgerSafeCustodyBadge />
    </motion.div>
  );
}
