export type HistoryDepositRow = {
  id?: string;
  asset?: string;
  amount?: number | string;
  tx_hash?: string;
  network?: string;
  confirmations?: number;
  required_confirmations?: number;
  status?: string;
  label?: string;
  status_note?: string;
  source?: string;
  created_at?: string;
  currency?: 'CRYPTO' | 'INR';
  ref?: string;
  rejection_reason?: string;
};

export type HistoryWithdrawRow = {
  id?: string;
  withdrawal_id?: string;
  asset?: string;
  amount?: number | string;
  fee?: number | string;
  address?: string;
  tx_hash?: string;
  network?: string;
  status?: string;
  created_at?: string;
  currency?: 'CRYPTO' | 'INR';
  ref?: string;
  rejection_reason?: string;
  amount_inr?: number | string;
  payout_label?: string;
  payout_reference?: string;
};

type Cache = {
  deposits: HistoryDepositRow[];
  withdrawals: HistoryWithdrawRow[];
  updatedAt: number;
};

let cache: Cache | null = null;

const MAX_AGE_MS = 5 * 60 * 1000;

export function getWalletHistoryCache(): Cache | null {
  if (!cache) return null;
  if (Date.now() - cache.updatedAt > MAX_AGE_MS) return null;
  return cache;
}

export function setWalletHistoryCache(
  deposits: HistoryDepositRow[],
  withdrawals: HistoryWithdrawRow[],
) {
  cache = { deposits, withdrawals, updatedAt: Date.now() };
}

export function invalidateWalletHistoryCache() {
  cache = null;
}
