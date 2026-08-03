/**
 * useDepositDetectedModal
 *
 * Fetches the just-detected deposit event and drives the success pop-up.
 * Shared by DepositScreen and TransactionsScreen so either screen can
 * surface the modal the instant the on-demand monitor finds a new
 * on-chain transaction.
 */

import { useCallback, useState } from 'react';
import { walletApi } from '../api/wallet.api';

export interface DetectedDeposit {
  asset?: string;
  amount?: number | string;
  network?: string;
  status?: string;
  tx_hash?: string;
  created_at?: string;
}

export function useDepositDetectedModal() {
  const [visible, setVisible] = useState(false);
  const [deposit, setDeposit] = useState<DetectedDeposit | null>(null);

  const handleDetected = useCallback(async (count: number) => {
    try {
      const res = await walletApi.getDepositEvents({ limit: Math.max(count || 1, 5) });
      const raw = res.data as { items?: DetectedDeposit[] } | DetectedDeposit[];
      const items = Array.isArray(raw) ? raw : (raw?.items ?? []);
      const latest = items
        .slice()
        .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))[0];
      if (latest) {
        setDeposit(latest);
        setVisible(true);
      }
    } catch {
      // Silent — the deposit still shows up in Transactions even if this fails.
    }
  }, []);

  return {
    visible,
    deposit,
    close: () => setVisible(false),
    handleDetected,
  };
}
