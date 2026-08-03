import { useCallback, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Upload, Lock, ImageIcon, X, Loader2 } from 'lucide-react';
import { INR_CARD, INR_CARD_GLOW, INR_BTN_PRIMARY, INR_INPUT, INR_LABEL } from './styles';
import { formatAmountDisplay, methodSelectLabel, UTR_PATTERN } from './utils';
import { formatInrAmount } from '@/lib/inrDisplay';
import { AmountBelowMinPill } from './MinDepositHints';

export default function SubmitProofForm({
  methods,
  amountInr,
  onAmountChange,
  minDepositInr = 0,
  settingsReady = true,
  paymentMethodId,
  onPaymentMethodChange,
  utr,
  onUtrChange,
  note,
  onNoteChange,
  screenshot,
  preview,
  onFile,
  onClearFile,
  submitting,
  uploadProgress,
  onSubmit,
  utrError,
  setUtrError,
}) {
  const [dragOver, setDragOver] = useState(false);

  const handleAmountInput = (e) => {
    const v = e.target.value.replace(/[^\d.,]/g, '');
    onAmountChange(formatAmountDisplay(v));
  };

  const handleUtrBlur = () => {
    const t = utr.trim();
    if (!t) {
      setUtrError('');
      return;
    }
    if (!UTR_PATTERN.test(t)) {
      setUtrError('Enter a valid UTR (6–22 letters or numbers)');
    } else {
      setUtrError('');
    }
  };

  const validateAndDrop = useCallback(
    (file) => {
      if (!file) return;
      const synthetic = { target: { files: [file] } };
      onFile(synthetic);
    },
    [onFile],
  );

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    validateAndDrop(file);
  };

  return (
    <form
      id="inr-submit-form"
      onSubmit={onSubmit}
      className={`${INR_CARD} ${INR_CARD_GLOW} p-6 sm:p-8 lg:p-9 flex flex-col h-full`}
    >
      <div className="mb-6">
        <h2 className="text-lg sm:text-xl font-normal text-white">Submit deposit proof</h2>
        <p className="text-sm text-white/50 mt-1">
          Complete your transfer first, then upload proof for verification.
        </p>
      </div>

      <div className="space-y-5 flex-1">
        <div>
          <label className={INR_LABEL}>Amount *</label>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gold-light text-lg">₹</span>
            <input
              type="text"
              inputMode="decimal"
              value={amountInr}
              onChange={handleAmountInput}
              placeholder={minDepositInr > 0 ? formatInrAmount(minDepositInr) : '0.00'}
              className={`${INR_INPUT} pl-10 text-lg font-normal`}
              required
            />
          </div>
          <div className="mt-2 min-h-[28px]">
            <AmountBelowMinPill amountRaw={amountInr} minDepositInr={minDepositInr} />
          </div>
        </div>

        <div>
          <label className={INR_LABEL}>Payment method *</label>
          <select
            value={paymentMethodId}
            onChange={(e) => onPaymentMethodChange(e.target.value)}
            className={INR_INPUT}
            required
          >
            {methods.map((m) => (
              <option key={m.id} value={m.id} className="bg-surface-card">
                {methodSelectLabel(m, methods)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={INR_LABEL}>UTR / Transaction ID *</label>
          <input
            type="text"
            value={utr}
            onChange={(e) => {
              onUtrChange(e.target.value.toUpperCase().replace(/\s/g, ''));
              if (utrError) setUtrError('');
            }}
            onBlur={handleUtrBlur}
            placeholder="e.g. 123456789012"
            className={`${INR_INPUT} font-mono uppercase tracking-wide ${
              utrError ? 'border-red-500/50 focus:border-red-500/60' : ''
            }`}
            required
          />
          {utrError && <p className="mt-1.5 text-xs text-red-400">{utrError}</p>}
        </div>

        <div>
          <label className={INR_LABEL}>Upload screenshot *</label>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            className={`relative rounded-xl border-2 border-dashed transition-all duration-200 ${
              dragOver
                ? 'border-gold/60 bg-gold/8 scale-[1.01]'
                : 'border-surface-border bg-surface-dark/60 hover:border-gold/35'
            }`}
          >
            <label className="flex flex-col items-center justify-center gap-3 px-4 py-8 cursor-pointer">
              <motion.div
                animate={dragOver ? { scale: 1.1 } : { scale: 1 }}
                className="p-3 rounded-full bg-gold/10 text-gold-light"
              >
                <Upload size={28} />
              </motion.div>
              <div className="text-center">
                <p className="text-sm font-normal text-white">
                  {screenshot ? screenshot.name : 'Drag & drop or click to upload'}
                </p>
                <p className="text-xs text-white/45 mt-1">Accepted: PNG, JPG, WEBP (Max 5MB)</p>
              </div>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={onFile}
              />
            </label>
            {uploadProgress > 0 && uploadProgress < 100 && (
              <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/10 rounded-b-xl overflow-hidden">
                <motion.div
                  className="h-full bg-gold"
                  initial={{ width: 0 }}
                  animate={{ width: `${uploadProgress}%` }}
                />
              </div>
            )}
          </div>

          <AnimatePresence>
            {preview && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-4 relative rounded-xl overflow-hidden border border-white/[0.1]"
              >
                <img src={preview} alt="Screenshot preview" className="w-full max-h-52 object-contain bg-black/40" />
                <button
                  type="button"
                  onClick={onClearFile}
                  className="absolute top-2 right-2 p-2 rounded-lg bg-black/70 text-white hover:bg-black/90"
                  aria-label="Remove image"
                >
                  <X size={16} />
                </button>
                <div className="absolute bottom-2 left-2 flex items-center gap-1.5 px-2 py-1 rounded-md bg-black/60 text-xs text-white/80">
                  <ImageIcon size={12} /> Preview
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div>
          <label className={INR_LABEL}>Notes (optional)</label>
          <textarea
            value={note}
            onChange={(e) => onNoteChange(e.target.value)}
            rows={3}
            placeholder="Any extra details for the reviewer…"
            className={`${INR_INPUT} resize-none`}
          />
        </div>
      </div>

      <div className="mt-8 space-y-3 lg:sticky lg:bottom-0 lg:pt-4 lg:bg-gradient-to-t lg:from-surface-card lg:via-surface-card lg:to-transparent">
        <button type="submit" disabled={submitting || !settingsReady} className={INR_BTN_PRIMARY}>
          {submitting ? (
            <span className="inline-flex items-center justify-center gap-2">
              <Loader2 size={20} className="animate-spin" />
              Submitting…
            </span>
          ) : (
            'Submit Deposit Request'
          )}
        </button>
        <p className="flex items-center justify-center gap-2 text-xs text-white/45">
          <Lock size={14} className="text-gold-light/80" />
          Secure verification — your data is encrypted in transit
        </p>
      </div>
    </form>
  );
}
