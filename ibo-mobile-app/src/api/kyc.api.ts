/**
 * KYC API client — wraps /api/kyc/* endpoints.
 */
import { Platform } from 'react-native';
import apiClient from './client';
import { EP } from './endpoints';
import { KYC_FACE_MATCH_TIMEOUT_MS, KYC_UPLOAD_TIMEOUT_MS } from '../config/env';
import type {
  KycStatusResponse,
  KycModeResponse,
  KycInitDigilockerResponse,
  KycPanVerifyResponse,
  KycFaceMatchResponse,
  KycUploadResponse,
} from '../types/kyc.types';

type ImageAsset = { uri: string; type?: string; fileName?: string };

function normalizeImageMime(type?: string | null): string {
  const t = String(type || '').trim().toLowerCase();
  if (!t || t === 'application/octet-stream' || t === 'binary/octet-stream') return 'image/jpeg';
  if (t === 'image/jpg') return 'image/jpeg';
  if (t.startsWith('image/')) return t;
  return 'image/jpeg';
}

function buildMultipartImagePart(asset: ImageAsset, fallbackName: string) {
  const rawName = (asset.fileName || fallbackName).trim() || fallbackName;
  const name = rawName.includes('.') ? rawName : `${rawName}.jpg`;
  const rawUri = String(asset.uri || '').trim();
  const uri = Platform.OS === 'ios' ? rawUri.replace('file://', '') : rawUri;
  return { uri, type: normalizeImageMime(asset.type), name };
}

/** React Native axios must not force application/json on multipart bodies. */
function postMultipart<T>(url: string, formData: FormData) {
  return apiClient.post<T>(url, formData, {
    timeout: KYC_UPLOAD_TIMEOUT_MS,
    headers: { Accept: 'application/json' },
    transformRequest: (data, headers) => {
      if (headers && typeof headers === 'object') {
        delete (headers as Record<string, unknown>)['Content-Type'];
      }
      return data;
    },
  });
}

export const kycApi = {
  /** GET /api/kyc/status */
  getStatus: () =>
    apiClient.get<KycStatusResponse>(EP.KYC_STATUS),

  /** GET /api/kyc/mode → { kyc_mode: 'manual' | 'auto' } */
  getMode: () =>
    apiClient.get<KycModeResponse>(EP.KYC_MODE),

  /** POST /api/kyc/digilocker/init → { url, request_id } */
  initDigilocker: (client: 'android' | 'ios' | 'web' = 'android') =>
    apiClient.post<KycInitDigilockerResponse>(EP.KYC_DIGILOCKER_INIT, { client }),

  /** POST /api/kyc/digilocker/complete — request_id optional; server uses stored session id. */
  completeDigilocker: (body?: { request_id?: string; code?: string }) =>
    apiClient.post<KycStatusResponse>(EP.KYC_DIGILOCKER_COMPLETE, body ?? {}),

  /** POST /api/kyc/pan/verify — backend field is `pan` (name/dob optional; filled from Aadhaar). */
  verifyPan: (pan: string, opts?: { name?: string; date_of_birth?: string }) =>
    apiClient.post<KycPanVerifyResponse>(EP.KYC_PAN_VERIFY, {
      pan: pan.trim().toUpperCase(),
      ...(opts?.name ? { name: opts.name } : {}),
      ...(opts?.date_of_birth ? { date_of_birth: opts.date_of_birth } : {}),
    }),

  /** POST /api/kyc/face-match — compares stored selfie vs ID photo (upload selfie first). */
  faceMatch: () =>
    apiClient.post<KycFaceMatchResponse>(EP.KYC_FACE_MATCH, {}, {
      timeout: KYC_FACE_MATCH_TIMEOUT_MS,
    }),

  /** POST /api/kyc/upload — document_front, document_back, and/or document_selfie */
  upload: (formData: FormData) =>
    postMultipart<KycUploadResponse>(EP.KYC_UPLOAD, formData),

  /** DELETE /api/kyc/upload/{side} — remove front | back | selfie */
  deleteUpload: (side: 'front' | 'back' | 'selfie') =>
    apiClient.delete<KycUploadResponse>(EP.KYC_UPLOAD_SIDE(side)),

  /** POST /api/kyc/submit */
  submit: (body: Record<string, unknown>) =>
    apiClient.post<KycStatusResponse>(EP.KYC_SUBMIT, body),
};
