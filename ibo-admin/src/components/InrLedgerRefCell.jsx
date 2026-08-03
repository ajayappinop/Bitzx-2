import {
  formatInrDepositRefTitle,
  formatInrWithdrawalRefTitle,
  getInrRefDisplay,
  getInrWithdrawalRefDisplay,
  isInrWithdrawalRow,
} from '@/lib/inrDisplay';

/**
 * Ledger reference cell — UTR on top, internal id below (deposits and INR withdrawals).
 */
export default function InrLedgerRefCell({ row, className = '' }) {
  const isWd = isInrWithdrawalRow(row);
  const ref = isWd ? getInrWithdrawalRefDisplay(row) : getInrRefDisplay(row);
  const title = isWd ? formatInrWithdrawalRefTitle(row) : formatInrDepositRefTitle(row);
  const idLine = isWd ? ref.withdrawalId : ref.depositId;
  const idLabel = isWd ? 'Request ID' : 'Deposit ID';

  return (
    <div className={`min-w-0 max-w-[280px] ${className}`} title={title}>
      {ref.utr ? (
        <p className="font-mono text-xs sm:text-sm text-white/90 truncate leading-snug">{ref.utr}</p>
      ) : (
        <p className="text-xs text-white/45 italic">{isWd ? 'UTR pending' : 'UTR not recorded'}</p>
      )}
      {idLine ? (
        <p
          className="font-mono text-[10px] text-gold-light/40 truncate mt-0.5 leading-tight"
          title={`${idLabel}: ${idLine}`}
        >
          {idLine}
        </p>
      ) : null}
    </div>
  );
}
