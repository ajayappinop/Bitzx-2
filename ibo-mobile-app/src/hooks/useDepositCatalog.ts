import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { API_URL } from '../config/env';

export type DepositCatalogItem = {
  asset: string;
  network: string;
  chain_id: string;
  label: string;
  token_name: string;
  project_name: string;
  logo_url: string;
  contract_address: string;
  decimals: number;
  deposit_enabled: boolean;
  withdraw_enabled: boolean;
  status: string;
  testnet: boolean;
  listed_token_id: string | null;
  is_listed: boolean;
  universal_bep20: boolean;
  endpoint_label: string;
  chain_display: string;
  catalog_source: string;
  description: string;
};

const QUICK_FETCH_LIMIT = 32;
const SEARCH_FETCH_LIMIT = 50;

/** Platform + listed tokens only until the user searches (avoids loading 1000+ Web3 rows). */
const PRIORITY_ASSETS = ['IBO', 'USDT', 'BNB', 'ETH', 'BTC', 'USDC'] as const;

function normalizeCatalogItem(row: unknown): DepositCatalogItem | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  const asset = String(r.asset ?? '').trim().toUpperCase();
  const network = String(r.network ?? '').trim();
  if (!asset || !network) return null;
  return {
    asset,
    network,
    chain_id: r.chain_id != null ? String(r.chain_id).toLowerCase() : '',
    label: String(r.label ?? network).trim() || network,
    token_name: String(r.token_name ?? asset).trim() || asset,
    project_name: r.project_name != null ? String(r.project_name).trim() : '',
    logo_url: r.logo_url != null ? String(r.logo_url).trim() : '',
    contract_address: r.contract_address != null ? String(r.contract_address).trim() : '',
    decimals: Number(r.decimals) || 18,
    deposit_enabled: r.deposit_enabled === true,
    withdraw_enabled: r.withdraw_enabled === true,
    status: String(r.status ?? 'active').trim() || 'active',
    testnet: Boolean(r.testnet),
    listed_token_id: (r.listed_token_id as string | null) ?? null,
    is_listed: Boolean(r.is_listed),
    universal_bep20: Boolean(r.universal_bep20),
    endpoint_label: r.endpoint_label != null ? String(r.endpoint_label).trim() : '',
    chain_display: r.chain_display != null ? String(r.chain_display).trim() : '',
    catalog_source: r.catalog_source != null ? String(r.catalog_source) : '',
    description: r.description != null ? String(r.description) : '',
  };
}

/** Mobile signature: `useDepositCatalog(chain, enabled)`. */
export function useDepositCatalog(chain = 'bsc', enabled = true) {
  const [query, setQuery] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [items, setItems] = useState<DepositCatalogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [bep20Meta, setBep20Meta] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  const fetchPage = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(null);
    const searching = debouncedQ.length > 0;
    try {
      const params = new URLSearchParams({
        deposit_only: 'false',
        include_all_listed: 'true',
        include_web3_directory: searching ? 'true' : 'false',
        skip: '0',
        limit: String(searching ? SEARCH_FETCH_LIMIT : QUICK_FETCH_LIMIT),
        chain,
      });
      if (debouncedQ) params.set('q', debouncedQ);
      const res = await fetch(`${API_URL}/api/wallet/deposit-catalog?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const rawItems = Array.isArray(data?.items) ? (data.items as unknown[]) : [];
      const list = rawItems
        .map((row) => normalizeCatalogItem(row))
        .filter((x): x is DepositCatalogItem => x != null)
        .sort((a, b) => {
          const rank = (it: DepositCatalogItem) => {
            if (it.asset === 'IBO') return 0;
            if (it.is_listed) return 1;
            return 2;
          };
          const ra = rank(a);
          const rb = rank(b);
          if (ra !== rb) return ra - rb;
          return a.asset.localeCompare(b.asset);
        });
      setItems(list);
      setTotal(Number(data?.total) || list.length);
      setBep20Meta(data?.bep20_universal ?? null);
    } catch (e) {
      setItems([]);
      setTotal(0);
      setBep20Meta(null);
      setError((e as Error).message?.includes('Failed to fetch')
        ? 'Could not reach the API.'
        : 'Could not load deposit catalog.');
    } finally {
      setLoading(false);
    }
  }, [chain, debouncedQ, enabled]);

  useEffect(() => {
    void fetchPage();
  }, [fetchPage]);

  return {
    query,
    setQuery,
    items,
    total,
    bep20Meta,
    loading,
    error,
    refresh: fetchPage,
  };
}

export { normalizeCatalogItem, PRIORITY_ASSETS };
