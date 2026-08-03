import apiClient from './client';
import { EP } from './endpoints';

export type PublicFeeConfig = {
  spot: { maker_fee_rate: number; taker_fee_rate: number };
  futures: { maker_fee_rate: number; taker_fee_rate: number };
  options: { maker_fee_rate: number; taker_fee_rate: number };
  p2p_taker_fee_pct: number;
  withdraw_fee_rate: number;
  deposit_fee_rate: number;
  referral_commission_rate: number;
};

export type PublicExchangeSettings = {
  maintenance_mode: boolean;
  trading_enabled: boolean;
  wallet_enabled: boolean;
  kyc_enabled: boolean;
  signup_enabled: boolean;
  login_enabled: boolean;
  withdraw_min_usdt: number;
  withdraw_max_usdt: number;
  withdraw_daily_limit_usdt: number;
  deposit_min_confirmations: number;
  default_quote_currency: string;
  supported_display_currencies: string[];
};

export const publicApi = {
  getFeeConfig: () => apiClient.get<PublicFeeConfig>(EP.PUBLIC_FEE_CONFIG),
  getExchangeSettings: () => apiClient.get<PublicExchangeSettings>(EP.PUBLIC_EXCHANGE_SETTINGS),
};
