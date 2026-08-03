import { walletApi } from '../api/wallet.api';
import type { IboSwapConfig } from '../types/wallet.types';

let cache: IboSwapConfig | null = null;
let inflight: Promise<IboSwapConfig> | null = null;

export async function getSwapConfigCached(force = false): Promise<IboSwapConfig> {
  if (!force && cache) return cache;
  if (!force && inflight) return inflight;
  inflight = walletApi.getSwapConfig()
    .then((res) => {
      cache = res.data;
      return res.data;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function clearSwapConfigCache(): void {
  cache = null;
}
