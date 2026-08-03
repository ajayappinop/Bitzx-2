import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Gift } from 'lucide-react';

export default function SignupBonusKycModal({ visible, prompt, onDismiss }) {
  const navigate = useNavigate();

  if (!prompt?.show_prompt || typeof document === 'undefined') return null;

  const amountLabel =
    prompt.amount_ibo != null && Number(prompt.amount_ibo) > 0
      ? `${Number(prompt.amount_ibo)} IBO`
      : null;
  const title =
    prompt.title
    || (amountLabel ? `${amountLabel} is waiting for you` : 'Your IBO signup bonus is waiting');
  const body =
    prompt.message
    || 'Complete identity verification (KYC) to receive it in your trading wallet.';

  return createPortal(
    <AnimatePresence>
      {visible && (
        <motion.div
          className="fixed inset-0 z-[11000] bg-black/72 backdrop-blur-sm flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onDismiss}
          role="presentation"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 10 }}
            transition={{ duration: 0.18 }}
            className="w-full max-w-sm rounded-2xl border border-[rgba(91,184,255,0.35)] bg-surface-card shadow-2xl p-6"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-labelledby="signup-bonus-kyc-title"
            aria-modal="true"
          >
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[rgba(91,184,255,0.15)]">
              <Gift size={28} className="text-[#5BB8FF]" />
            </div>
            <h2
              id="signup-bonus-kyc-title"
              className="text-center text-lg font-bold text-white"
            >
              {title}
            </h2>
            <p className="mt-2 text-center text-sm leading-relaxed text-white/65">
              {body}
            </p>
            <div className="mt-6 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => {
                  onDismiss();
                  navigate('/kyc');
                }}
                className="w-full rounded-xl bg-gradient-to-r from-[#0EA4AB] to-[#5BB8FF] py-3 text-sm font-bold text-surface-dark hover:bg-[rgba(91,184,255,0.9)] transition-colors"
              >
                Complete KYC
              </button>
              <button
                type="button"
                onClick={onDismiss}
                className="w-full rounded-xl py-2.5 text-sm font-semibold text-white/55 hover:text-white/80 transition-colors"
              >
                Later
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
