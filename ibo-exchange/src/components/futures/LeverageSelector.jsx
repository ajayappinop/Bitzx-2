import { useEffect, useState, useRef } from 'react';
import { ChevronDown } from 'lucide-react';
import { useFutures } from '@/context/FuturesContext';

/** Compact Delta-style leverage dropdown (replaces bulky slider card). */
export default function LeverageSelector({ symbol, max, compact = false }) {
  const { settings, setLeverage, leverageOptions } = useFutures();
  const cur = settings[symbol]?.leverage ?? 10;
  const [value, setValue] = useState(cur);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    setValue(cur);
  }, [cur]);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const opts = (leverageOptions || []).filter((l) => !max || l <= max);

  const apply = async (v) => {
    setBusy(true);
    setErr(null);
    try {
      await setLeverage(symbol, v);
      setValue(v);
      setOpen(false);
    } catch (e) {
      setErr(e.message || 'failed');
    } finally {
      setBusy(false);
    }
  };

  if (compact) {
    return (
      <div className="relative" ref={ref}>
        <button
          type="button"
          disabled={busy}
          onClick={() => setOpen((o) => !o)}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-[color:var(--ibo-border-solid)]
            bg-[color:var(--ibo-card)] text-[12px] font-bold text-[#FE6C02] hover:border-[#FE6C02]/40"
        >
          {value}x
          <ChevronDown size={12} className={open ? 'rotate-180' : ''} />
        </button>
        {open ? (
          <div className="absolute right-0 top-full z-30 mt-1 w-28 max-h-48 overflow-y-auto rounded-lg border border-[color:var(--ibo-border-solid)] bg-[color:var(--ibo-card)] shadow-xl scrollbar-hide py-1">
            {opts.map((l) => (
              <button
                key={l}
                type="button"
                disabled={busy}
                onClick={() => apply(l)}
                className={`w-full px-3 py-1.5 text-left text-[12px] font-mono ${
                  value === l ? 'text-[#FE6C02] bg-[#FE6C02]/10' : 'text-[color:var(--ibo-ink)] hover:bg-white/5'
                }`}
              >
                {l}x
              </button>
            ))}
          </div>
        ) : null}
        {err ? <p className="text-[10px] text-rose-400 mt-1">{err}</p> : null}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[color:var(--ibo-border-solid)] bg-[color:var(--ibo-card)] p-3">
      <div className="flex items-center justify-between text-xs text-white/60">
        <span>Leverage</span>
        <span className="font-mono text-white">{value}x</span>
      </div>
      <input
        type="range"
        min={Math.min(...opts) || 1}
        max={Math.max(...opts) || 125}
        value={value}
        disabled={busy}
        onChange={(e) => setValue(Number(e.target.value))}
        onMouseUp={(e) => apply(Number(e.target.value))}
        onTouchEnd={(e) => apply(Number(e.target.value))}
        className="w-full mt-2 accent-gold"
      />
      <div className="flex flex-wrap gap-1 mt-2">
        {opts.map((l) => (
          <button
            key={l}
            type="button"
            disabled={busy}
            onClick={() => apply(l)}
            className={`px-2 py-1 rounded text-xs font-mono ${
              value === l
                ? 'bg-[rgba(254, 108, 2,0.2)] text-[#FE6C02] border border-[rgba(254, 108, 2,0.4)]'
                : 'bg-[color:var(--ibo-elevated)] text-[color:var(--ibo-muted)] hover:bg-[color:var(--ibo-hover)]'
            }`}
          >
            {l}x
          </button>
        ))}
      </div>
      {err && <div className="text-xs text-rose-400 mt-2">{err}</div>}
    </div>
  );
}
