export const METHOD_TYPE_LABEL = {
  bank: 'Bank',
  upi: 'UPI',
  qr: 'QR code',
};

export function methodSelectLabel(method, allMethods) {
  const base = METHOD_TYPE_LABEL[method.type] || 'Payment method';
  const sameType = allMethods.filter((m) => m.type === method.type);
  if (sameType.length <= 1) return base;
  const index = sameType.findIndex((m) => m.id === method.id);
  return index > 0 ? `${base} (${index + 1})` : base;
}

export const UTR_PATTERN = /^[A-Za-z0-9]{6,22}$/;

export function parseAmount(raw) {
  const n = parseFloat(String(raw || '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : NaN;
}

export function formatAmountDisplay(raw) {
  const cleaned = String(raw || '').replace(/[^\d.]/g, '');
  if (!cleaned) return '';
  const parts = cleaned.split('.');
  const intPart = parts[0].replace(/^0+(?=\d)/, '') || '0';
  const dec = parts[1] != null ? `.${parts[1].slice(0, 2)}` : '';
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + dec;
}

export function resolveMinDepositInr(config) {
  const n = Number(config?.min_deposit_inr);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function normalizeInrAmount(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 100) / 100;
}

export function validateMinDepositAmount(amount, minDepositInr, formatInrAmount) {
  const amt = normalizeInrAmount(amount);
  if (!Number.isFinite(amt) || amt <= 0) return 'Enter a valid INR amount';
  if (minDepositInr > 0 && amt < minDepositInr) {
    return `Minimum deposit is ${formatInrAmount(minDepositInr)}`;
  }
  return null;
}
