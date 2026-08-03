/** INR withdrawal display helpers — subset of web `lib/inrDisplay.js`. */

export const INR_STATUS_LABELS: Record<string, string> = {
  pending: 'Pending review',
  approving: 'Processing',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

export function isUserCancelledInrWithdrawal(record: {
  status?: string;
  rejection_reason?: string;
  meta?: { rejection_reason?: string };
} | null | undefined): boolean {
  if (!record || String(record.status || '').toLowerCase() !== 'rejected') return false;
  const reason = String(
    record.rejection_reason || record.meta?.rejection_reason || '',
  ).trim().toLowerCase();
  return reason === 'cancelled by user';
}

export function inrStatusLabel(
  status?: string,
  opts: { rejectionReason?: string } = {},
): string {
  if (
    String(status || '').toLowerCase() === 'rejected'
    && String(opts.rejectionReason || '').trim().toLowerCase() === 'cancelled by user'
  ) {
    return INR_STATUS_LABELS.cancelled;
  }
  const key = String(status || 'pending').toLowerCase();
  return INR_STATUS_LABELS[key] || key.replace(/_/g, ' ');
}

/** Map INR withdrawal row → StatusBadge status key. */
export function effectiveInrWithdrawalStatus(item: {
  status?: string;
  rejection_reason?: string;
}): string {
  if (isUserCancelledInrWithdrawal(item)) return 'cancelled';
  return String(item.status || 'pending').toLowerCase();
}

export function formatInrAmount(amountInr: number | string | null | undefined): string {
  const n = Number(amountInr);
  if (!Number.isFinite(n)) return '—';
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function resolveMinDepositInr(config: { min_deposit_inr?: unknown } | null | undefined): number {
  const n = Number(config?.min_deposit_inr);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Parse user-entered INR amount (commas ok) and round to 2 decimal paise. */
export function parseInrAmountInput(raw: string | number | null | undefined): number {
  const n = parseFloat(String(raw ?? '').replace(/,/g, '').trim());
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 100) / 100;
}
