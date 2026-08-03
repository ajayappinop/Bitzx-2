import { useEffect, useState } from 'react';
import { X, ZoomIn } from 'lucide-react';

/**
 * Inline QR / payment image with tap-to-open lightbox (backdrop + X close).
 */
export default function QrEnlargeable({
  src,
  alt = 'QR code',
  size = 280,
  modalSize = 420,
  className = '',
  hint = 'Tap to enlarge',
  modalHint = 'Scan with your payment app',
  compact = false,
  /** No white pad/border — show uploaded payment QR as-is (INR UPI, etc.). */
  bare = false,
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!src) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`group inline-flex flex-col items-center ${compact ? 'gap-1' : 'gap-2'} rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/50 ${className}`}
        aria-label={`${alt} — open full size`}
      >
        <span
          className={
            bare
              ? 'relative block'
              : `relative block bg-white rounded-xl border border-surface-border shadow-sm ${compact ? 'p-2' : 'p-3'}`
          }
        >
          <img
            src={src}
            alt={alt}
            width={size}
            height={size}
            className={`block object-contain ${bare ? '' : 'rounded-lg'}`}
            style={{ width: size, height: size, maxWidth: compact ? size : 'min(100%, 320px)' }}
          />
          <span
            className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/0 group-hover:bg-black/40 transition-colors"
            aria-hidden
          >
            <ZoomIn
              size={32}
              className="text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-md"
            />
          </span>
        </span>
        {hint ? (
          <span className="text-[11px] font-bold text-white/45 group-hover:text-gold-light transition-colors">
            {hint}
          </span>
        ) : null}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
          aria-label={alt}
          onClick={() => setOpen(false)}
        >
          <div
            className="max-w-[min(96vw,520px)] w-full flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 mb-3 px-1">
              <p className="text-sm font-bold text-white truncate">{alt}</p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="shrink-0 p-2 rounded-lg border border-white/15 bg-black/60 text-white/80 hover:text-white hover:bg-black/80 transition-colors"
              >
                <X size={22} strokeWidth={2.5} />
              </button>
            </div>
            {bare ? (
              <img
                src={src}
                alt={alt}
                className="block w-full h-auto object-contain mx-auto"
                style={{ maxWidth: modalSize, maxHeight: modalSize }}
              />
            ) : (
              <div className="bg-white p-4 sm:p-5 rounded-2xl border border-surface-border shadow-2xl">
                <img
                  src={src}
                  alt={alt}
                  className="block w-full h-auto object-contain rounded-lg mx-auto"
                  style={{ maxWidth: modalSize, maxHeight: modalSize }}
                />
              </div>
            )}
            {modalHint ? (
              <p className="mt-3 text-xs text-white/50 text-center px-1">{modalHint}</p>
            ) : null}
          </div>
        </div>
      )}
    </>
  );
}
