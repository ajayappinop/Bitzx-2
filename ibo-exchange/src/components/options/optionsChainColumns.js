/**
 * Delta Exchange options chain columns — full set always available.
 * Toggle picker labels match Delta column settings (OI · Bid/Ask · Qty · Mark · … · High · Low · POS).
 */

export const DELTA_CHAIN_ORDER = [
  'oi',
  'bidQty',
  'bid',
  'mark',
  'ask',
  'askQty',
  'delta',
  'volume',
  'oiChg6h',
  'pos',
  'gamma',
  'vega',
  'theta',
  'chg24h',
  'last',
  'open',
  'high',
  'low',
];

/** Cell atom → toggle id */
export const CELL_TOGGLE = {
  oi: 'oi',
  bidQty: 'qty',
  bid: 'bidAsk',
  mark: 'mark',
  ask: 'bidAsk',
  askQty: 'qty',
  delta: 'delta',
  volume: 'volume',
  oiChg6h: 'oiChg6h',
  pos: 'pos',
  gamma: 'gamma',
  vega: 'vega',
  theta: 'theta',
  chg24h: 'chg24h',
  last: 'last',
  open: 'open',
  high: 'high',
  low: 'low',
};

/**
 * Column Settings — order reads left column then right, matching Delta popup.
 * `indent` nests under Bid/Ask; `pair` keeps High/Low sibling grouping in the UI.
 */
export const CHAIN_COL_TOGGLES = [
  { id: 'oi', label: 'OI', col: 0 },
  { id: 'bidAsk', label: 'Bid/ Ask', col: 0 },
  { id: 'qty', label: 'Qty', col: 0, indent: true },
  { id: 'mark', label: 'Mark', col: 0, indent: true },
  { id: 'delta', label: 'Delta', col: 0 },
  { id: 'volume', label: 'Volume', col: 0 },
  { id: 'oiChg6h', label: '6H OI Chg.', col: 0 },
  { id: 'pos', label: 'POS', col: 0 },
  { id: 'gamma', label: 'Gamma', col: 1 },
  { id: 'vega', label: 'Vega', col: 1 },
  { id: 'theta', label: 'Theta', col: 1 },
  { id: 'chg24h', label: '24hr Chg.', col: 1 },
  { id: 'last', label: 'Last', col: 1 },
  { id: 'open', label: 'Open', col: 1 },
  { id: 'high', label: 'High', col: 1 },
  { id: 'low', label: 'Low', col: 1 },
];

/** Full chain ON by default. */
export const DEFAULT_CHAIN_COLS = Object.fromEntries(
  CHAIN_COL_TOGGLES.map((t) => [t.id, true]),
);

/** Merge so HMR / old React state never drops new columns. */
export function resolveChainCols(cols) {
  const merged = { ...DEFAULT_CHAIN_COLS, ...(cols || {}) };
  /* Migrate legacy highLow single flag → high + low */
  if (cols && Object.prototype.hasOwnProperty.call(cols, 'highLow') && cols.highLow != null) {
    if (merged.high === undefined || cols.high == null) merged.high = Boolean(cols.highLow);
    if (merged.low === undefined || cols.low == null) merged.low = Boolean(cols.highLow);
  }
  return merged;
}

export function expandCallCells(cols) {
  const c = resolveChainCols(cols);
  const out = DELTA_CHAIN_ORDER.filter((key) => Boolean(c[CELL_TOGGLE[key]]));
  return out.length ? out : [...DELTA_CHAIN_ORDER];
}

/** Puts are mirrored so fields line up with Calls across the Strike. */
export function expandPutCells(cols) {
  return [...expandCallCells(cols)].reverse();
}

export const CELL_HEADERS = {
  oi: { label: 'OI', title: 'Open interest' },
  bidQty: { label: 'Bid Qty', title: 'Bid quantity' },
  bid: { label: 'Bid', title: 'Best bid + IV' },
  mark: { label: 'Mark', title: 'Mark price + IV' },
  ask: { label: 'Ask', title: 'Best ask + IV' },
  askQty: { label: 'Ask Qty', title: 'Ask quantity' },
  delta: { label: 'Delta', title: 'Delta' },
  volume: { label: 'Volume', title: '24h volume' },
  oiChg6h: { label: '6H OI Chg', title: '6 hour OI change' },
  pos: { label: 'POS', title: 'Position size' },
  gamma: { label: 'Gamma', title: 'Gamma' },
  vega: { label: 'Vega', title: 'Vega' },
  theta: { label: 'Theta', title: 'Theta' },
  chg24h: { label: '24hr Chg', title: '24 hour change %' },
  last: { label: 'Last', title: 'Last traded price' },
  open: { label: 'Open', title: 'Session open' },
  high: { label: 'High', title: 'Session high' },
  low: { label: 'Low', title: 'Session low' },
};

export function chainArmWidthPx(cols) {
  const n = expandCallCells(cols).length;
  return Math.max(n * 70, 70);
}

export function chainMinWidthPx(cols) {
  const n = expandCallCells(cols).length;
  return Math.max(1600, n * 70 * 2 + 84);
}
