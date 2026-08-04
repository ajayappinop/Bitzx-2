import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Gift, X } from 'lucide-react';

export default function SignupBonusKycModal({ visible, prompt, onDismiss }) {
  const navigate = useNavigate();

  if (!prompt?.show_prompt || typeof document === 'undefined') return null;

  const amountLabel =
    prompt.amount_ibo != null && Number(prompt.amount_ibo) > 0
      ? `${Number(prompt.amount_ibo)} Delta`
      : null;

  const title =
    prompt.title ||
    (amountLabel ? `${amountLabel} is waiting for you` : 'Your Delta signup bonus is waiting');

  const body =
    prompt.message ||
    'Complete identity verification (KYC) to receive it in your trading wallet.';

  return createPortal(
    <AnimatePresence>
      {visible && (
        <motion.div
          className="kyc-modal-scrim fixed inset-0 z-[11000] flex items-center justify-center p-4"
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
            className="kyc-modal relative w-full max-w-sm p-6"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-labelledby="signup-bonus-kyc-title"
            aria-modal="true"
          >
            <button
              type="button"
              onClick={onDismiss}
              className="absolute top-3 right-3 p-1.5 rounded-lg text-[color:var(--ibo-muted)] hover:text-[color:var(--ibo-ink)] hover:bg-white/5 transition-colors"
              aria-label="Dismiss"
            >
              <X size={16} />
            </button>

            <div className="kyc-panel-icon mx-auto mb-4 !w-14 !h-14">
              <Gift size={24} />
            </div>

            <h2
              id="signup-bonus-kyc-title"
              className="text-center text-lg font-bold text-[color:var(--ibo-ink)] leading-snug"
            >
              {title}
            </h2>

            <p className="mt-2 text-center text-sm leading-relaxed text-[color:var(--ibo-muted)]">
              {body}
            </p>

            <div className="mt-6 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => {
                  onDismiss();
                  navigate('/account/kyc');
                }}
                className="wallet-action-primary w-full !py-3"
              >
                Complete KYC
              </button>
              <button
                type="button"
                onClick={onDismiss}
                className="w-full py-2.5 text-sm font-semibold text-[color:var(--ibo-muted)] hover:text-[color:var(--ibo-ink)] transition-colors"
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
