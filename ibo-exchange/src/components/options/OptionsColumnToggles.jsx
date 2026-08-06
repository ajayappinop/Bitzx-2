import { useEffect, useRef, useState } from 'react';
import { CHAIN_COL_TOGGLES, DEFAULT_CHAIN_COLS, resolveChainCols } from './optionsChainColumns';

function GripIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden className="opacity-40 shrink-0">
      <circle cx="3.5" cy="2.5" r="1" />
      <circle cx="8.5" cy="2.5" r="1" />
      <circle cx="3.5" cy="6" r="1" />
      <circle cx="8.5" cy="6" r="1" />
      <circle cx="3.5" cy="9.5" r="1" />
      <circle cx="8.5" cy="9.5" r="1" />
    </svg>
  );
}

function CheckBox({ checked }) {
  return (
    <span
      className={`inline-flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-[3px] border transition-colors ${
        checked
          ? 'border-[#fe6c02] bg-[#fe6c02] text-white'
          : 'border-[color:var(--ibo-border-solid,#cdd5dc)] bg-white'
      }`}
      aria-hidden
    >
      {checked ? (
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
          <path d="M2.5 6.2L5 8.7L9.5 3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : null}
    </span>
  );
}

/**
 * Delta-style column visibility picker (checkboxes for each chain column).
 */
export default function OptionsColumnToggles({ cols, onChange, variant = 'default' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const resolved = resolveChainCols(cols);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const active = CHAIN_COL_TOGGLES.filter((t) => resolved[t.id]).length;
  const left = CHAIN_COL_TOGGLES.filter((t) => t.col === 0);
  const right = CHAIN_COL_TOGGLES.filter((t) => t.col === 1);

  const toggle = (id) => {
    const on = Boolean(resolved[id]);
    /* Keep mark+bidAsk so chain never goes blank */
    if (on && (id === 'mark' || id === 'bidAsk')) {
      const othersOn = CHAIN_COL_TOGGLES.some((t) => t.id !== id && resolved[t.id]);
      if (!othersOn) return;
    }
    onChange?.(resolveChainCols({ ...resolved, [id]: !on }));
  };

  const renderRow = (t) => {
    const on = Boolean(resolved[t.id]);
    return (
      <button
        key={t.id}
        type="button"
        onClick={() => toggle(t.id)}
        className={`flex w-full items-center gap-2 rounded-md py-1.5 text-left text-[12px] font-medium transition-colors hover:bg-[color:var(--ibo-hover,#f3f4f6)] ${
          t.indent ? 'pl-6 pr-2' : 'px-2'
        }`}
        style={{ color: 'var(--ibo-ink, #1a2330)' }}
        role="menuitemcheckbox"
        aria-checked={on}
      >
        <CheckBox checked={on} />
        <GripIcon />
        <span className="min-w-0 truncate">{t.label}</span>
      </button>
    );
  };

  return (
    <div className="relative" ref={ref}>
      {variant === 'icon' ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={`doh__icon-btn ${open ? 'is-on' : ''}`}
          aria-label={`Columns ${active} of ${CHAIN_COL_TOGGLES.length}`}
          title={`Columns ${active}/${CHAIN_COL_TOGGLES.length}`}
          aria-expanded={open}
          aria-haspopup="menu"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M4 6h16M4 12h10M4 18h13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <circle cx="18" cy="12" r="2" fill="currentColor" />
            <circle cx="19" cy="18" r="2" fill="currentColor" />
          </svg>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-md border border-[color:var(--ibo-border-solid)] px-2.5 py-1.5 text-[11px] font-bold hover:bg-[color:var(--ibo-hover)]"
          style={{ color: open ? '#fe6c02' : 'var(--ibo-ink-secondary)' }}
          aria-expanded={open}
          aria-haspopup="menu"
        >
          Columns
          <span className="tabular-nums opacity-70">{active}/{CHAIN_COL_TOGGLES.length}</span>
        </button>
      )}
      {open ? (
        <div
          className="absolute right-0 top-[calc(100%+6px)] z-[300] w-[min(360px,calc(100vw-24px))] rounded-lg border border-[color:var(--ibo-border-solid,#e5e7eb)] p-2 shadow-xl"
          style={{ background: 'var(--ibo-bg, #fff)' }}
          role="menu"
          aria-label="Visible columns"
        >
          <div className="flex items-center justify-between gap-2 px-1 pb-2 border-b border-[color:var(--ibo-border,#eef0f2)] mb-1">
            <span className="text-[10px] font-extrabold uppercase tracking-wider" style={{ color: 'var(--ibo-muted)' }}>
              Columns
            </span>
            <button
              type="button"
              className="text-[10px] font-bold text-[#fe6c02]"
              onClick={() => onChange?.(resolveChainCols({ ...DEFAULT_CHAIN_COLS }))}
            >
              Show all
            </button>
          </div>
          <div className="grid grid-cols-2 gap-x-1 max-h-[min(70vh,420px)] overflow-y-auto">
            <div className="flex flex-col min-w-0">{left.map(renderRow)}</div>
            <div className="flex flex-col min-w-0">{right.map(renderRow)}</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
