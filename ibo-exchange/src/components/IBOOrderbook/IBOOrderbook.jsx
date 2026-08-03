import { memo, useEffect, useRef } from 'react';

function fmtPrice(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n === 0) return '—';
  if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (n >= 1)    return n.toFixed(4);
  return n.toFixed(8);
}

function fmtQty(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(2) + 'K';
  return n.toFixed(2);
}

/**
 * Normalise one orderbook row.
 * Server sends  [price_string, qty_string]  (array format).
 * Guard against future object format: { price, qty }.
 */
function toRow(r) {
  if (Array.isArray(r)) return { price: r[0], qty: r[1] };
  return { price: r?.price ?? r?.p ?? 0, qty: r?.qty ?? r?.q ?? 0 };
}

function withCum(rawLevels) {
  let running = 0;
  return (rawLevels || []).map((r) => {
    const row = toRow(r);
    running += Math.abs(Number(row.qty) || 0);
    return { price: row.price, qty: row.qty, cum: running };
  });
}

// Single depth row — memoised to avoid re-rendering untouched levels.
const DepthRow = memo(function DepthRow({ price, qty, cum, maxCum, side }) {
  const pct = maxCum > 0 ? Math.min(100, (cum / maxCum) * 100) : 0;
  const isBid = side === 'bid';
  return (
    <div className="relative px-3 py-[5px] text-xs font-mono select-none cursor-pointer hover:bg-white/[.05]">
      <div
        className={`absolute inset-y-0 ${isBid ? 'left-0' : 'right-0'} transition-[width] duration-300 ${isBid ? 'bg-green-500/[.12]' : 'bg-red-500/[.12]'}`}
        style={{ width: `${pct}%` }}
      />
      <div className="relative flex justify-between gap-2">
        <span className={isBid ? 'text-green-400' : 'text-red-400'}>{fmtPrice(price)}</span>
        <span className="text-white/80">{fmtQty(qty)}</span>
      </div>
    </div>
  );
});

export default function IBOOrderbook({ orderbook }) {
  const DEPTH = 14;
  const bids = withCum((orderbook?.bids || []).slice(0, DEPTH));
  const asks = withCum((orderbook?.asks || []).slice(0, DEPTH));

  const maxCum = Math.max(1, bids[bids.length - 1]?.cum ?? 0, asks[asks.length - 1]?.cum ?? 0);

  const bestBid = Number(bids[0]?.price ?? 0);
  const bestAsk = Number(asks[0]?.price ?? 0);
  const spread   = bestAsk > 0 && bestBid > 0 ? bestAsk - bestBid : 0;
  const spreadPct = bestBid > 0 ? (spread / bestBid) * 100 : 0;

  // Flash header price when best bid changes.
  const prevBidRef = useRef(bestBid);
  const bidFlashRef = useRef(null);
  useEffect(() => {
    if (!bidFlashRef.current) return;
    if (prevBidRef.current !== bestBid && bestBid > 0) {
      bidFlashRef.current.classList.remove('animate-ping-once');
      void bidFlashRef.current.offsetWidth; // reflow
      bidFlashRef.current.classList.add('animate-ping-once');
    }
    prevBidRef.current = bestBid;
  });

  return (
    <div className="flex flex-col h-full bg-[#0d0f14]">
      {/* Header */}
      <div className="px-4 py-2.5 border-b border-white/10 shrink-0 flex items-center justify-between">
        <span className="text-white font-bold text-sm">Order Book</span>
        {bestBid > 0 && (
          <span ref={bidFlashRef} className="font-mono text-xs text-green-400 font-bold">
            {fmtPrice(bestBid)}
          </span>
        )}
      </div>

      {/* Column labels */}
      <div className="grid grid-cols-2 border-b border-white/10 shrink-0">
        <div className="px-3 py-1.5 text-[10px] uppercase tracking-widest text-green-400 font-bold">Bids</div>
        <div className="px-3 py-1.5 text-[10px] uppercase tracking-widest text-red-400 font-bold text-right">Asks</div>
      </div>

      {/* Empty state */}
      {bids.length === 0 && asks.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-xs text-white/40 font-semibold tracking-wider uppercase">
          Waiting for data…
        </div>
      ) : (
        <div className="grid grid-cols-2 flex-1 min-h-0 overflow-hidden">
          {/* Bids */}
          <div className="border-r border-white/[.06] overflow-y-auto scrollbar-hide">
            {bids.map((r, i) => (
              <DepthRow
                key={`b-${i}`}
                price={r.price}
                qty={r.qty}
                cum={r.cum}
                maxCum={maxCum}
                side="bid"
              />
            ))}
          </div>
          {/* Asks */}
          <div className="overflow-y-auto scrollbar-hide">
            {asks.map((r, i) => (
              <DepthRow
                key={`a-${i}`}
                price={r.price}
                qty={r.qty}
                cum={r.cum}
                maxCum={maxCum}
                side="ask"
              />
            ))}
          </div>
        </div>
      )}

      {/* Spread footer */}
      <div className="px-4 py-2 border-t border-white/10 text-[11px] text-white/55 font-mono flex justify-between shrink-0">
        <span>Spread</span>
        <span>{spread > 0 ? `${fmtPrice(spread)} (${spreadPct.toFixed(3)}%)` : '—'}</span>
      </div>
    </div>
  );
}
