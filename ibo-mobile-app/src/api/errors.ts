import { Platform } from 'react-native';
import { ApiError, ValidationError } from '../types/api.types';
import { API_URL, IS_DEV, KYC_FACE_MATCH_TIMEOUT_MS, KYC_UPLOAD_TIMEOUT_MS } from '../config/env';

/**
 * Parse FastAPI error response — mirrors parseFastApi422FieldErrors + formatApiDetail
 * from authValidation.js in the web exchange.
 */
function isTransportFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { message?: string; code?: string; response?: unknown };
  if (e.response) return false;
  const msg = (e.message ?? '').toLowerCase();
  return (
    msg === 'network error'
    || msg.includes('network request failed')
    || e.code === 'ECONNABORTED'
    || e.code === 'ERR_NETWORK'
    || e.code === 'ENOTFOUND'
    || e.code === 'ECONNREFUSED'
  );
}

export function parseApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;

  if (isTransportFailure(error)) {
    const e = error as { message?: string; code?: string };
    if (e.code === 'ECONNABORTED') {
      return new ApiError(
        'The request timed out. Selfie upload and face verification can take up to 2 minutes — please wait and try again.',
        0,
      );
    }
    let hint = 'Cannot reach the server. Check your internet connection and try again.';
    const liveApi = API_URL.includes('api.ibo.io');
    if (IS_DEV) {
      const isAndroidEmuHost = Platform.OS === 'android' && API_URL.includes('10.0.2.2');
      if (isAndroidEmuHost) {
        hint =
          'Cannot reach the API. 10.0.2.2 only works on the Android emulator, not on a physical phone. '
          + 'In ibo-mobile-app/.env.local set API_URL to your PC Wi‑Fi IP (e.g. http://192.168.1.5:8000), '
          + 'run the backend on 0.0.0.0:8000, then rebuild: npx react-native run-android. '
          + 'Or use: adb reverse tcp:8000 tcp:8000 and API_URL=http://127.0.0.1:8000';
      } else if (liveApi) {
        hint =
          'Selfie upload or face verification failed to reach the live API. '
          + 'Your connection to api.ibo.io is working (DigiLocker succeeded) — retry and wait up to 2 minutes. '
          + 'If this keeps happening, rebuild the app after pulling the latest changes.';
      } else {
        hint = `Cannot reach the API at ${API_URL}. Check .env.local, ensure the backend is running, then rebuild the app.`;
      }
    } else if (liveApi) {
      hint =
        'Selfie verification could not reach the server. Please check your connection and try again — face match may take up to 2 minutes.';
    }
    return new ApiError(hint, 0);
  }

  if (error && typeof error === 'object' && 'response' in error) {
    const axiosErr = error as { response?: { status?: number; data?: unknown } };
    const status = axiosErr.response?.status ?? 500;
    const data = axiosErr.response?.data as Record<string, unknown> | undefined;

    if (data) {
      const detail = data.detail;

      // Array of FastAPI validation errors
      if (Array.isArray(detail)) {
        const fieldErrors: Record<string, string> = {};
        const msgs: string[] = [];
        (detail as ValidationError[]).forEach((e) => {
          const field = e.loc?.[e.loc.length - 1]?.toString() ?? 'field';
          fieldErrors[field] = e.msg;
          msgs.push(`${field}: ${e.msg}`);
        });
        const apiErr = new ApiError(msgs[0] ?? 'Validation error', status, detail);
        apiErr.fieldErrors = fieldErrors;
        return apiErr;
      }

      // String detail
      if (typeof detail === 'string') {
        return new ApiError(detail, status, detail);
      }

      // message fallback
      if (typeof data.message === 'string') {
        return new ApiError(data.message, status);
      }
    }

    return new ApiError(`Request failed (${status})`, status);
  }

  if (error instanceof Error) {
    return new ApiError(error.message, 0);
  }

  return new ApiError('An unexpected error occurred', 0);
}
