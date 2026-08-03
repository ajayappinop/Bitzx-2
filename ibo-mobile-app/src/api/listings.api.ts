import apiClient from './client';
import { EP } from './endpoints';
import { parseApiError } from './errors';
import type { ListingFormFields } from '../utils/listingValidation';

export type ListingSubmitResult = {
  ok: boolean;
  request_id: string;
  status: string;
  message: string;
};

export type ListedTokenPublic = {
  id: string;
  project_name?: string;
  token_name?: string;
  token_symbol: string;
  spot_symbol?: string;
  logo_url?: string;
  official_website?: string;
  trading_enabled?: boolean;
};

export type LogoUploadAsset = {
  uri: string;
  type?: string;
  name?: string;
};

export const listingsApi = {
  getNetworkOptions: async (): Promise<string[]> => {
    const { data } = await apiClient.get<{ networks?: string[] }>(EP.LISTINGS_NETWORK_OPTIONS);
    return data?.networks ?? [];
  },

  getListedTokens: async (): Promise<ListedTokenPublic[]> => {
    try {
      const { data } = await apiClient.get<{ items?: ListedTokenPublic[] }>(EP.LISTINGS_LISTED);
      return data?.items ?? [];
    } catch {
      return [];
    }
  },

  submitListing: async (
    form: ListingFormFields,
    logo: LogoUploadAsset,
  ): Promise<ListingSubmitResult> => {
    const fd = new FormData();
    const payload = {
      ...form,
      token_symbol: form.token_symbol.trim().toUpperCase(),
      project_name: form.project_name.trim(),
      token_name: form.token_name.trim(),
      contact_email: form.contact_email.trim().toLowerCase(),
      description: form.description.trim(),
    };
    Object.entries(payload).forEach(([k, v]) => {
      fd.append(k, v ?? '');
    });
    fd.append('logo', {
      uri: logo.uri,
      type: logo.type || 'image/jpeg',
      name: logo.name || 'logo.jpg',
    } as unknown as Blob);

    try {
      const { data } = await apiClient.post<ListingSubmitResult>(EP.LISTINGS_SUBMIT, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return data;
    } catch (err) {
      throw parseApiError(err);
    }
  },
};
