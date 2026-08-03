/**
 * Options WebSocket feeds — mirrors ibo-exchange optionsApi.js reconnect pattern.
 */
import wsManager from './websocket.service';
import { optionsWsUrl } from '../config/wsConfig';
import StorageService from './storage.service';
import { STORAGE_KEYS } from '../config/storageKeys';

export function subscribeOptionsChain(
  underlyingSymbol: string,
  handler: (data: unknown) => void,
): () => void {
  const sym = underlyingSymbol.toUpperCase();
  const url = optionsWsUrl(`/ws/options/chain?underlying_symbol=${encodeURIComponent(sym)}`);
  return wsManager.subscribe(`options_chain_${sym}`, url, handler);
}

export async function subscribeOptionsAccount(
  handler: (data: unknown) => void,
): Promise<() => void> {
  const token = await StorageService.get(STORAGE_KEYS.TOKEN);
  if (!token) return () => {};
  const url = optionsWsUrl(`/ws/options/account?token=${encodeURIComponent(token)}`);
  return wsManager.subscribe('options_account', url, handler);
}

export function subscribeOptionsTicker(
  contractId: string,
  handler: (data: unknown) => void,
): () => void {
  const url = optionsWsUrl(`/ws/options/ticker?contract_id=${encodeURIComponent(contractId)}`);
  return wsManager.subscribe(`options_ticker_${contractId}`, url, handler);
}
