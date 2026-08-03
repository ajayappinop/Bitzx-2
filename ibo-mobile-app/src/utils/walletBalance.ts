import type { WalletAsset } from '../types/wallet.types';

const MXB_ALIASES = ['MXB', 'IBO', 'VSN', 'MBX'];

/** Resolve balance for a wallet asset key — handles MXB/IBO wire vs display aliases. */
export function findWalletAvailable(
  assets: WalletAsset[],
  assetKey: string,
): number {
  const key = String(assetKey || '').toUpperCase();
  const aliases = MXB_ALIASES.includes(key)
    ? MXB_ALIASES
    : [key];

  for (const alias of aliases) {
    const row = assets.find(
      (a) => String(a.asset ?? '').toUpperCase() === alias,
    );
    if (row) {
      const n = parseFloat(String(row.available_balance ?? 0));
      if (Number.isFinite(n)) return n;
    }
  }
  return 0;
}

export function findWalletTotal(
  assets: WalletAsset[],
  assetKey: string,
): number {
  const key = String(assetKey || '').toUpperCase();
  const aliases = MXB_ALIASES.includes(key) ? MXB_ALIASES : [key];
  for (const alias of aliases) {
    const row = assets.find(
      (a) => String(a.asset ?? '').toUpperCase() === alias,
    );
    if (row) {
      const avail = parseFloat(String(row.available_balance ?? 0));
      const locked = parseFloat(String(row.locked_balance ?? 0));
      if (Number.isFinite(avail) && Number.isFinite(locked)) return avail + locked;
    }
  }
  return 0;
}
