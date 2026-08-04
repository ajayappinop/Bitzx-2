/**
 * Account left-nav — Delta Exchange account app
 * https://www.delta.exchange/app/account/positions
 */

export const ACCOUNT_NAV_ITEMS = [
  { id: 'positions', label: 'Positions', to: '/account/positions' },
  { id: 'open-orders', label: 'Open Orders', to: '/account/open-orders' },
  { id: 'order-history', label: 'Order History', to: '/account/order-history' },
  { id: 'trade-history', label: 'Trade History', to: '/account/trade-history' },
  { id: 'pnl', label: 'P&L Analytics', to: '/account/pnl' },
  { id: 'balances', label: 'Balances', to: '/account/balances' },
  { id: 'deposits', label: 'Deposits', to: '/account/deposits' },
  { id: 'withdrawals', label: 'Withdrawals', to: '/account/withdrawals' },
  { id: 'bank-details', label: 'Bank Details', to: '/account/bank-details' },
  { id: 'transaction-logs', label: 'Transaction Logs', to: '/account/transaction-logs' },
  { id: 'transfer', label: 'Transfer', to: '/account/transfer' },
  { id: 'invoices', label: 'Invoices', to: '/account/invoices' },
  { id: 'profile', label: 'Profile', to: '/account/profile' },
  { id: 'security', label: 'Security', to: '/account/security' },
  { id: 'api-keys', label: 'API Keys', to: '/account/api-keys' },
  { id: 'preferences', label: 'Preferences', to: '/account/preferences' },
  { id: 'refer', label: 'Referrals', to: '/account/refer' },
];

/** @deprecated use ACCOUNT_NAV_ITEMS */
export const ACCOUNT_NAV = [
  { group: null, items: ACCOUNT_NAV_ITEMS },
];

export const ACCOUNT_SECTION_TITLES = {
  ...Object.fromEntries(ACCOUNT_NAV_ITEMS.map((i) => [i.id, i.label])),
  portfolio: 'P&L Analytics',
  kyc: 'KYC',
  support: 'Support',
  overview: 'Overview',
};

export function isAccountPath(pathname = '') {
  return pathname === '/account' || pathname.startsWith('/account/');
}
