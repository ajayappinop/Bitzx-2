import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Copy, Check } from 'lucide-react';
import { useToast } from '@/context/ToastContext';

export default function CopyField({ label, value, mono = true, copyable = true }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);

  if (!value) return null;

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(String(value));
      setCopied(true);
      toast.success('Copied', `${label} copied to clipboard`);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Copy failed', 'Could not copy to clipboard');
    }
  };

  return (
    <div className="flex items-center justify-between gap-3 py-3 border-b border-surface-border/60 last:border-0">
      <span className="text-sm text-white/50 shrink-0">{label}</span>
      <div className="flex items-center gap-2 min-w-0">
        <span
          className={`text-sm font-normal text-white truncate ${mono ? 'font-mono' : ''}`}
          title={String(value)}
        >
          {value}
        </span>
        {copyable && (
          <button
            type="button"
            onClick={onCopy}
            className="shrink-0 p-2 rounded-lg border border-surface-border bg-surface-dark text-gold-light hover:bg-gold/10 hover:border-gold/30 transition-colors"
            aria-label={`Copy ${label}`}
          >
            <AnimatePresence mode="wait" initial={false}>
              {copied ? (
                <motion.span key="ok" initial={{ scale: 0.6 }} animate={{ scale: 1 }} exit={{ scale: 0.6 }}>
                  <Check size={16} className="text-emerald-400" />
                </motion.span>
              ) : (
                <motion.span key="cp" initial={{ scale: 0.6 }} animate={{ scale: 1 }} exit={{ scale: 0.6 }}>
                  <Copy size={16} />
                </motion.span>
              )}
            </AnimatePresence>
          </button>
        )}
      </div>
    </div>
  );
}
