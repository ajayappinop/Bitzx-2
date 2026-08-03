/** Normalize `/trade/:symbol` route param → API wire symbol (e.g. MIDAS → MIDASUSDT). */
export function normalizeSpotRouteSymbol(routeSymbol) {
  const raw = String(routeSymbol || '').trim().toUpperCase();
  if (!raw) return 'IBOUSDT';
  if (raw.endsWith('IBO') && raw.length > 3) return raw;
  if (raw.endsWith('USDT')) return raw;
  return `${raw}USDT`;
}

export function baseFromSpotSymbol(symbol) {
  const s = String(symbol || '').toUpperCase();
  if (s.endsWith('IBO') && s.length > 3) return s.slice(0, -3);
  if (s.endsWith('USDT')) return s.slice(0, -4);
  return s;
}
