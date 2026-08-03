export const ROLE_OPTIONS = [
  'superadmin',
  'operations',
  'compliance',
  'finance',
  'support',
  'viewer',
];

export const ROLE_PERMISSIONS = {
  superadmin: ['*'],
  operations: [
    'view_dashboard',
    'view_users',
    'view_kyc',
    'view_orders',
    'view_trades',
    'view_withdrawals',
    'view_markets',
    'view_analytics',
    'view_alerts',
    'run_surveillance',
    'view_system_logs',
    'view_support',
    'manage_support',
    'view_listings',
    'manage_listings',
  ],
  compliance: [
    'view_dashboard',
    'view_users',
    'view_kyc',
    'view_compliance',
    'manage_compliance',
    'run_surveillance',
    'view_alerts',
    'view_system_logs',
    'view_support',
    'manage_support',
  ],
  finance: [
    'view_dashboard',
    'view_orders',
    'view_trades',
    'view_withdrawals',
    'view_finance',
    'export_finance',
    'view_treasury',
    'manage_treasury',
    'view_hedger',
    'manage_hedger',
    'execute_hedger',
    'view_ledger',
    'adjust_wallets',
    'view_alerts',
    'view_system_logs',
    'view_support',
  ],
  support: [
    'view_dashboard',
    'view_users',
    'manage_users',
    'view_kyc',
    'view_orders',
    'view_trades',
    'view_withdrawals',
    'view_alerts',
    'view_system_logs',
    'view_hedger',
  ],
  viewer: [
    'view_dashboard',
    'view_users',
    'view_kyc',
    'view_orders',
    'view_trades',
    'view_withdrawals',
    'view_alerts',
    'view_markets',
    'view_analytics',
    'view_system_logs',
  ],
};

export const PERMISSION_GROUPS = [
  {
    title: 'Core',
    items: ['view_dashboard', 'view_settings', 'manage_settings', 'manage_admins'],
  },
  {
    title: 'User Operations',
    items: ['view_users', 'manage_users', 'adjust_wallets', 'view_kyc', 'view_withdrawals'],
  },
  {
    title: 'Trading',
    items: ['view_orders', 'view_trades', 'view_markets', 'view_analytics', 'run_surveillance'],
  },
  {
    title: 'Risk & Compliance',
    items: ['view_compliance', 'manage_compliance', 'view_alerts', 'view_security', 'manage_security_blocks', 'view_support', 'manage_support'],
  },
  {
    title: 'Finance & Infra',
    items: ['view_finance', 'export_finance', 'view_treasury', 'manage_treasury', 'view_hedger', 'manage_hedger', 'execute_hedger', 'view_ledger', 'view_system_logs'],
  },
];

export function getEffectivePermissions(admin) {
  if (!admin) return [];
  const explicit = Array.isArray(admin.permissions)
    ? admin.permissions.map((p) => String(p || '').trim()).filter(Boolean)
    : [];
  if (explicit.length) return explicit;
  const role = String(admin.role || 'support').toLowerCase();
  return ROLE_PERMISSIONS[role] || [];
}

export function hasPermission(admin, permission) {
  if (!permission) return true;
  const perms = getEffectivePermissions(admin);
  return perms.includes('*') || perms.includes(permission);
}

/** True if the admin has at least one of the listed permissions (or wildcard). */
export function hasAnyPermission(admin, permissions) {
  if (!permissions?.length) return true;
  return permissions.some((p) => hasPermission(admin, p));
}

