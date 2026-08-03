/**
 * Axios API client — mirrors authFetch() 401→refresh→retry pattern from AuthContext.jsx.
 * Single in-flight refresh; all concurrent 401s are queued.
 */
import axios, { AxiosRequestConfig } from 'axios';
import { API_URL, API_TIMEOUT_MS } from '../config/env';
import { STORAGE_KEYS } from '../config/storageKeys';
import StorageService from '../services/storage.service';
import { parseApiError } from './errors';

export const apiClient = axios.create({
  baseURL: API_URL,
  timeout: API_TIMEOUT_MS,
  headers: { 'Content-Type': 'application/json' },
});

let isRefreshing = false;
let refreshQueue: Array<(token: string) => void> = [];
let _onSessionExpired: (() => void) | null = null;
let memoryAccessToken: string | null = null;

export function getMemoryAccessToken(): string | null {
  return memoryAccessToken;
}

/** Register a callback to handle complete session expiry (navigate to Login). */
export function setSessionExpiredHandler(cb: () => void) {
  _onSessionExpired = cb;
}

// ── Request interceptor — attach Bearer token ─────────────────────────────
apiClient.interceptors.request.use(async (config) => {
  const token = memoryAccessToken ?? await StorageService.get(STORAGE_KEYS.TOKEN);
  if (token) {
    memoryAccessToken = token;
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ── Response interceptor — 401 → refresh → retry ─────────────────────────
apiClient.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config as AxiosRequestConfig & { _retry?: boolean };

    if (error.response?.status === 401 && !original._retry) {
      if (isRefreshing) {
        return new Promise<unknown>((resolve, reject) =>
          refreshQueue.push((token) => {
            if (!original.headers) original.headers = {};
            (original.headers as Record<string, string>).Authorization = `Bearer ${token}`;
            original._retry = true;
            resolve(apiClient(original));
          }),
        );
      }

      original._retry = true;
      isRefreshing = true;

      try {
        const refreshToken = await StorageService.get(STORAGE_KEYS.REFRESH);
        if (!refreshToken) throw new Error('No refresh token');

        const { data } = await apiClient.post('/api/auth/refresh', {
          refresh_token: refreshToken,
        });

        await StorageService.set(STORAGE_KEYS.TOKEN, data.access_token);
        memoryAccessToken = data.access_token;
        if (data.refresh_token) {
          await StorageService.set(STORAGE_KEYS.REFRESH, data.refresh_token);
        }

        refreshQueue.forEach((cb) => cb(data.access_token));
        refreshQueue = [];

        if (!original.headers) original.headers = {};
        (original.headers as Record<string, string>).Authorization = `Bearer ${data.access_token}`;
        return apiClient(original);
      } catch {
        refreshQueue = [];
        await StorageService.clearAll();
        _onSessionExpired?.();
        return Promise.reject(parseApiError(error));
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(parseApiError(error));
  },
);

export default apiClient;
