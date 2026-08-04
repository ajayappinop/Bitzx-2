/**
 * Landing — Instant KYC showcase with HD 3D icons (alternating split layout).
 */
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, CheckCircle, Clock, Lock, Shield, Zap } from 'lucide-react';

const STEPS = [
  {
    id: 'aadhaar',
    icon: '/hero/kyc-aadhaar.png?v=1',
    tag: 'UIDAI · OTP / DigiLocker',
    title: 'Aadhaar e-KYC',
    desc: 'Consent-based Aadhaar authentication in seconds — no branch visit or paper forms.',
    accent: 'rgba(254, 108, 2,0.28)',
  },
  {
    id: 'pan',
    icon: '/hero/kyc-pan.png?v=1',
    tag: 'Income Tax · name match',
    title: 'PAN verification',
    desc: 'PAN validated instantly and cross-checked with your Aadhaar name and date of birth.',
    accent: 'rgba(0, 168, 118,0.22)',
    iconClass: 'max-w-[min(100%,220px)] max-h-[180px] sm:max-h-[210px] lg:max-h-[230px]',
  },
  {
    id: 'face',
    icon: '/hero/kyc-face.png?v=12',
    tag: 'Liveness · anti-spoof',
    title: 'Live face match',
    desc: 'Selfie matched to your Aadhaar photo with real-time liveness to block impersonation.',
    accent: 'rgba(254, 108, 2,0.24)',
  },
  {
    id: 'bank',
    icon: '/hero/kyc-bank.png?v=2',
    tag: 'Penny drop · IFSC',
    title: 'Bank verification',
    desc: 'Link your payout account with penny-drop verification — deposits and withdrawals stay in your name.',
    accent: 'rgba(56, 149, 237,0.2)',
  },
];

const TRUST = [
  {
    icon: Clock,
    title: 'Under 2 minutes',
    sub: 'Fully digital onboarding',
    iconBg: 'linear-gradient(145deg, rgba(254, 108, 2,0.22) 0%, rgba(254, 108, 2,0.08) 100%)',
    iconBorder: 'rgba(254, 108, 2,0.4)',
    iconColor: '#FE6C02',
    glow: 'rgba(254, 108, 2,0.35)',
  },
  {
    icon: Lock,
    title: 'Encrypted',
    sub: 'Secure document handling',
    iconBg: 'linear-gradient(145deg, rgba(0, 168, 118,0.28) 0%, rgba(0, 168, 118,0.08) 100%)',
    iconBorder: 'rgba(0, 168, 118,0.45)',
    iconColor: '#a8c73a',
    glow: 'rgba(0, 168, 118,0.35)',
  },
  {
    icon: Shield,
    title: 'CKYC-ready',
    sub: 'FIU-aligned compliance',
    iconBg: 'linear-gradient(145deg, rgba(180, 77, 1,0.22) 0%, rgba(254, 108, 2,0.1) 100%)',
    iconBorder: 'rgba(180, 77, 1,0.35)',
    iconColor: '#4d8aff',
    glow: 'rgba(180, 77, 1,0.3)',
  },
];

const stepVariants = {
  hidden: (reverse) => ({
    opacity: 0,
    x: reverse ? 48 : -48,
    y: 24,
  }),
  visible: {
    opacity: 1,
    x: 0,
    y: 0,
    transition: { duration: 0.65, ease: [0.16, 1, 0.3, 1] },
  },
};

const iconFloatTransition = { duration: 4.2, repeat: Infinity, ease: 'easeInOut' };

export default function LandingInstantKyc() {
  return (
    <section
      id="instant-kyc"
      className="relative border-y border-white/[0.06] overflow-hidden"
      style={{ background: 'linear-gradient(180deg, var(--ibo-bg) 0%, var(--ibo-surface) 50%, var(--ibo-bg) 100%)' }}
      data-testid="instant-kyc-section"
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_55%_35%_at_50%_0%,rgba(254, 108, 2,0.08),transparent_55%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_40%_30%_at_85%_20%,rgba(0, 168, 118,0.06),transparent_55%)]" />

      <div className="relative ibo-landing-container ibo-section-y">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
          className="max-w-2xl mx-auto mb-12 md:mb-16 text-center"
        >
          <p className="ibo-eyebrow mb-3 inline-flex items-center justify-center gap-2">
            <Zap size={14} className="text-gold-light" />
            Instant KYC
          </p>
          <h2 className="ibo-title-lg mb-4">
            Verify fast — <span className="text-gradient">start trading</span>
          </h2>
          <p className="ibo-lead text-zinc-400 max-w-none mx-auto">
            Complete digital KYC with Aadhaar, PAN, live face match, and bank linking — so you can deposit INR,
            unlock limits, and trade futures, options, and spot with confidence.
          </p>
        </motion.div>

        {/* Alternating split rows */}
        <div className="relative mb-14 md:mb-16">
          <div
            className="pointer-events-none absolute left-1/2 top-8 bottom-8 hidden lg:block w-px -translate-x-1/2"
            style={{
              background:
                'linear-gradient(180deg, transparent 0%, rgba(254, 108, 2,0.35) 20%, rgba(0, 168, 118,0.3) 50%, rgba(254, 108, 2,0.35) 80%, transparent 100%)',
            }}
            aria-hidden
          />

          <motion.div
            className="flex flex-col gap-10 md:gap-14 lg:gap-16"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: '-60px' }}
          >
            {STEPS.map((step, i) => {
              const reverse = i % 2 === 1;
              return (
                <motion.article
                  key={step.id}
                  custom={reverse}
                  variants={stepVariants}
                  transition={{ delay: i * 0.08 }}
                  whileHover={{ y: -4 }}
                  className="group relative grid lg:grid-cols-2 gap-6 lg:gap-10 items-center"
                >
                  {/* Icon stage — open visual panel, not a heavy card chrome */}
                  <div
                    className={`ibo-kyc-stage relative flex items-center justify-center min-h-[240px] sm:min-h-[300px] overflow-hidden rounded-2xl transition-[transform,box-shadow] duration-400 ${
                      reverse ? 'lg:order-2' : 'lg:order-1'
                    }`}
                  >
                    {/* Base wash — deep theme stage, no flat grey wash */}
                    <div
                      className="ibo-kyc-stage-bg absolute inset-0"
                      style={{
                        /* accent bloom only; base colors come from CSS theme rules */
                        ['--kyc-bloom']: step.accent,
                      }}
                      aria-hidden
                    />
                    {/* Soft frame ring */}
                    <div
                      className="ibo-kyc-stage-frame pointer-events-none absolute inset-[10px] sm:inset-[12px] rounded-xl"
                      aria-hidden
                    />
                    {/* Top sheen */}
                    <div
                      className="pointer-events-none absolute inset-x-8 top-[10px] sm:top-[12px] h-px"
                      style={{
                        background:
                          'linear-gradient(90deg, transparent, color-mix(in srgb, var(--ibo-accent) 45%, transparent), transparent)',
                      }}
                      aria-hidden
                    />
                    {/* Hover edge bloom */}
                    <div
                      className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500"
                      style={{
                        boxShadow: `inset 0 0 0 1px color-mix(in srgb, var(--ibo-accent) 28%, transparent)`,
                      }}
                      aria-hidden
                    />

                    {/* Oversized step watermark */}
                    <span
                      aria-hidden
                      className="pointer-events-none absolute -bottom-4 -right-1 select-none font-display font-bold leading-none tracking-tighter opacity-[0.07] group-hover:opacity-[0.11] transition-opacity duration-500"
                      style={{
                        fontSize: 'clamp(5.5rem, 14vw, 8.5rem)',
                        color: 'var(--ibo-accent)',
                      }}
                    >
                      {String(i + 1).padStart(2, '0')}
                    </span>

                    {/* Compact step chip */}
                    <span
                      className="absolute top-5 left-5 z-[2] font-display text-[10px] font-bold tracking-[0.22em] tabular-nums"
                      style={{ color: 'var(--ibo-accent)' }}
                    >
                      STEP {String(i + 1).padStart(2, '0')}
                    </span>

                    <motion.div
                      className="relative z-[1] flex items-center justify-center p-6 sm:p-8"
                      animate={{ y: [0, -10, 0] }}
                      transition={{ ...iconFloatTransition, delay: i * 0.35 }}
                    >
                      <span
                        aria-hidden
                        className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[42%] h-[38%] rounded-full blur-2xl opacity-50 group-hover:opacity-75 transition-opacity duration-500"
                        style={{
                          background: `radial-gradient(circle, ${step.accent} 0%, transparent 70%)`,
                        }}
                      />
                      <img
                        src={step.icon}
                        alt=""
                        width={560}
                        height={560}
                        className={`ibo-3d-icon ibo-3d-icon--soft relative z-[1] w-auto h-auto object-contain transition-transform duration-500 group-hover:scale-[1.04] ${
                          step.iconClass
                            || 'max-w-[min(100%,280px)] max-h-[220px] sm:max-h-[260px] lg:max-h-[280px]'
                        }`}
                        draggable={false}
                        loading="lazy"
                        decoding="async"
                      />
                    </motion.div>
                  </div>

                  {/* Copy panel */}
                  <motion.div
                    className={`px-1 sm:px-2 lg:px-6 ${
                      reverse ? 'lg:order-1 lg:text-right' : 'lg:order-2 lg:text-left'
                    }`}
                    initial={{ opacity: 0, x: reverse ? -20 : 20 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true, margin: '-40px' }}
                    transition={{ delay: 0.12 + i * 0.06, duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
                  >
                    <p
                      className={`inline-flex text-[10px] font-bold uppercase tracking-[0.16em] mb-3 ${
                        reverse ? 'lg:ml-auto' : ''
                      }`}
                      style={{ color: 'var(--ibo-accent)' }}
                    >
                      {step.tag}
                    </p>
                    <h3
                      className="font-display font-semibold text-2xl sm:text-[1.75rem] mb-3 tracking-tight"
                      style={{ color: 'var(--ibo-ink)' }}
                    >
                      {step.title}
                    </h3>
                    <p
                      className={`text-[14px] sm:text-[15px] leading-relaxed max-w-md ${
                        reverse ? 'lg:ml-auto' : ''
                      }`}
                      style={{ color: 'var(--ibo-ink-secondary)' }}
                    >
                      {step.desc}
                    </p>
                    <p
                      className={`mt-5 inline-flex items-center gap-1.5 text-xs font-semibold ${
                        reverse ? 'lg:flex-row-reverse' : ''
                      }`}
                      style={{ color: 'var(--ibo-accent)' }}
                    >
                      <CheckCircle size={14} className="text-[#00A876]" />
                      Instant · automated
                    </p>
                  </motion.div>
                </motion.article>
              );
            })}
          </motion.div>
        </div>

        <div className="grid md:grid-cols-3 gap-4 max-w-4xl mx-auto mb-10">
          {TRUST.map((item, i) => (
            <motion.div
              key={item.title}
              initial={{ opacity: 0, y: 14 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.08 + i * 0.06, duration: 0.45 }}
              whileHover={{ y: -3 }}
              className="group flex items-center gap-4 rounded-xl border px-4 py-4 transition-colors"
              style={{
                borderColor: 'var(--ibo-border-solid)',
                background: 'var(--ibo-card)',
                boxShadow: '0 8px 24px rgba(12,25,34,0.06)',
              }}
            >
              <div className="relative shrink-0">
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-[-20%] rounded-full blur-md opacity-50 transition-opacity duration-300 group-hover:opacity-90"
                  style={{ background: `radial-gradient(circle, ${item.glow} 0%, transparent 70%)` }}
                />
                <div
                  className="relative flex h-11 w-11 items-center justify-center rounded-full border transition-transform duration-300 group-hover:scale-105"
                  style={{
                    background: item.iconBg,
                    borderColor: item.iconBorder,
                    color: item.iconColor,
                    boxShadow: `inset 0 1px 0 rgba(255,255,255,0.12), 0 6px 16px ${item.glow}`,
                  }}
                >
                  <item.icon size={19} strokeWidth={2.25} />
                </div>
              </div>
              <div>
                <p className="font-display font-semibold text-sm" style={{ color: 'var(--ibo-ink)' }}>
                  {item.title}
                </p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--ibo-muted)' }}>
                  {item.sub}
                </p>
              </div>
            </motion.div>
          ))}
        </div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="flex flex-col items-center justify-center gap-3 text-center"
        >
          <Link
            to="/kyc"
            className="inline-flex items-center justify-center gap-2 rounded-full bg-logo-gradient px-8 py-3.5 text-[15px] font-semibold text-surface-dark shadow-[0_14px_36px_rgba(254, 108, 2,0.25)] hover:brightness-110 transition-[filter]"
          >
            Start instant KYC <ArrowRight size={16} />
          </Link>
          <p className="text-xs max-w-md leading-relaxed" style={{ color: 'var(--ibo-muted)' }}>
            Required before deposit, payout, and higher trading limits.
          </p>
        </motion.div>
      </div>
    </section>
  );
}
