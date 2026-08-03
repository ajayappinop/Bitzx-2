/**
 * Encrypted storage service — wraps react-native-encrypted-storage.
 * Uses Keychain (iOS) and Keystore (Android) — NOT plain AsyncStorage.
 * Key names match web exchange: ibo_ex_token, ibo_ex_refresh, ibo_ex_user
 */
import EncryptedStorage from 'react-native-encrypted-storage';

const StorageService = {
  async get(key: string): Promise<string | null> {
    try {
      return await EncryptedStorage.getItem(key);
    } catch {
      return null;
    }
  },

  async set(key: string, value: string): Promise<void> {
    try {
      await EncryptedStorage.setItem(key, value);
    } catch {
      // Silent — storage write failure should not crash the app
    }
  },

  async remove(key: string): Promise<void> {
    try {
      await EncryptedStorage.removeItem(key);
    } catch {
      // Silent
    }
  },

  async clearAll(): Promise<void> {
    try {
      await EncryptedStorage.clear();
    } catch {
      // Silent
    }
  },

  async getJSON<T>(key: string): Promise<T | null> {
    const raw = await StorageService.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  },

  async setJSON(key: string, value: unknown): Promise<void> {
    await StorageService.set(key, JSON.stringify(value));
  },
};

export default StorageService;
