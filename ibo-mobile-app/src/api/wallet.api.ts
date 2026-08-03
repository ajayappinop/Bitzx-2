import type { AxiosRequestConfig } from 'axios';
import apiClient from './client';
import { EP } from './endpoints';
import {
  WalletAsset,
  WalletBalances,
  DepositAddress,
  SupportedNetwork,
  WithdrawConfig,
  WithdrawPayload,
  IboSwapDirection,
  IboSwapQuote,
  IboSwapConfig,
} from '../types/wallet.types';
import {
  parseWalletTransactionsPage,
  type WalletTransactionsPage,
} from '../utils/walletLedger';
import { chainDisplayName } from '../utils/walletChainDetails';
import type { SignupBonusPending } from '../types/signupBonus.types';

/**
 * Backend `GET /api/wallet/supported-networks` returns QuickNode-shaped rows:
 * `{ asset, network, chain, label, testnet }` — no `deposit_enabled` / `network_name`.
 * Filtering on missing booleans removed every row in the mobile UI.
 */
export function normalizeSupportedNetworks(raw: unknown): SupportedNetwork[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((row): row is Record<string, unknown> => row != null && typeof row === 'object')
    .map((row) => {
      const asset = String(row.asset ?? '').trim();
      const network = String(row.network ?? '').trim();
      const labelRaw = row.label != null ? String(row.label).trim() : '';
      const networkName = labelRaw || network;
      const status =
        typeof row.status === 'string' && row.status.trim()
          ? row.status.trim()
          : 'active';
      const depositExplicit = row.deposit_enabled;
      const withdrawExplicit = row.withdraw_enabled;
      const chainId = typeof row.chain_id === 'string' ? row.chain_id : undefined;
      return {
        asset,
        network,
        network_name: networkName,
        chain: typeof row.chain === 'string' ? row.chain : undefined,
        chain_id: chainId,
        chain_display: chainDisplayName(chainId),
        endpoint_label:
          typeof row.endpoint_label === 'string' ? row.endpoint_label.trim() : undefined,
        rpc_configured: row.rpc_configured !== false,
        testnet: !!row.testnet,
        status,
        min_deposit: typeof row.min_deposit === 'number' ? row.min_deposit : undefined,
        min_withdraw: typeof row.min_withdraw === 'number' ? row.min_withdraw : undefined,
        withdraw_fee: typeof row.withdraw_fee === 'number' ? row.withdraw_fee : undefined,
        deposit_enabled:
          status === 'coming_soon'
            ? false
            : depositExplicit === true,
        withdraw_enabled:
          status === 'coming_soon'
            ? false
            : withdrawExplicit === true,
      };
    })
    .filter((n) => n.asset.length > 0 && n.network.length > 0);
}

export const walletApi = {
  getAssets: () => apiClient.get<WalletAsset[]>(EP.WALLET_ASSETS),

  /**
   * GET /api/wallet/balances
   * Web returns: { asset, available, locked }[] (same shape as the WS wallet array)
   * May also return { assets: [], total_usd: 0 } on some backends — handled in the slice.
   */
  getBalances: () => apiClient.get<any>(EP.WALLET_BALANCES),

  getDepositAddresses: (asset?: string, network?: string) =>
    apiClient.get<DepositAddress[]>(EP.WALLET_DEPOSIT_ADDRESSES, {
      params: { asset, network },
    }),

  getSupportedNetworks: async () => {
    const res = await apiClient.get<unknown>(EP.WALLET_SUPPORTED_NETWORKS);
    return { ...res, data: normalizeSupportedNetworks(res.data) };
  },

  getWithdrawConfig: (params?: { network?: string; chain_id?: string }) =>
    apiClient.get<WithdrawConfig>(EP.WALLET_WITHDRAW_CONFIG, { params }),

  withdraw: (payload: WithdrawPayload) =>
    apiClient.post<{ ok: boolean; withdrawal_id: string }>(EP.WALLET_WITHDRAW, payload),

  getWithdrawals: (params?: { limit?: number; skip?: number; asset?: string; status?: string }) =>
    apiClient.get(EP.WALLET_WITHDRAWALS, { params }),

  /**
   * GET /api/wallet/transactions — paginated `{ items, total, skip, limit }`.
   * Query uses `skip` + `limit` (not `page`). Types must match backend ledger enum.
   */
  getTransactionsPage: async (params?: {
    asset?: string;
    type?: string;
    page?: number;
    limit?: number;
    skip?: number;
  }): Promise<WalletTransactionsPage> => {
    const limit = Math.min(500, Math.max(1, params?.limit ?? 50));
    const skip =
      params?.skip != null
        ? Math.max(0, params.skip)
        : Math.max(0, (Math.max(1, params?.page ?? 1) - 1) * limit);
    const res = await apiClient.get<unknown>(EP.WALLET_TRANSACTIONS, {
      params: {
        asset: params?.asset,
        type: params?.type,
        limit,
        skip,
      },
    });
    return parseWalletTransactionsPage(res.data, skip, limit);
  },

  getDepositEvents: (params?: { limit?: number; skip?: number; asset?: string; status?: string }) =>
    apiClient.get(EP.WALLET_DEPOSIT_EVENTS, { params }),

  /**
   * GET /api/wallet/verify-deposit
   * On-demand blockchain scan for the authenticated user's deposit addresses.
   * Call while the deposit page is open; stop calling when the user navigates away.
   */
  verifyDeposit: () =>
    apiClient.get<{
      ok: boolean;
      events_found: number;
      skipped?: boolean;
      retry_in_sec?: number;
      no_addresses?: boolean;
      addresses_scanned?: number;
      block_lookback?: number;
    }>(EP.WALLET_VERIFY_DEPOSIT),

  /**
   * Session-based on-demand deposit monitor (mirrors the web app).
   * A single ~7-minute server-side session covers both the Deposit and
   * Transactions/History screens — opening either resumes the same
   * session instead of starting a new timer.
   */
  getDepositMonitorStatus: () =>
    apiClient.get<{ session: any; config: any }>(EP.WALLET_DEPOSIT_MONITOR_STATUS),

  startDepositMonitor: () =>
    apiClient.post<{ session: any; config: any }>(EP.WALLET_DEPOSIT_MONITOR_START),

  scanDepositMonitor: (sessionId: string) =>
    apiClient.post<{
      ok: boolean;
      events_found: number;
      scan_count?: number;
      scans_remaining?: number;
      expires_at?: string;
      status?: string;
      skipped?: boolean;
      retry_in_sec?: number;
    }>(EP.WALLET_DEPOSIT_MONITOR_SCAN, { session_id: sessionId }),

  stopDepositMonitor: (sessionId: string) =>
    apiClient.delete<{ stopped: boolean }>(EP.WALLET_DEPOSIT_MONITOR_STOP, {
      data: { session_id: sessionId },
    }),

  getSignupBonusPending: () =>
    apiClient.get<SignupBonusPending>(EP.WALLET_SIGNUP_BONUS_PENDING),

  getSwapConfig: () => apiClient.get<IboSwapConfig>(EP.WALLET_SWAP_CONFIG),

  getSwapQuote: (
    direction: IboSwapDirection,
    amount: number,
    config?: AxiosRequestConfig,
  ) =>
    apiClient.get<IboSwapQuote>(EP.WALLET_SWAP_QUOTE, {
      ...config,
      params: { direction, amount, ...config?.params },
    }),

  executeSwap: (direction: IboSwapDirection, amount: number) =>
    apiClient.post(EP.WALLET_SWAP, { direction, amount }),
};
