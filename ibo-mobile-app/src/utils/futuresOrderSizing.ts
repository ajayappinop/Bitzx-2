import type { FuturesAmountUnit, FuturesSizingMode } from '../types/futuresOrderSizing.types';

export type FuturesSizingCaps = {
  availMargin: number;
  leverage: number;
  fillPx: number;
  lotSize: number;
};

export function floorToLot(qty: number, lotSize: number): number {
  if (!Number.isFinite(qty) || qty <= 0) return 0;
  const step = lotSize > 0 ? lotSize : 0.001;
  return Math.floor(qty / step) * step;
}

export function qtyToContracts(qty: number, lotSize: number): number {
  if (!Number.isFinite(qty) || qty <= 0 || lotSize <= 0) return 0;
  return qty / lotSize;
}

export function contractsToQty(contracts: number, lotSize: number): number {
  if (!Number.isFinite(contracts) || contracts <= 0 || lotSize <= 0) return 0;
  return contracts * lotSize;
}

export function maxOpenQty(caps: FuturesSizingCaps): number {
  const { availMargin, leverage, fillPx } = caps;
  if (availMargin <= 0 || leverage <= 0 || fillPx <= 0) return 0;
  return (availMargin * leverage) / fillPx;
}

export function maxOpenNotional(caps: FuturesSizingCaps): number {
  const { availMargin, leverage } = caps;
  if (availMargin <= 0 || leverage <= 0) return 0;
  return availMargin * leverage;
}

export function maxOpenContracts(caps: FuturesSizingCaps): number {
  const q = maxOpenQty(caps);
  if (q <= 0) return 0;
  return qtyToContracts(q, caps.lotSize);
}

export function unitButtonLabel(
  mode: FuturesSizingMode,
  amountUnit: FuturesAmountUnit,
  baseAsset: string,
): string {
  if (mode === 'cost') return 'USDT';
  if (amountUnit === 'BASE') return baseAsset;
  if (amountUnit === 'CONT') return 'Cont';
  return 'USDT';
}

export function hintUnitLabel(
  mode: FuturesSizingMode,
  amountUnit: FuturesAmountUnit,
  baseAsset: string,
): string {
  return unitButtonLabel(mode, amountUnit, baseAsset);
}

export type SizingDisplay = {
  current: number;
  max: number;
  unit: string;
};

export function getSizingDisplay(opts: {
  mode: FuturesSizingMode;
  amountUnit: FuturesAmountUnit;
  baseAsset: string;
  caps: FuturesSizingCaps;
  qty: number;
  total: number;
  margin: number;
}): SizingDisplay {
  const { mode, amountUnit, baseAsset, caps, qty, total, margin } = opts;
  const unit = hintUnitLabel(mode, amountUnit, baseAsset);

  if (mode === 'cost') {
    return {
      current: margin,
      max: caps.availMargin,
      unit,
    };
  }

  if (amountUnit === 'USDT') {
    return {
      current: total,
      max: maxOpenNotional(caps),
      unit,
    };
  }

  if (amountUnit === 'CONT') {
    return {
      current: qtyToContracts(qty, caps.lotSize),
      max: maxOpenContracts(caps),
      unit,
    };
  }

  return {
    current: qty,
    max: maxOpenQty(caps),
    unit,
  };
}

/** Apply slider % to raw sizing values (before formatting into form fields). */
export function pctToSizingValues(
  pct: number,
  mode: FuturesSizingMode,
  amountUnit: FuturesAmountUnit,
  caps: FuturesSizingCaps,
): { margin: number; total: number; qty: number } {
  const v = Math.max(0, Math.min(100, pct)) / 100;
  const lev = Math.max(1, caps.leverage);
  const px = caps.fillPx;
  const maxNotional = maxOpenNotional(caps);
  const maxQty = maxOpenQty(caps);

  if (mode === 'cost') {
    const m = caps.availMargin * v;
    const tot = m * lev;
    const q = px > 0 ? floorToLot(tot / px, caps.lotSize) : 0;
    return { margin: m, total: tot, qty: q };
  }

  if (amountUnit === 'USDT') {
    const tot = maxNotional * v;
    const m = lev > 0 ? tot / lev : 0;
    const q = px > 0 ? floorToLot(tot / px, caps.lotSize) : 0;
    return { margin: m, total: tot, qty: q };
  }

  if (amountUnit === 'CONT') {
    const maxCont = maxOpenContracts(caps);
    const cont = maxCont * v;
    const q = floorToLot(contractsToQty(cont, caps.lotSize), caps.lotSize);
    const tot = px > 0 ? q * px : 0;
    const m = lev > 0 ? tot / lev : 0;
    return { margin: m, total: tot, qty: q };
  }

  const q = floorToLot(maxQty * v, caps.lotSize);
  const tot = px > 0 ? q * px : 0;
  const m = lev > 0 ? tot / lev : 0;
  return { margin: m, total: tot, qty: q };
}

/** Reverse: current form values → slider % (0–100). */
export function sizingValuesToPct(opts: {
  mode: FuturesSizingMode;
  amountUnit: FuturesAmountUnit;
  caps: FuturesSizingCaps;
  qty: number;
  total: number;
  margin: number;
  closeMaxQty?: number;
}): number {
  const { mode, amountUnit, caps, qty, total, margin, closeMaxQty } = opts;
  const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

  if (closeMaxQty != null && closeMaxQty > 0) {
    return qty > 0 ? clamp((qty / closeMaxQty) * 100) : 0;
  }

  if (caps.availMargin <= 0) return 0;

  if (mode === 'cost') {
    return margin > 0 ? clamp((margin / caps.availMargin) * 100) : 0;
  }

  const maxNotional = maxOpenNotional(caps);
  const maxQty = maxOpenQty(caps);

  if (amountUnit === 'USDT') {
    return total > 0 && maxNotional > 0 ? clamp((total / maxNotional) * 100) : 0;
  }

  if (amountUnit === 'CONT') {
    const maxCont = maxOpenContracts(caps);
    const cur = qtyToContracts(qty, caps.lotSize);
    return cur > 0 && maxCont > 0 ? clamp((cur / maxCont) * 100) : 0;
  }

  return qty > 0 && maxQty > 0 ? clamp((qty / maxQty) * 100) : 0;
}
