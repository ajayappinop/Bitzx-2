import {
  expandCallCells,
  expandPutCells,
  CELL_HEADERS,
  resolveChainCols,
  chainMinWidthPx,
} from './optionsChainColumns';

function fmtNum(v, d = 4) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1000) {
    return n.toLocaleString(undefined, { maximumFractionDigits: Math.min(d, 2), minimumFractionDigits: 0 });
  }
  return n.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: 0 });
}

function fmtMarketPx(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  const n = Number(v);
  if (n >= 100) return n.toFixed(1);
  if (n >= 10) return n.toFixed(1);
  if (n >= 1) return n.toFixed(2);
  return n.toFixed(4);
}

function fmtOi(oi) {
  const o = Number(oi);
  if (!Number.isFinite(o)) return '—';
  if (o >= 1e6) return `${(o / 1e6).toFixed(2)}M`;
  if (o >= 1e3) return `${(o / 1e3).toFixed(2)}K`;
  if (o >= 1) return o.toFixed(2);
  return o.toFixed(3);
}

function fmtGreek(v, d = 4) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  const n = Number(v);
  const abs = Math.abs(n);
  if (abs >= 10) return n.toFixed(2);
  if (abs >= 1) return n.toFixed(3);
  return n.toFixed(d);
}

function positionQtyLabel(contractId, positions) {
  const rows = (positions || []).filter((p) => p.contract_id === contractId);
  if (!rows.length) return '—';
  const q = rows.reduce((s, p) => s + Number(p.qty || 0), 0);
  if (!Number.isFinite(q) || Math.abs(q) < 1e-12) return '—';
  return fmtNum(q, 4);
}

function ivPct(ivRaw) {
  if (ivRaw == null || !Number.isFinite(Number(ivRaw))) return '—';
  const n = Number(ivRaw);
  return `${(n <= 2 ? n * 100 : n).toFixed(1)}%`;
}

/**
 * One real <td> per column (no colspan grid) so every Delta header is visible with H-scroll.
 */
export default function OptionsChainArm({
  contract,
  side,
  selectedId,
  referencePrice,
  positions,
  onPick,
  cols,
  maxOi = 1,
  rowSelected = false,
}) {
  const cells = side === 'call' ? expandCallCells(cols) : expandPutCells(cols);

  if (!contract) {
    return cells.map((key) => (
      <td key={`${side}-empty-${key}`} className="doc-td doc-td--empty">—</td>
    ));
  }

  const isSel = rowSelected || selectedId === contract.id;
  const strike = Number(contract.strike);
  const refOk = referencePrice != null && Number.isFinite(referencePrice) && Number.isFinite(strike);
  const itm = refOk && (side === 'call' ? referencePrice > strike : referencePrice < strike);

  const m = contract.market || {};
  /** bid hits sell; every other cell selects buy / mark trade side */
  const sideForKey = (key) => (key === 'bid' ? 'sell' : 'buy');
  const pickCell = (key) => { onPick?.(contract.id, sideForKey(key)); };
  const pickBuy = (e) => { e.stopPropagation(); onPick?.(contract.id, 'buy'); };
  const pickSell = (e) => { e.stopPropagation(); onPick?.(contract.id, 'sell'); };

  const bestBid = m.best_bid ?? contract.bid ?? null;
  const bestAsk = m.best_ask ?? contract.ask ?? null;
  const markPx = m.mid ?? m.mark_price ?? contract.mark_price ?? contract.last_price ?? null;
  const lastPx = m.last_price ?? contract.last_price ?? markPx;
  const bidQty = m.bid_qty ?? contract.bid_qty ?? null;
  const askQty = m.ask_qty ?? contract.ask_qty ?? null;
  const oiRaw = m.open_interest ?? contract.open_interest ?? null;
  const volRaw = m.volume_24h ?? contract.volume_24h ?? null;
  const ivRaw = m.iv ?? contract.iv ?? null;
  const deltaRaw = m.delta ?? contract.delta ?? null;
  const gamma = m.gamma ?? contract.gamma ?? null;
  const theta = m.theta ?? contract.theta ?? null;
  const vega = m.vega ?? contract.vega ?? null;
  const chg = m.change_24h_pct ?? contract.change_24h_pct ?? null;
  const openPx = m.open_24h ?? m.open ?? m.open_price ?? null;
  const highPx = m.high_24h ?? m.high ?? null;
  const lowPx = m.low_24h ?? m.low ?? null;
  const oiChg = m.oi_change_6h ?? m.oi_change ?? (
    oiRaw != null && chg != null ? Number(oiRaw) * (Number(chg) / 200) : null
  );
  const ivStr = ivPct(ivRaw);
  const deltaVal = deltaRaw != null && Number.isFinite(Number(deltaRaw))
    ? Number(deltaRaw).toFixed(2)
    : '—';
  const hasDelta = deltaRaw != null && Number.isFinite(Number(deltaRaw));
  const posLabel = positionQtyLabel(contract.id, positions);
  const hasPos = posLabel !== '—';
  const oiPct = Math.min(100, maxOi > 0 && oiRaw != null ? (Number(oiRaw) / maxOi) * 100 : 0);

  const tdClass = [
    'doc-td',
    'doc-td--pick',
    isSel ? 'doc-td--sel' : '',
    itm ? (side === 'call' ? 'doc-td--itm-call' : 'doc-td--itm-put') : '',
  ].filter(Boolean).join(' ');

  const cellContent = (key) => {
    switch (key) {
      case 'oi':
        return (
          <>
            {oiPct > 0 ? (
              <span
                className={`doc-cell__heat ${side === 'call' ? 'doc-cell__heat--call' : 'doc-cell__heat--put'}`}
                style={{ width: `${Math.max(oiPct, 4)}%` }}
                aria-hidden
              />
            ) : null}
            <span className="doc-num is-oi">{fmtOi(oiRaw)}</span>
          </>
        );
      case 'bidQty':
        return <span className="doc-num is-qty">{bidQty != null ? fmtNum(bidQty, 3) : '—'}</span>;
      case 'bid':
        return (
          <button type="button" className="doc-cell-btn" onClick={pickSell} title="Sell (hit bid)">
            <span className={`doc-num is-px ${bestBid != null ? 'is-bid' : 'is-muted'}`}>{fmtMarketPx(bestBid)}</span>
            <span className="doc-iv">{ivStr}</span>
          </button>
        );
      case 'mark':
        return (
          <button type="button" className="doc-cell-btn" onClick={pickBuy} title="Trade at mark">
            <span className={`doc-num is-px ${markPx != null ? 'is-mark' : 'is-muted'}`}>{fmtMarketPx(markPx)}</span>
            <span className="doc-iv">{ivStr}</span>
          </button>
        );
      case 'ask':
        return (
          <button type="button" className="doc-cell-btn" onClick={pickBuy} title="Buy (lift ask)">
            <span className={`doc-num is-px ${bestAsk != null ? 'is-ask' : 'is-muted'}`}>{fmtMarketPx(bestAsk)}</span>
            <span className="doc-iv">{ivStr}</span>
          </button>
        );
      case 'askQty':
        return <span className="doc-num is-qty">{askQty != null ? fmtNum(askQty, 3) : '—'}</span>;
      case 'delta':
        return <span className={`doc-num ${hasDelta ? '' : 'is-muted'}`}>{deltaVal}</span>;
      case 'volume':
        return <span className="doc-num">{volRaw != null ? fmtOi(volRaw) : '—'}</span>;
      case 'oiChg6h': {
        const up = Number(oiChg) >= 0;
        return (
          <span className={`doc-num ${oiChg == null ? 'is-muted' : up ? 'is-bid' : 'is-ask'}`}>
            {oiChg != null && Number.isFinite(Number(oiChg)) ? `${up ? '+' : ''}${fmtNum(oiChg, 1)}` : '—'}
          </span>
        );
      }
      case 'gamma':
        return <span className="doc-num is-muted">{fmtGreek(gamma, 5)}</span>;
      case 'vega':
        return <span className="doc-num is-muted">{fmtGreek(vega, 3)}</span>;
      case 'theta':
        return <span className={`doc-num ${theta != null && Number(theta) < 0 ? 'is-ask' : 'is-muted'}`}>{fmtGreek(theta, 3)}</span>;
      case 'chg24h': {
        const up = Number(chg) >= 0;
        return (
          <span className={`doc-num ${chg == null ? 'is-muted' : up ? 'is-bid' : 'is-ask'}`}>
            {chg != null && Number.isFinite(Number(chg)) ? `${up ? '+' : ''}${Number(chg).toFixed(2)}%` : '—'}
          </span>
        );
      }
      case 'iv':
        return <span className="doc-num">{ivStr}</span>;
      case 'last':
        return (
          <button type="button" className="doc-cell-btn" onClick={pickBuy}>
            <span className={`doc-num is-px ${lastPx != null ? 'is-mark' : 'is-muted'}`}>{fmtMarketPx(lastPx)}</span>
          </button>
        );
      case 'open':
        return <span className="doc-num is-muted">{fmtMarketPx(openPx)}</span>;
      case 'high':
        return <span className={`doc-num ${highPx != null ? 'is-bid' : 'is-muted'}`}>{fmtMarketPx(highPx)}</span>;
      case 'low':
        return <span className={`doc-num ${lowPx != null ? 'is-ask' : 'is-muted'}`}>{fmtMarketPx(lowPx)}</span>;
      case 'highLow':
        return (
          <>
            <span className={`doc-num ${highPx != null ? 'is-bid' : 'is-muted'}`}>{fmtMarketPx(highPx)}</span>
            <span className="doc-iv">{fmtMarketPx(lowPx)}</span>
          </>
        );
      case 'pos':
        return <span className={`doc-num ${hasPos ? 'is-accent' : 'is-muted'}`}>{posLabel}</span>;
      default:
        return <span className="doc-num is-muted">—</span>;
    }
  };

  return cells.map((key) => (
    <td
      key={`${side}-${contract.id}-${key}`}
      className={tdClass}
      onClick={() => pickCell(key)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          pickCell(key);
        }
      }}
      role="button"
      tabIndex={0}
      title={key === 'bid' ? 'Select · sell at bid' : 'Select contract'}
    >
      <div className="doc-td__box">{cellContent(key)}</div>
    </td>
  ));
}

export function OptionsChainHeaders({ side, cols, Th }) {
  const cells = side === 'call' ? expandCallCells(cols) : expandPutCells(cols);
  return cells.map((key) => {
    const meta = CELL_HEADERS[key] || { label: key, title: key };
    return (
      <Th key={`${side}-h-${key}`} title={meta.title}>
        {meta.label}
      </Th>
    );
  });
}

export function chainColSpan(cols, side = 'call') {
  return (side === 'call' ? expandCallCells(cols) : expandPutCells(cols)).length;
}

export { chainMinWidthPx, resolveChainCols };
