import { useEffect, useState, useMemo, useCallback } from 'react';
import { useFutures } from '@/context/FuturesContext';

/**
 * Full-width Delta-style leverage range for the futures trade ticket.
 * Snaps to discrete leverage options (1×, 5×, 10× …).
 */
export default function LeverageSelector({ symbol, max }) {
  const { settings, setLeverage, leverageOptions } = useFutures();
  const cur = settings[symbol]?.leverage ?? 10;
  const [value, setValue] = useState(cur);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const opts = useMemo(() => {
    const list = (leverageOptions || [1, 5, 10, 20, 50, 100]).filter((l) => !max || l <= max);
    return list.length ? list : [1];
  }, [leverageOptions, max]);

  useEffect(() => {
    setValue(cur);
  }, [cur]);

  // Keep local value on an allowed option when the option list changes.
  useEffect(() => {
    setValue((v) => {
      if (opts.includes(v)) return v;
      return opts.reduce((best, n) =>
        Math.abs(n - v) < Math.abs(best - v) ? n : best
      , opts[0]);
    });
  }, [opts]);

  const idx = Math.max(0, opts.indexOf(value));
  const pct = opts.length <= 1 ? 0 : (idx / (opts.length - 1)) * 100;

  const apply = useCallback(async (v) => {
    if (busy) return;
    if (v === cur) return;
    setBusy(true);
    setErr(null);
    try {
      await setLeverage(symbol, v);
      setValue(v);
    } catch (e) {
      setErr(e.message || 'failed');
      setValue(cur);
    } finally {
      setBusy(false);
    }
  }, [busy, cur, setLeverage, symbol]);

  const onSlide = (e) => {
    const next = opts[Number(e.target.value)] ?? opts[0];
    setValue(next);
  };

  const commit = () => {
    apply(value);
  };

  return (
    <div className="w-full px-3 pb-2.5 pt-0.5">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="text-[11px] font-semibold text-[color:var(--ibo-muted)]">
          Leverage
        </span>
        <span className="text-[13px] font-extrabold tabular-nums text-[#FE6C02]">
          {value}×
        </span>
      </div>

      <div className="relative pt-0.5 pb-1">
        <input
          type="range"
          min={0}
          max={Math.max(0, opts.length - 1)}
          step={1}
          value={idx}
          disabled={busy || opts.length <= 1}
          aria-label={`Leverage ${value}x`}
          aria-valuemin={opts[0]}
          aria-valuemax={opts[opts.length - 1]}
          aria-valuenow={value}
          onChange={onSlide}
          onMouseUp={commit}
          onTouchEnd={commit}
          onKeyUp={(e) => {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') {
              commit();
            }
          }}
          className="delta-lev-range w-full"
          style={{ '--lev-pct': `${pct}%` }}
        />

        {/* Tick marks under the track */}
        <div className="pointer-events-none absolute left-0 right-0 top-[7px] flex justify-between px-[1px]">
          {opts.map((l) => (
            <span
              key={l}
              className={`block h-1.5 w-px ${
                l <= value ? 'bg-[#FE6C02]/70' : 'bg-[color:var(--ibo-border-solid)]'
              }`}
            />
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between mt-0.5">
        <span className="text-[10px] font-semibold tabular-nums text-[color:var(--ibo-muted)]">
          {opts[0]}×
        </span>
        <span className="text-[10px] font-semibold tabular-nums text-[color:var(--ibo-muted)]">
          {opts[opts.length - 1]}×
        </span>
      </div>

      {err ? <p className="text-[10px] text-rose-400 mt-1">{err}</p> : null}
    </div>
  );
}
