import { motion, useInView } from 'framer-motion';
import { useRef, useState, useEffect } from 'react';
import {
  ShieldCheck,
  ScanFace,
  Zap,
  CheckCircle2,
  Lock,
  Clock,
  Sparkles,
} from 'lucide-react';

const flowLabels = ['Start', 'Face match', 'Verified'];

const trustPoints = [
  { icon: Clock, label: 'Under 2 minutes', desc: 'Fully digital — no paperwork' },
  { icon: Lock, label: 'Encrypted end-to-end', desc: 'Data never stored on device' },
  { icon: ShieldCheck, label: 'CKYC-ready', desc: 'Built for global compliance' },
];

export const InstantKyc = () => {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: '-80px' });
  const [activeStep, setActiveStep] = useState(0);
  const [demoComplete, setDemoComplete] = useState(false);

  useEffect(() => {
    if (!isInView) return undefined;
    const interval = setInterval(() => {
      setActiveStep((prev) => {
        if (prev >= flowLabels.length - 1) {
          setDemoComplete(true);
          return prev;
        }
        return prev + 1;
      });
    }, 1400);
    return () => clearInterval(interval);
  }, [isInView]);

  useEffect(() => {
    if (!isInView) return;
    setActiveStep(0);
    setDemoComplete(false);
  }, [isInView]);

  return (
    <section
      id="instant-kyc"
      ref={ref}
      className="relative overflow-hidden bg-surface py-24 md:py-32"
      data-testid="instant-kyc-section"
    >
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute top-1/4 -left-32 h-[480px] w-[480px] rounded-full bg-[#0EA4AB]/8 blur-3xl" />
        <div className="absolute bottom-0 right-0 h-[360px] w-[520px] rounded-full bg-blue-500/5 blur-3xl" />
      </div>

      <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 md:px-10 xl:px-16">
        <motion.div
          initial={{ opacity: 0, y: 28 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="mb-12 text-center md:mb-14"
        >
          <span className="mb-5 inline-flex items-center gap-2 rounded-full border border-[#0EA4AB]/30 bg-[#0EA4AB]/10 px-4 py-2 text-sm font-medium text-ink-accent">
            <Zap size={16} />
            Instant KYC
          </span>
          <h2 className="mb-5 text-3xl font-bold leading-tight text-ink md:text-4xl lg:text-5xl">
            Verify in minutes —
            <span className="text-ink-accent"> not days</span>
          </h2>
          <p className="mx-auto max-w-2xl text-lg leading-relaxed text-ink-muted md:text-xl">
            IBO Exchange uses live face match with liveness checks so you can open an
            account and trade with confidence — no branch visit, no waiting days.
          </p>
        </motion.div>

        {/* Live demo progress */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="mx-auto mb-10 max-w-2xl md:mb-12"
        >
          <div className="rounded-2xl border border-line bg-surface-card/90 p-5 backdrop-blur-sm md:p-6">
            <div className="mb-5 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
                Live verification flow
              </p>
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                  demoComplete
                    ? 'border border-green-500/30 bg-green-500/15 text-green-400'
                    : 'border border-[#0EA4AB]/30 bg-[#0EA4AB]/15 text-ink-accent'
                }`}
              >
                {demoComplete ? 'KYC approved' : 'In progress…'}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              {flowLabels.map((label, i) => {
                const done = i < activeStep || demoComplete;
                const current = i === activeStep && !demoComplete;
                return (
                  <div key={label} className="flex min-w-0 flex-1 flex-col items-center">
                    <div
                      className={`flex h-10 w-10 items-center justify-center rounded-full border-2 transition-all duration-500 md:h-11 md:w-11 ${
                        done
                          ? 'border-green-500 bg-green-500/20 text-green-400'
                          : current
                            ? 'scale-110 border-[#C5E35B] bg-[#0EA4AB]/20 text-ink-accent'
                            : 'border-line bg-surface-soft text-[#4A4B50]'
                      }`}
                    >
                      {done ? (
                        <CheckCircle2 size={18} />
                      ) : (
                        <span className="text-xs font-bold">{i + 1}</span>
                      )}
                    </div>
                    <p
                      className={`mt-2 w-full truncate text-center text-[10px] font-medium md:text-xs ${
                        done || current ? 'text-ink' : 'text-ink-muted'
                      }`}
                    >
                      {label}
                    </p>
                  </div>
                );
              })}
            </div>
            <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-surface-soft">
              <motion.div
                className="h-full rounded-full bg-logo-gradient"
                initial={{ width: '0%' }}
                animate={{
                  width: demoComplete
                    ? '100%'
                    : `${Math.min(100, (activeStep / (flowLabels.length - 1)) * 100)}%`,
                }}
                transition={{ duration: 0.5 }}
              />
            </div>
          </div>
        </motion.div>

        {/* Featured face-match panel (Aadhaar / PAN / Bank cards removed) */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ delay: 0.2, duration: 0.55 }}
          className="mx-auto mb-12 max-w-4xl"
        >
          <div className="relative overflow-hidden rounded-3xl border border-[#0EA4AB]/35 bg-gradient-to-br from-[#0EA4AB]/20 via-surface-card/90 to-[#C5E35B]/10 p-6 sm:p-8 md:p-10">
            <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-[#0EA4AB]/15 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-20 -left-10 h-48 w-48 rounded-full bg-[#C5E35B]/10 blur-3xl" />

            <div className="relative grid items-center gap-8 md:grid-cols-[auto_1fr] md:gap-10">
              <div className="mx-auto flex h-24 w-24 shrink-0 items-center justify-center rounded-2xl border border-[#0EA4AB]/40 bg-surface/70 shadow-[0_0_40px_rgba(14,164,171,0.25)] md:mx-0 md:h-28 md:w-28">
                <ScanFace size={44} className="text-ink-accent" strokeWidth={1.75} />
              </div>

              <div className="text-center md:text-left">
                <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[#0EA4AB]/30 bg-[#0EA4AB]/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-ink-accent">
                  <Sparkles size={12} />
                  Core check
                </div>
                <h3 className="mb-2 text-2xl font-bold text-ink md:text-3xl">Live face match</h3>
                <p className="mb-5 max-w-xl text-base leading-relaxed text-ink-muted md:text-lg">
                  Real-time selfie with liveness and anti-spoof detection — confirming you are
                  present and who you say you are, in seconds.
                </p>
                <div className="inline-flex items-center gap-2 text-sm font-semibold text-green-400">
                  <CheckCircle2 size={16} />
                  Instant · automated · no paperwork
                </div>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Trust row */}
        <div className="mx-auto grid max-w-4xl gap-4 md:grid-cols-3">
          {trustPoints.map((item, i) => (
            <motion.div
              key={item.label}
              initial={{ opacity: 0, y: 12 }}
              animate={isInView ? { opacity: 1, y: 0 } : {}}
              transition={{ delay: 0.35 + i * 0.08 }}
              className="flex items-center gap-4 rounded-xl border border-line bg-surface-card/60 p-4"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#0EA4AB]/10">
                <item.icon size={20} className="text-ink-accent" />
              </div>
              <div>
                <p className="text-sm font-bold text-ink">{item.label}</p>
                <p className="text-xs text-ink-muted">{item.desc}</p>
              </div>
            </motion.div>
          ))}
        </div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={isInView ? { opacity: 1 } : {}}
          transition={{ delay: 0.55 }}
          className="mx-auto mt-10 max-w-2xl text-center text-xs text-ink-muted"
        >
          Showcase demonstrates the planned IBO verification journey. Final providers and
          timelines may vary by jurisdiction; KYC is required before deposit, withdrawal, and
          higher trading limits.
        </motion.p>
      </div>
    </section>
  );
};

export default InstantKyc;
