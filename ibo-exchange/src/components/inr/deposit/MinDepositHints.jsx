import { formatInrAmount } from '@/lib/inrDisplay';
import { normalizeInrAmount, parseAmount } from './utils';

/** Pill shown while the entered amount is below the platform minimum. */
export function AmountBelowMinPill({ amountRaw, minDepositInr, className = '' }) {
  if (!minDepositInr || minDepositInr <= 0) return null;
  const raw = String(amountRaw ?? '').trim();
  if (!raw) return null;
  const amt = normalizeInrAmount(parseAmount(raw));
  if (!Number.isFinite(amt) || amt <= 0 || amt >= minDepositInr) return null;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border border-gold/25 bg-gold/[0.08] px-3 py-1.5 text-xs text-gold-light/90 ${className}`}
    >
      Minimum accepted: {formatInrAmount(minDepositInr)} — please don&apos;t deposit less
    </span>
  );
}

/** Subtle note on QR / UPI / bank instructions when a minimum is configured. */
export function PaymentMinNotice({ minDepositInr, className = '' }) {
  if (!minDepositInr || minDepositInr <= 0) return null;

  return (
    <p
      className={`rounded-xl border border-white/[0.08] bg-white/[0.03] px-3.5 py-2.5 text-xs leading-relaxed text-white/50 ${className}`}
    >
      Only deposits of {formatInrAmount(minDepositInr)} or more are accepted. Please don&apos;t transfer a lower amount.
    </p>
  );
}
