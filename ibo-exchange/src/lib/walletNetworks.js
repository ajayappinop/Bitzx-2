/**
 * Normalize GET /api/wallet/supported-networks for deposit/withdraw UIs.
 * Keeps exchange + mobile aligned with backend QuickNode registry.
 */

const CHAIN_DISPLAY = {
  btc: 'Bitcoin',
  eth: 'Ethereum',
  bsc: 'BNB Smart Chain',
  tron: 'Tron',
  solana: 'Solana',
};

/** Human-readable chain name from API ``chain_id``. */
export function chainDisplayName(chainId) {
  const id = (chainId || '').toLowerCase();
  if (!id) return '';
  return CHAIN_DISPLAY[id] || id.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function normalizeSupportedNetworks(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((row) => row && typeof row === 'object')
    .map((row) => {
      const asset = String(row.asset ?? '').trim();
      const network = String(row.network ?? '').trim();
      const label = String(row.label ?? '').trim() || network;
      const status = String(row.status ?? 'active').trim() || 'active';
      const depositExplicit = row.deposit_enabled;
      const withdrawExplicit = row.withdraw_enabled;
      const chainId = row.chain_id != null ? String(row.chain_id) : undefined;
      return {
        asset,
        network,
        label,
        chain: row.chain != null ? String(row.chain) : undefined,
        chain_id: chainId,
        chain_display: chainDisplayName(chainId),
        endpoint_label:
          row.endpoint_label != null ? String(row.endpoint_label).trim() : undefined,
        testnet: Boolean(row.testnet),
        status,
        deposit_enabled: status !== 'coming_soon' && depositExplicit === true,
        withdraw_enabled: status !== 'coming_soon' && withdrawExplicit === true,
        rpc_configured: row.rpc_configured !== false,
      };
    })
    .filter((n) => n.asset && n.network);
}

export function filterDepositNetworks(list) {
  return (list || []).filter((n) => n.deposit_enabled && n.status === 'active');
}

/** BEP-20 catalog row (listed, platform, or Web3) — deposit without Token Listings toggle. */
export function isCatalogDepositReady(item) {
  if (!item) return false;
  const status = item.status || 'active';
  if (status === 'coming_soon') return false;
  if (item.deposit_enabled && status === 'active') return true;
  if (item.universal_bep20) {
    const cid = (item.chain_id || '').toLowerCase();
    const net = item.network || '';
    return cid === 'bsc' || net.includes('BEP-20');
  }
  return false;
}

export function filterWithdrawNetworks(list) {
  return (list || []).filter((n) => n.withdraw_enabled && n.status === 'active');
}

export function comingSoonNetworks(list) {
  return (list || []).filter((n) => n.status === 'coming_soon');
}

/** All unique assets (includes coming-soon chains so every endpoint appears). */
export function uniqueAssets(list) {
  const order = [];
  const seen = new Set();
  for (const n of list || []) {
    if (!n.asset || seen.has(n.asset)) continue;
    seen.add(n.asset);
    order.push(n.asset);
  }
  return order;
}

/** Networks for the selected asset (active + coming soon). */
export function networksForAsset(list, asset) {
  return (list || []).filter((n) => n.asset === asset);
}

export function activeNetworksForAsset(list, asset) {
  return networksForAsset(list, asset).filter(
    (n) => n.deposit_enabled && n.status === 'active',
  );
}

export function plannedNetworksForAsset(list, asset) {
  return networksForAsset(list, asset).filter((n) => n.status === 'coming_soon');
}

/** Detail rows for the network panel (label + value). */
export function networkChainDetailRows(n, { mode = 'deposit' } = {}) {
  if (!n) return [];
  const rows = [];
  if (n.endpoint_label) {
    rows.push({ label: 'RPC endpoint', value: n.endpoint_label });
  }
  if (n.chain_display || n.chain_id) {
    rows.push({
      label: 'Blockchain',
      value: n.chain_display || chainDisplayName(n.chain_id),
    });
  }
  if (n.chain_id) {
    rows.push({ label: 'Chain ID', value: String(n.chain_id).toLowerCase() });
  }
  if (n.network) {
    rows.push({ label: 'Network type', value: n.network });
  }
  if (n.chain && n.chain !== n.chain_id) {
    rows.push({ label: 'Chain variant', value: n.chain });
  }
  rows.push({
    label: 'Environment',
    value: n.testnet ? 'Testnet' : 'Mainnet',
  });
  if (mode === 'deposit') {
    rows.push({
      label: 'Deposits',
      value: n.deposit_enabled ? 'Live — on-chain detection' : 'Not available',
      highlight: n.deposit_enabled ? 'ok' : 'muted',
    });
  } else {
    rows.push({
      label: 'Withdrawals',
      value: n.withdraw_enabled ? 'Enabled' : 'Not available',
      highlight: n.withdraw_enabled ? 'ok' : 'muted',
    });
  }
  if (n.rpc_configured === false) {
    rows.push({ label: 'RPC', value: 'Not configured', highlight: 'warn' });
  }
  return rows;
}

/** Pick default asset: first with an active deposit network, else first asset. */
export function defaultAssetSelection(list) {
  const assets = uniqueAssets(list);
  if (!assets.length) return { asset: '', network: '' };
  for (const a of assets) {
    const active = activeNetworksForAsset(list, a);
    if (active.length) return { asset: a, network: active[0].network };
  }
  const first = assets[0];
  const nets = networksForAsset(list, first);
  return { asset: first, network: nets[0]?.network || '' };
}
