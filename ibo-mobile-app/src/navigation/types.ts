import { NavigatorScreenParams } from '@react-navigation/native';
import { WalletTab } from '../types/wallet.tabs';

export type AuthStackParamList = {
  Login: { ref?: string } | undefined;
  Register: { ref?: string } | undefined;
  ForgotPassword: undefined;
  ResetPassword: { token?: string };
};

export type TradingStackParamList = {
  MarketsList:  undefined;
  IBOMarkets:   undefined;
  Trade:        { symbol: string; market?: 'spot'; side?: 'buy' | 'sell' };
  /** Same params as Trade but used in the Trade tab to avoid duplicate screen-name warning */
  TradePair:    { symbol: string; market?: 'spot'; side?: 'buy' | 'sell' };
  /** Full-screen spot chart (Trade tab header icon) */
  SpotChart: {
    symbol: string;
    market?: 'spot' | 'futures' | 'options';
    seedTicker?: Record<string, unknown>;
    seedOrderBook?: import('../types/market.types').OrderBook;
    leverage?: number;
  };
  /** Expanded candlestick chart */
  FullChartView: {
    symbol: string;
    market?: 'spot' | 'futures' | 'options';
    interval?: string;
    livePrice?: number;
    indicators?: string[];
  };
};

export type FuturesStackParamList = {
  DerivativesPair: { symbol: string; market: 'futures' | 'options'; side?: 'buy' | 'sell' };
  FuturesChart: {
    symbol: string;
    market?: 'spot' | 'futures' | 'options';
    seedTicker?: Record<string, unknown>;
    seedOrderBook?: import('../types/market.types').OrderBook;
    leverage?: number;
  };
  FullChartView: {
    symbol: string;
    market?: 'spot' | 'futures' | 'options';
    interval?: string;
    livePrice?: number;
    indicators?: string[];
  };
};

export type WalletStackParamList = {
  WalletHome: { tab?: WalletTab } | undefined;
  Deposit: { asset?: string; network?: string; embedded?: boolean };
  Withdraw: { asset?: string; embedded?: boolean };
  Transactions: { asset?: string };
  InrDeposit: undefined;
  InrDepositsHistory: undefined;
  InrWithdraw: undefined;
  InrWithdrawalsHistory: undefined;
  InrHistoryDetail: { kind: 'deposit' | 'withdrawal'; item: any };
};

export type ProfileStackParamList = {
  ProfileHome: undefined;
  /** Full feature directory (web Navbar “More” parity) */
  Explore: undefined;
  QuickTrade: undefined;
  P2PMarketplace: undefined;
  EditProfile: undefined;
  ListCoin: undefined;
  InrPayoutDetails: undefined;
  KYCStatus: undefined;
  KYCWizard: undefined;
  AutoKyc: { requestId?: string; status?: string } | undefined;
  Security: undefined;
  Sessions: undefined;
  ChangePassword: undefined;
  Support: undefined;
  TicketDetail: { ticketId: string };
  PnLAnalytics: undefined;
  ReferAndEarn: undefined;
};

export type MainTabParamList = {
  Dashboard: undefined;
  Markets: NavigatorScreenParams<TradingStackParamList>;
  Trade: NavigatorScreenParams<TradingStackParamList>;
  Futures: NavigatorScreenParams<FuturesStackParamList>;
  Wallet: NavigatorScreenParams<WalletStackParamList>;
};

export type RootStackParamList = {
  Auth: NavigatorScreenParams<AuthStackParamList>;
  Main: NavigatorScreenParams<MainTabParamList>;
  /** Profile stack — opened from Home / KYC flows, not a bottom tab */
  Profile: NavigatorScreenParams<ProfileStackParamList>;
};
