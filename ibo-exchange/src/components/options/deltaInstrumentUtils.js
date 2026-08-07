/**
 * Shared formatters for Delta-style instruments.
 */

export function baseFromUsdt(sym) {
  return String(sym || '').replace(/USDT$/i, '') || String(sym || '');
}

export function expiryMs(iso) {
  if (!iso) return NaN;
  const raw = String(iso).trim().replace('Z', '+00:00');
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : NaN;
}

/** Delta tab style: "06 Aug 26" */
export function formatExpiryTabLabel(iso) {
  const t = expiryMs(iso);
  if (!Number.isFinite(t)) return String(iso || '').slice(0, 10) || '—';
  const d = new Date(t);
  const day = String(d.getUTCDate()).padStart(2, '0');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const yy = String(d.getUTCFullYear()).slice(-2);
  return `${day} ${months[d.getUTCMonth()]} ${yy}`;
}

/** e.g. P-BTC-64400-060826 or MV-BTC-64400-060826 */
export function formatDeltaInstrumentId(contract, underlying) {
  if (!contract) return '—';
  const ot = String(contract.option_type || '').toLowerCase();
  const t = ot === 'put' ? 'P' : ot === 'move' ? 'MV' : 'C';
  const base = baseFromUsdt(contract.underlying_symbol || underlying || '');
  const strike = Number(contract.strike);
  const strikeStr = Number.isFinite(strike)
    ? (Math.abs(strike - Math.round(strike)) < 1e-6 ? String(Math.round(strike)) : String(strike))
    : '—';
  const ms = expiryMs(contract.expiry);
  let dmy = '——————';
  if (Number.isFinite(ms)) {
    const d = new Date(ms);
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const yy = String(d.getUTCFullYear()).slice(-2);
    dmy = `${dd}${mm}${yy}`;
  }
  return `${t}-${base}-${strikeStr}-${dmy}`;
}

/** True for MOVE / straddle contracts (never belong on the vanilla Options chain). */
export function isMoveContract(rowOrId) {
  if (rowOrId == null) return false;
  if (typeof rowOrId === 'string') {
    return /_MV$/i.test(rowOrId) || /_MV_/i.test(rowOrId);
  }
  const ot = String(rowOrId.option_type || rowOrId.product || '').toLowerCase();
  if (ot === 'move') return true;
  return isMoveContract(rowOrId.id || rowOrId.contract_id || '');
}

export function vanillaContractsOnly(list) {
  return (list || []).filter((c) => !isMoveContract(c));
}

export function moveContractsOnly(list) {
  return (list || []).filter((c) => isMoveContract(c));
}
