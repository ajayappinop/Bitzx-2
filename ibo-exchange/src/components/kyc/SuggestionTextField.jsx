import {
  useState,
  useRef,
  useEffect,
  useId,
  useLayoutEffect,
  useCallback,
} from 'react';
import { createPortal } from 'react-dom';

/**
 * Text input with typeahead suggestions (country / city).
 * Dropdown is portaled to `document.body` with fixed coords so parent `overflow-y-auto` does not clip it.
 */
export default function SuggestionTextField({
  label,
  required,
  error,
  value,
  onChange,
  placeholder,
  suggestions = [],
  disabled,
  autoComplete = 'off',
  onBlur: onBlurProp,
  /** Max rows in dropdown (scroll inside). */
  maxSuggestionsVisible = 40,
}) {
  const err = error?.trim();
  const [open, setOpen] = useState(false);
  const [hl, setHl] = useState(0);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const listId = useId();
  const [coords, setCoords] = useState({ top: 0, left: 0, width: 0 });

  const visibleSuggestions = suggestions.slice(0, maxSuggestionsVisible);
  const showList = open && visibleSuggestions.length > 0;

  const measure = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setCoords({
      top: r.bottom + 4,
      left: r.left,
      width: Math.max(r.width, 200),
    });
  }, []);

  useLayoutEffect(() => {
    if (!showList) return;
    measure();
    const onRe = () => measure();
    window.addEventListener('resize', onRe);
    window.addEventListener('scroll', onRe, true);
    return () => {
      window.removeEventListener('resize', onRe);
      window.removeEventListener('scroll', onRe, true);
    };
  }, [showList, measure, value, visibleSuggestions.length]);

  useEffect(() => {
    const onDoc = (e) => {
      const t = e.target;
      if (wrapRef.current?.contains(t)) return;
      if (listRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  useEffect(() => {
    setHl(0);
  }, [visibleSuggestions.length, value]);

  const pick = (s) => {
    onChange(s);
    setOpen(false);
  };

  const onKeyDown = (e) => {
    if (!showList) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHl((i) => Math.min(i + 1, visibleSuggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHl((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && visibleSuggestions[hl]) {
      e.preventDefault();
      pick(visibleSuggestions[hl]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const dropdown = showList
    ? createPortal(
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          className="fixed z-[10000] max-h-60 overflow-y-auto rounded-xl py-1 shadow-2xl"
          style={{
            top: coords.top,
            left: coords.left,
            width: coords.width,
            minWidth: 200,
            background: 'rgba(18,20,28,0.98)',
            border: '1px solid rgba(254, 108, 2,0.45)',
          }}
        >
          {visibleSuggestions.map((s, i) => (
            <li key={`${s}-${i}`} role="option" aria-selected={i === hl}>
              <button
                type="button"
                className={`w-full text-left px-4 py-2.5 text-sm font-medium transition-colors ${
                  i === hl ? 'bg-gold/20 text-gold-light' : 'text-white hover:bg-white/5'
                }`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(s)}
              >
                {s}
              </button>
            </li>
          ))}
        </ul>,
        document.body,
      )
    : null;

  return (
    <div ref={wrapRef} className="relative">
      <label className="block text-sm font-semibold text-white mb-2">
        {label} {required && <span className="text-red-400">*</span>}
      </label>
      <input
        ref={inputRef}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete={autoComplete}
        disabled={disabled}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          setOpen(true);
        }}
        onBlur={(e) => {
          onBlurProp?.(e);
        }}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className={`w-full rounded-xl px-4 py-3.5 text-white text-base outline-none
          focus:border-gold/50 transition-colors placeholder:text-white/45 ${err ? 'border-red-500/50' : ''}`}
        style={{
          background: 'rgba(255,255,255,0.05)',
          border: err ? '1px solid rgba(239,68,68,0.45)' : '1px solid rgba(255,255,255,0.09)',
        }}
      />
      {dropdown}
      {err && <p className="text-xs text-red-400 mt-1.5 font-semibold">{err}</p>}
    </div>
  );
}
