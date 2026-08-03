/**
 * React Navigation deep-linking configuration.
 * URL scheme: ibo://  (configure in AndroidManifest.xml and Info.plist)
 * HTTPS fallback: https://app.ibo.in
 */
import type { LinkingOptions } from '@react-navigation/native';
import type { RootStackParamList } from './types';

export const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ['ibo://', 'https://app.ibo.in'],
  config: {
    screens: {
      Auth: {
        screens: {
          Login: 'login',
          Register: 'register',
          ForgotPassword: 'forgot-password',
          ResetPassword: {
            path: 'reset-password/:token?',
            parse: {
              token: (token: string | undefined) => token ?? '',
            },
          },
        },
      },
      Main: {
        screens: {
          Dashboard: 'home',
          Markets: {
            screens: {
              MarketsList: 'markets',
              IBOMarkets: 'markets/ibo',
              Trade: 'trade/:symbol',
              TradePair: 'pair/:symbol',
              SpotChart: 'chart/spot/:symbol',
            },
          },
          Trade: {
            screens: {
              TradePair: 'spot/:symbol',
            },
          },
          Futures: {
            screens: {
              DerivativesPair: 'futures/:symbol',
              FuturesChart: 'chart/futures/:symbol',
            },
          },
          Wallet: {
            screens: {
              WalletHome: 'wallet',
              Deposit: 'wallet/deposit/:asset',
              Withdraw: 'wallet/withdraw/:asset',
              Transactions: 'wallet/transactions',
              InrDeposit: 'wallet/inr/deposit',
              InrDepositsHistory: 'wallet/inr/deposits/history',
              InrWithdraw: 'wallet/inr/withdraw',
              InrWithdrawalsHistory: 'wallet/inr/withdrawals/history',
            },
          },
        },
      },
      Profile: {
        screens: {
          ProfileHome: 'profile',
          EditProfile: 'profile/edit',
          KYCStatus: 'kyc',
          KYCWizard: 'kyc/wizard',
          AutoKyc: 'kyc/:segment',
          Security: 'profile/security',
          Sessions: 'profile/sessions',
          ChangePassword: 'profile/password',
          Support: 'support',
          TicketDetail: 'support/tickets/:ticketId',
          PnLAnalytics: 'pnl',
          ListCoin: 'list-coin',
          InrPayoutDetails: 'profile/payout',
          Explore: 'explore',
          QuickTrade: 'quick-trade',
          P2PMarketplace: 'p2p',
        },
      },
    },
  },
};
