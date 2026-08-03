/**
 * Premium P2P Modal — glass-dark panel with blue-tinted depth.
 * Body scroll is locked while open.
 */
import { useEffect } from 'react';
import { X } from 'lucide-react';

const SIZES = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-lg', xl: 'max-w-xl', '2xl': 'max-w-2xl' };

export default function P2PModal({ title, onClose, children, size = 'md' }) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  return (
    <div
      className="fixed inset-0 z-[200] overflow-y-auto"
      style={{ background: 'rgba(12,25,34,0.45)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <div className="flex min-h-full items-center justify-center p-4 sm:p-6">
        <div
          className={`relative w-full ${SIZES[size] ?? SIZES.md} flex flex-col rounded-2xl`}
          style={{
            background: 'linear-gradient(160deg, var(--ibo-card) 0%, var(--ibo-surface) 100%)',
            border: '1px solid rgba(14,164,171,0.18)',
            boxShadow: 'var(--ibo-shadow), 0 0 0 1px rgba(14,164,171,0.06), inset 0 1px 0 rgba(255,255,255,0.04)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Top blue shimmer strip */}
          <div className="absolute top-0 left-0 right-0 h-px rounded-t-2xl"
            style={{ background: 'linear-gradient(90deg,transparent,rgba(14,164,171,0.5) 50%,transparent)' }} />

          {/* Header */}
          <div
            className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 rounded-t-2xl"
            style={{ background: 'var(--ibo-card)', backdropFilter: 'blur(8px)', borderBottom: '1px solid rgba(14,164,171,0.1)' }}
          >
            <h3 className="font-bold text-[color:var(--ibo-ink)] text-[15px] tracking-tight font-ui">{title}</h3>
            <button type="button" onClick={onClose}
              className="flex items-center justify-center w-8 h-8 rounded-lg text-[color:var(--ibo-muted)] hover:text-[color:var(--ibo-ink)] transition-colors"
              style={{ background: 'var(--ibo-elevated)', border: '1px solid var(--ibo-border-solid)' }}>
              <X size={14} />
            </button>
          </div>

          {/* Scrollable content */}
          <div className="overflow-y-auto max-h-[70vh] overscroll-contain">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

P2PModal.Footer = function ModalFooter({ children }) {
  return (
    <div
      className="sticky bottom-0 z-10 flex justify-end gap-2.5 px-6 py-4 rounded-b-2xl"
      style={{ background: 'var(--ibo-card)', backdropFilter: 'blur(8px)', borderTop: '1px solid rgba(14,164,171,0.1)' }}
    >
      {children}
    </div>
  );
};

P2PModal.Body = function ModalBody({ children }) {
  return <div className="px-6 py-5 space-y-4">{children}</div>;
};

/* Reusable input/select/textarea styling strings for use inside modals */
export const modalInput =
  'w-full rounded-xl px-3.5 py-2.5 text-[color:var(--ibo-ink)] text-sm placeholder:text-[color:var(--ibo-muted)] ' +
  'focus:outline-none transition-all duration-200 ' +
  'bg-[color:var(--ibo-elevated)] border border-[color:var(--ibo-border-solid)] focus:border-[rgba(91,184,255,0.55)] focus:ring-2 focus:ring-[rgba(91,184,255,0.15)]';

export const modalSelect =
  'w-full rounded-xl px-3.5 py-2.5 text-[color:var(--ibo-ink)] text-sm ' +
  'focus:outline-none transition-all duration-200 ' +
  'bg-[color:var(--ibo-elevated)] border border-[color:var(--ibo-border-solid)] focus:border-[rgba(91,184,255,0.55)] focus:ring-2 focus:ring-[rgba(91,184,255,0.15)]';

export const modalLabel =
  'block text-[10px] font-bold uppercase tracking-widest text-[color:var(--ibo-muted)] mb-1.5';
