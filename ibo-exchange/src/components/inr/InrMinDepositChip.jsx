import { formatInrAmount } from '@/lib/inrDisplay';

/** Subtle marketing chip — only when admin set a minimum > 0. */
export function InrMinDepositChip({ minDepositInr, className = '' }) {
  if (!minDepositInr || minDepositInr <= 0) return null;
  return (
    <span
      className={`inline-flex items-center rounded-full border border-gold/25 bg-gold/[0.08] px-2.5 py-1 text-[11px] font-medium text-gold-light/90 ${className}`}
    >
      From {formatInrAmount(minDepositInr)} accepted
    </span>
  );
}

/** One-line note under marketing copy. */
export function InrMinDepositNote({ minDepositInr, className = '' }) {
  if (!minDepositInr || minDepositInr <= 0) return null;
  return (
    <p className={`text-xs text-white/45 leading-relaxed ${className}`}>
      Only deposits of {formatInrAmount(minDepositInr)} or more are accepted — please don&apos;t transfer less.
    </p>
  );
}
