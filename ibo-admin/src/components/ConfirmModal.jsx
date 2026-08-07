import { useEffect, useState } from 'react';

export default function ConfirmModal({
  open,
  title = 'Confirm action',
  message = '',
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  danger = false,
  inputLabel = '',
  inputPlaceholder = '',
  inputType = 'text',
  initialValue = '',
  required = false,
  onClose,
  onConfirm,
  busy = false,
}) {
  const [value, setValue] = useState(initialValue || '');

  useEffect(() => {
    if (open) setValue(initialValue || '');
  }, [open, initialValue]);

  if (!open) return null;

  const canConfirm = !busy && (!required || value.trim().length > 0);

  return (
    <div
      className="fixed inset-0 z-[120] bg-black/75 backdrop-blur-md flex items-center justify-center p-4 sm:p-5 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[min(90dvh,calc(100vh-2rem))] overflow-y-auto overscroll-contain rounded-3xl border border-surface-border bg-surface-card p-5 sm:p-6 shadow-2xl relative"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="absolute -top-10 -right-10 w-36 h-36 rounded-full bg-[#FE6C02]/10 blur-3xl pointer-events-none" />
        <h3 className="text-xl sm:text-2xl font-black text-white mb-2 pr-6">{title}</h3>
        {message ? <p className="text-white/85 text-base mb-5 break-words">{message}</p> : null}

        {inputLabel ? (
          <div className="mb-5">
            <label className="block text-sm font-bold text-white/85 mb-1.5">{inputLabel}</label>
            <input
              type={inputType}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={inputPlaceholder}
              className="w-full rounded-xl bg-surface-dark border border-surface-border px-3.5 py-3 text-white text-base"
            />
          </div>
        ) : null}

        <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2 sm:gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="adm-btn-secondary w-full sm:w-auto"
          >
            {cancelText}
          </button>
          <button
            type="button"
            disabled={!canConfirm}
            onClick={() => onConfirm(value)}
            className={danger
              ? 'w-full sm:w-auto px-4 py-3 rounded-lg text-sm font-bold disabled:opacity-40 bg-gradient-to-r from-red-500/25 to-rose-500/20 border border-red-500/45 text-red-200'
              : 'adm-btn-primary w-full sm:w-auto'}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
