/**
 * Wallet network helpers — mirrors ibo-exchange `lib/walletNetworks.js`.
 */
import type { SupportedNetwork } from '../types/wallet.types';

const CHAIN_DISPLAY: Record<string, string> = {
  btc: 'Bitcoin',
  eth: 'Ethereum',
  bsc: 'BNB Smart Chain',
  tron: 'Tron',
  solana: 'Solana',
};

export function chainDisplayName(chainId?: string | null): string {
  const id = (chainId || '').toLowerCase();
  if (!id) return '';
  return CHAIN_DISPLAY[id] || id.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function filterDepositNetworks(list: SupportedNetwork[]): SupportedNetwork[] {
  return (list || []).filter((n) => n.deposit_enabled && n.status === 'active');
}

export function filterWithdrawNetworks(list: SupportedNetwork[]): SupportedNetwork[] {
  return (list || []).filter((n) => n.withdraw_enabled && n.status === 'active');
}

export function uniqueAssets(list: SupportedNetwork[]): string[] {
  const order: string[] = [];
  const seen = new Set<string>();
  for (const n of list || []) {
    if (!n.asset || seen.has(n.asset)) continue;
    seen.add(n.asset);
    order.push(n.asset);
  }
  return order;
}

export function networksForAsset(list: SupportedNetwork[], asset: string): SupportedNetwork[] {
  return (list || []).filter((n) => n.asset === asset);
}

export function activeNetworksForAsset(list: SupportedNetwork[], asset: string): SupportedNetwork[] {
  return networksForAsset(list, asset).filter((n) => n.deposit_enabled && n.status === 'active');
}

export function plannedNetworksForAsset(list: SupportedNetwork[], asset: string): SupportedNetwork[] {
  return networksForAsset(list, asset).filter((n) => n.status === 'coming_soon');
}

export type NetworkDetailRow = {
  label: string;
  value: string;
  highlight?: 'ok' | 'muted' | 'warn';
};

export function networkChainDetailRows(
  n: SupportedNetwork | null | undefined,
  { mode = 'deposit', compact = false }: { mode?: 'deposit' | 'withdraw'; compact?: boolean } = {},
): NetworkDetailRow[] {
  if (!n) return [];

  if (compact) {
    const rows: NetworkDetailRow[] = [];
    const chain = n.chain_display || chainDisplayName(n.chain_id);
    if (chain) rows.push({ label: 'Chain', value: chain });
    if (n.endpoint_label) rows.push({ label: 'RPC', value: n.endpoint_label });
    rows.push({ label: 'Env', value: n.testnet ? 'Testnet' : 'Mainnet' });
    if (mode === 'withdraw' && n.min_withdraw != null && n.min_withdraw > 0) {
      rows.push({ label: 'Min withdraw', value: `${n.min_withdraw} ${n.asset}` });
    }
    if (n.rpc_configured === false) {
      rows.push({ label: 'RPC status', value: 'Not configured', highlight: 'warn' });
    }
    return rows;
  }

  const rows: NetworkDetailRow[] = [];
  if (n.endpoint_label) rows.push({ label: 'RPC endpoint', value: n.endpoint_label });
  if (n.chain_display || n.chain_id) {
    rows.push({
      label: 'Blockchain',
      value: n.chain_display || chainDisplayName(n.chain_id),
    });
  }
  if (n.chain_id) rows.push({ label: 'Chain ID', value: String(n.chain_id).toLowerCase() });
  if (n.network) rows.push({ label: 'Network type', value: n.network });
  if (n.chain && n.chain !== n.chain_id) rows.push({ label: 'Chain variant', value: n.chain });
  rows.push({ label: 'Environment', value: n.testnet ? 'Testnet' : 'Mainnet' });
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

export function defaultAssetSelection(list: SupportedNetwork[]): { asset: string; network: string } {
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
