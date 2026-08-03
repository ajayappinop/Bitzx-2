/**
 * Spot ↔ futures transfer — handles slow VPS responses where the POST times out
 * but the server already applied the transfer.
 */
import { futuresApi, invalidateFuturesWalletCache } from '../api/futures.api';
import { walletApi } from '../api/wallet.api';
import { parseApiError } from '../api/errors';
import { AppDispatch } from '../store';
import { fetchWalletThunk } from '../store/wallet.slice';
import { findWalletAvailable } from '../utils/walletBalance';
import { futuresWalletAvailable } from '../utils/futuresQuotes';

export type TransferDirection = 'spot_to_futures' | 'futures_to_spot';

export type TransferBalanceSnapshot = {
  spot: number;
  futures: number;
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readTransferBalances(): Promise<TransferBalanceSnapshot> {
  const [spotRes, fut] = await Promise.all([
    walletApi.getBalances().catch(() => null),
    futuresApi.getWallet(true).catch(() => null),
  ]);
  const raw = spotRes?.data;
  const rows = Array.isArray(raw) ? raw : (raw as { assets?: unknown[] })?.assets ?? [];
  const assets = rows.map((w: Record<string, unknown>) => ({
    asset: String(w.asset ?? ''),
    available_balance: String(w.available ?? w.available_balance ?? 0),
    locked_balance: String(w.locked ?? w.locked_balance ?? 0),
  }));
  return {
    spot: findWalletAvailable(assets as any, 'USDT'),
    futures: futuresWalletAvailable(fut),
  };
}

function transferLooksApplied(
  direction: TransferDirection,
  amount: number,
  before: TransferBalanceSnapshot,
  after: TransferBalanceSnapshot,
): boolean {
  const eps = 0.02;
  if (direction === 'spot_to_futures') {
    return (
      before.spot - after.spot >= amount - eps
      && after.futures - before.futures >= amount - eps
    );
  }
  return (
    before.futures - after.futures >= amount - eps
    && after.spot - before.spot >= amount - eps
  );
}

function isAmbiguousTransferError(err: unknown): boolean {
  const apiErr = parseApiError(err);
  if (apiErr.status === 0) {
    return /timeout|aborted|ECONNABORTED|ETIMEDOUT|network|reach the server/i.test(apiErr.message);
  }
  // Gateway timeout while upstream may have completed
  return apiErr.status === 502 || apiErr.status === 504;
}

async function confirmTransferAfterAmbiguity(
  direction: TransferDirection,
  amount: number,
  before: TransferBalanceSnapshot,
): Promise<boolean> {
  const waits = [500, 1200, 2200, 3500, 5000];
  for (const ms of waits) {
    await delay(ms);
    try {
      const after = await readTransferBalances();
      if (transferLooksApplied(direction, amount, before, after)) return true;
    } catch {
      /* retry */
    }
  }
  return false;
}

/**
 * Submit transfer; if the HTTP client times out, poll balances to detect success.
 */
export async function submitFuturesTransfer(
  body: { direction: TransferDirection; amount: number },
  beforeHint?: TransferBalanceSnapshot,
): Promise<void> {
  const amount = Math.round(Number(body.amount) * 100) / 100;
  const before = beforeHint ?? await readTransferBalances().catch(() => ({ spot: 0, futures: 0 }));

  try {
    await futuresApi.transfer({ direction: body.direction, amount, asset: 'USDT' });
    return;
  } catch (err) {
    if (!isAmbiguousTransferError(err)) throw err;
    const confirmed = await confirmTransferAfterAmbiguity(body.direction, amount, before);
    if (confirmed) return;
    throw err;
  }
}

/** Refresh spot + futures wallets in the background — never block the transfer UI. */
export function scheduleTransferRefresh(
  dispatch: AppDispatch,
  onFuturesRefresh?: () => void,
): void {
  invalidateFuturesWalletCache();
  void dispatch(fetchWalletThunk());
  if (onFuturesRefresh) void onFuturesRefresh();
}
