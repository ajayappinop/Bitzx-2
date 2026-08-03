import type { WalletTransaction, TransactionStatus } from '../types/wallet.types';

export type DepositEventRow = {
  id?: string;
  asset?: string;
  amount?: number | string;
  tx_hash?: string;
  network?: string;
  confirmations?: number;
  required_confirmations?: number;
  status?: string;
  source?: string;
  created_at?: string;
};

function mapDepositStatus(status?: string): TransactionStatus {
  const s = String(status || 'pending').toLowerCase();
  if (s === 'confirmed' || s === 'credited' || s === 'completed') return 'completed';
  if (s === 'failed' || s === 'rejected') return 'failed';
  return 'pending';
}

/** On-chain deposit events → ledger rows (pending credits not yet in wallet_txns). */
export function depositEventsToTransactions(
  events: DepositEventRow[],
  creditedHashes: Set<string> = new Set(),
): WalletTransaction[] {
  return (events || [])
    .filter((e) => {
      const hash = String(e.tx_hash || '').toLowerCase();
      return !hash || !creditedHashes.has(hash);
    })
    .map((e) => ({
      txn_id: `dep-ev-${e.id || e.tx_hash || Math.random()}`,
      type: 'deposit' as const,
      asset: String(e.asset || '').toUpperCase(),
      amount: Number(e.amount ?? 0),
      direction: 'credit' as const,
      status: mapDepositStatus(e.status),
      created_at: e.created_at || new Date().toISOString(),
      tx_hash: e.tx_hash,
      note: [
        e.source === 'signup_bonus' ? 'Signup bonus' : null,
        e.network ? `On-chain · ${e.network}` : 'On-chain deposit',
        e.status && String(e.status).toLowerCase() !== 'credited'
          ? String(e.status).replace(/_/g, ' ')
          : null,
      ].filter(Boolean).join(' · '),
    }));
}

export function mergeLedgerAndDepositEvents(
  ledger: WalletTransaction[],
  onChain: WalletTransaction[],
): WalletTransaction[] {
  if (!onChain.length) return ledger;
  const merged = [...onChain, ...ledger];
  merged.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  return merged;
}
