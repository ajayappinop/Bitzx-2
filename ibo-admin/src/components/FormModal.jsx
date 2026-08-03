import { useEffect, useMemo, useState } from 'react';

export default function FormModal({
  open,
  title = 'Edit',
  subtitle = '',
  fields = [],
  confirmText = 'Save',
  cancelText = 'Cancel',
  danger = false,
  busy = false,
  onClose,
  onConfirm,
}) {
  const [values, setValues] = useState({});

  useEffect(() => {
    if (!open) return;
    const init = {};
    for (const f of fields) init[f.id] = f.value ?? '';
    setValues(init);
  }, [open, fields]);

  const canConfirm = useMemo(() => {
    if (busy) return false;
    for (const f of fields) {
      if (f.required && String(values[f.id] ?? '').trim() === '') return false;
    }
    return true;
  }, [busy, fields, values]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[130] bg-black/75 backdrop-blur-md flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-3xl border border-surface-border bg-surface-card p-6 shadow-2xl max-h-[90vh] overflow-y-auto relative"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="absolute -top-10 -left-10 w-36 h-36 rounded-full bg-violet-500/10 blur-3xl pointer-events-none" />
        <h3 className="text-xl sm:text-2xl font-black text-white">{title}</h3>
        {subtitle ? <p className="text-white/80 text-base mt-1 mb-5">{subtitle}</p> : <div className="mb-5" />}
        <div className="space-y-3">
          {fields.map((f) => (
            <label key={f.id} className="block text-sm text-white/85">
              <span className="block mb-1.5 font-semibold">{f.label}</span>
              {f.type === 'select' ? (
                <select
                  value={values[f.id] ?? ''}
                  onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.value }))}
                  className="w-full rounded-xl bg-surface-dark border border-surface-border px-3.5 py-3 text-base text-white"
                >
                  {(f.options || []).map((opt) => (
                    <option key={String(opt.value)} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              ) : f.type === 'textarea' ? (
                <textarea
                  value={values[f.id] ?? ''}
                  rows={f.rows || 3}
                  onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.value }))}
                  placeholder={f.placeholder || ''}
                  className="w-full rounded-xl bg-surface-dark border border-surface-border px-3.5 py-3 text-base text-white placeholder:text-white/35"
                />
              ) : (
                <input
                  type={f.type || 'text'}
                  value={values[f.id] ?? ''}
                  onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.value }))}
                  placeholder={f.placeholder || ''}
                  className="w-full rounded-xl bg-surface-dark border border-surface-border px-3.5 py-3 text-base text-white placeholder:text-white/35"
                />
              )}
            </label>
          ))}
        </div>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2.5 rounded-xl border border-surface-border text-white/90 text-sm font-bold disabled:opacity-40"
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={() => onConfirm(values)}
            disabled={!canConfirm}
            className={`px-4 py-2.5 rounded-xl text-sm font-bold disabled:opacity-40 ${
              danger ? 'bg-gradient-to-r from-red-500/25 to-rose-500/20 border border-red-500/45 text-red-200' : 'bg-gradient-to-r from-cyan-500/25 to-indigo-500/20 border border-cyan-400/45 text-cyan-100'
            }`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
