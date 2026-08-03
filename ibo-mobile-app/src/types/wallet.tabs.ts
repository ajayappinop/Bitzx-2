export type WalletTab =
  | 'balances'
  | 'swap'
  | 'futures'
  | 'deposit'
  | 'withdraw'
  | 'history'
  | 'ledger';

export const WALLET_TABS: { id: WalletTab; label: string; icon: string }[] = [
  { id: 'balances', label: 'Spot', icon: 'wallet-outline' },
  { id: 'swap', label: 'Swap', icon: 'swap-horizontal' },
  { id: 'futures', label: 'Futures', icon: 'chart-line' },
  { id: 'deposit', label: 'Deposit', icon: 'arrow-down-circle-outline' },
  { id: 'withdraw', label: 'Withdraw', icon: 'arrow-up-circle-outline' },
  { id: 'history', label: 'History', icon: 'history' },
  { id: 'ledger', label: 'Ledger', icon: 'ticket-outline' },
];
