const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

export function normalizePanInput(raw: string): string {
  return raw.replace(/\s/g, '').toUpperCase();
}

export function isValidPanFormat(pan: string): boolean {
  return PAN_RE.test(normalizePanInput(pan));
}
