/**
 * Delta-style positions table — dense mono columns, sticky header, quick close.
 */
import { useState } from 'react';
import { useFutures } from '@/context/FuturesContext';
import { useToast, friendlyError } from '@/context/ToastContext';

function fmtPx(v, digits = 2) {
  const n = Number(v);
  if (!Number.isFinite(n) || n === 0) return '—';
  return n.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function fmtQty(v) {
  const n = Math.abs(Number(v) || 0);
  if (!n) return '0';
  return n >= 1 ? n.toFixed(4) : n.toFixed(6);
}

function PnlCell({ value, suffix = ' USD' }) {
  const v = Number(value || 0);
  const cls = v > 0 ? 'text-emerald-400' : v < 0 ? 'text-rose-400' : 'text-[color:var(--ibo-muted)]';
  return (
    <span className={`font-mono tabular-nums font-semibold ${cls}`}>
      {v > 0 ? '+' : ''}{v.toFixed(2)}{suffix}
    </span>
  );
}

function RoeCell({ upnl, margin }) {
  const m = Number(margin || 0);
  const u = Number(upnl || 0);
  if (!m) return <span className="text-[color:var(--ibo-muted)]">—</span>;
  const roe = (u / m) * 100;
  const cls = roe > 0 ? 'text-emerald-400' : roe < 0 ? 'text-rose-400' : 'text-[color:var(--ibo-muted)]';
  return (
    <span className={`font-mono tabular-nums ${cls}`}>
      {roe > 0 ? '+' : ''}{roe.toFixed(2)}%
    </span>
  );
}

function contractLabel(symbol) {
  const s = String(symbol || '');
  const base = s.replace(/USDT-PERP$/i, '').replace(/-PERP$/i, '');
  return `${base}USD`;
}

export default function FuturesPositions() {
  const { positions, closePosition, markets } = useFutures();
  const [busyId, setBusyId] = useState(null);
  const toast = useToast();

  const close = async (p, fraction) => {
    setBusyId(p.id);
    try {
      const qty = fraction ? Math.max(0, Math.abs(p.qty) * fraction) : null;
      await closePosition({ symbol: p.symbol, quantity: qty });
      toast.success(
        fraction ? 'Partial close executed' : 'Position closed',
        fraction
          ? `Closed ${Math.round(fraction * 100)}% of your ${p.symbol} ${p.side} position.`
          : `Your ${p.symbol} ${p.side} position has been fully closed.`,
      );
    } catch (e) {
      toast.error('Could not close position', friendlyError(e?.detail || e?.message));
    } finally {
      setBusyId(null);
    }
  };

  if (!positions.length) {
    return (
      <div className="flex h-full min-h-[12vh] items-center justify-center px-4 text-[13px] text-[color:var(--ibo-muted)]">
        No open positions
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 overflow-auto scrollbar-hide">
      <table className="w-full min-w-[980px] border-collapse text-[12px]">
        <thead className="sticky top-0 z-[1] bg-transparent">
          <tr className="text-[11px] text-[color:var(--ibo-muted)] border-b border-[color:var(--ibo-border)]">
            <th className="text-left font-medium px-3 py-2 whitespace-nowrap">Contract</th>
            <th className="text-right font-medium px-3 py-2 whitespace-nowrap">Size</th>
            <th className="text-right font-medium px-3 py-2 whitespace-nowrap">Entry Price</th>
            <th className="text-right font-medium px-3 py-2 whitespace-nowrap">Mark Price</th>
            <th className="text-right font-medium px-3 py-2 whitespace-nowrap">Liq. Price</th>
            <th className="text-right font-medium px-3 py-2 whitespace-nowrap">Margin</th>
            <th className="text-right font-medium px-3 py-2 whitespace-nowrap">Unrealized PnL / ROE</th>
            <th className="text-right font-medium px-3 py-2 whitespace-nowrap">Leverage</th>
            <th className="text-right font-medium px-3 py-2 pr-4 whitespace-nowrap">Actions</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((p) => {
            const mark = Number(markets[p.symbol]?.mark_price || p.mark_price || p.entry_price || 0);
            const upnl = Number(p.unrealized_pnl || 0);
            const qty = Math.abs(Number(p.qty) || 0);
            const isLong = p.side === 'long' || p.side === 'buy';
            const sideCls = isLong ? 'text-emerald-400' : 'text-rose-400';
            const isBusy = busyId === p.id;
            const mode = (p.margin_mode || 'isolated').toString();

            return (
              <tr
                key={p.id}
                className="border-b border-white/[0.04] hover:bg-white/[0.025] transition-colors"
              >
                <td className="px-3 py-2.5 whitespace-nowrap">
                  <div className="flex items-center gap-2">
                    <span className={`text-[11px] font-bold uppercase ${sideCls}`}>
                      {isLong ? 'Long' : 'Short'}
                    </span>
                    <span className="font-semibold text-[color:var(--ibo-ink)]">
                      {contractLabel(p.symbol)}
                    </span>
                    <span className="text-[10px] text-[color:var(--ibo-muted)] capitalize">
                      {mode}
                    </span>
                  </div>
                </td>
                <td className={`px-3 py-2.5 text-right font-mono tabular-nums font-semibold ${sideCls}`}>
                  {isLong ? '+' : '−'}{fmtQty(qty)}
                </td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums text-[color:var(--ibo-ink)]">
                  {fmtPx(p.entry_price)}
                </td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums text-[color:var(--ibo-ink)]">
                  {fmtPx(mark)}
                </td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums text-[color:var(--ibo-positive)]">
                  {fmtPx(p.liquidation_price)}
                </td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums text-[color:var(--ibo-ink)]">
                  {fmtPx(p.isolated_margin)}
                  <span className="text-[color:var(--ibo-muted)]"> USD</span>
                </td>
                <td className="px-3 py-2.5 text-right whitespace-nowrap">
                  <div className="flex flex-col items-end gap-0.5">
                    <PnlCell value={upnl} />
                    <RoeCell upnl={upnl} margin={p.isolated_margin} />
                  </div>
                </td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums text-[color:var(--ibo-ink)]">
                  {p.leverage || '—'}x
                </td>
                <td className="px-3 py-2.5 text-right pr-4 whitespace-nowrap">
                  <div className="inline-flex items-center gap-1.5">
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => close(p, 0.25)}
                      className="h-7 px-2 rounded text-[11px] font-semibold border border-[color:var(--ibo-border-solid)]
                        text-[color:var(--ibo-muted)] hover:text-[color:var(--ibo-ink)] hover:border-white/25 disabled:opacity-40"
                    >
                      25%
                    </button>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => close(p, 0.5)}
                      className="h-7 px-2 rounded text-[11px] font-semibold border border-[color:var(--ibo-border-solid)]
                        text-[color:var(--ibo-muted)] hover:text-[color:var(--ibo-ink)] hover:border-white/25 disabled:opacity-40"
                    >
                      50%
                    </button>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => close(p, null)}
                      className="h-7 px-2.5 rounded text-[11px] font-bold border border-rose-400/35
                        bg-rose-500/15 text-rose-300 hover:bg-rose-500/25 disabled:opacity-40"
                    >
                      {isBusy ? '…' : 'Close'}
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
