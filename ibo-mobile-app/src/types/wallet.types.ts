export interface WalletAsset {
  asset: string;
  name?: string;
  balance: number | string;
  locked_balance: number | string;
  available_balance: number | string;
  usd_value?: number | string;
  icon_url?: string;
}

export interface WalletBalances {
  total_usd: number | string;
  available_usd: number | string;
  locked_usd: number | string;
}

export type IboSwapDirection = 'ibo_to_usdt' | 'usdt_to_ibo';

export interface IboSwapQuote {
  direction: IboSwapDirection;
  symbol: string;
  from_asset: string;
  to_asset: string;
  from_amount: number;
  to_amount_estimated: number;
  price_usdt: number;
  fee_ibo_estimated: number;
  trading_fee_ibo_estimated?: number;
  fee_ibo_total?: number;
  swap_fee_rate?: number;
  swap_fee_ibo_fixed?: number;
  fee_asset: string;
  available_from?: number;
  min_from_amount?: number;
}

export interface IboSwapConfig {
  swap_fee_rate: number;
  swap_fee_ibo_fixed: number;
  taker_fee_rate: number;
  fee_asset: string;
  ibo_price_usdt: number;
  swap_fee_description?: string;
}

export interface DepositAddress {
  id?: string;
  asset?: string;
  network?: string;
  address: string;
  /** EIP-681 / URI payload for QR — prefer over plain address when present */
  qr_payload?: string;
  label?: string;
  memo?: string;
  min_deposit?: number;
  confirmations_required?: number;
}

export interface SupportedNetwork {
  asset: string;
  network: string;
  /** Display label from backend (`label`) or fallback */
  network_name: string;
  chain?: string;
  chain_id?: string;
  chain_display?: string;
  endpoint_label?: string;
  rpc_configured?: boolean;
  testnet?: boolean;
  status?: 'active' | 'coming_soon' | string;
  min_deposit?: number;
  deposit_enabled: boolean;
  withdraw_enabled: boolean;
  withdraw_fee?: number;
  min_withdraw?: number;
}

export interface WithdrawConfig {
  withdraw_fee_rate: number;
  withdraw_gas_fee_ibo: number;
  withdraw_gas_fee_ibo_by_chain?: Record<string, number>;
  withdraw_min_usdt: number;
  withdraw_max_usdt: number;
  withdraw_daily_limit_usdt: number;
  gas_fee_asset: string;
  gas_fee_label: string;
  gas_fee_description: string;
  platform_fee_description?: string;
  ibo_price_usdt?: number;
}

/** Canonical spot ledger types (`wallet_txns`), matching backend `_USER_LEDGER_TYPES`. */
export type LedgerTxnType =
  | 'deposit'
  | 'withdraw'
  | 'trade'
  | 'fee'
  | 'adjustment'
  | 'lock'
  | 'unlock'
  | 'seed'
  | 'opening_balance';

/** How the row affected balances (from backend `direction`). */
export type LedgerDirection = 'credit' | 'debit' | 'lock' | 'unlock';

/** Legacy names still normalized from older payloads or docs. */
export type LegacyLedgerTypeAlias = 'withdrawal' | 'trade_fill' | 'trade_fee';

export type TransactionType = LedgerTxnType | LegacyLedgerTypeAlias | 'transfer_in' | 'transfer_out' | 'bonus';

export type TransactionStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface WalletTransaction {
  txn_id: string;
  asset: string;
  type: TransactionType;
  /** Present on `wallet_txns` rows from IBO backend — drives +/- when set. */
  direction?: LedgerDirection;
  amount: number | string;
  fee?: number | string;
  status: TransactionStatus;
  created_at: string;
  updated_at?: string;
  tx_hash?: string;
  network?: string;
  address?: string;
  note?: string;
  /** Human-readable label from backend (e.g. "Signup bonus"). */
  label?: string;
  /** Source identifier (e.g. "signup_bonus"). */
  source?: string;
  ref_id?: string;
  ref_type?: string;
  balance_before?: { available: number; locked: number };
  balance_after?: { available: number; locked: number };
  meta?: Record<string, unknown>;
}

export interface WithdrawPayload {
  asset: string;
  network: string;
  address: string;
  amount: number;
  memo?: string;
  /** Required when the account has confirmed 2FA (`POST /wallet/withdraw` body `totp`). */
  totp?: string;
}
