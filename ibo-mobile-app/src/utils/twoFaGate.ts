import type { TwoFAStatus } from '../types/auth.types';

/** Confirmed TOTP on the account — `POST /wallet/withdraw` must include `totp`. */
export function withdrawalRequiresTotp(status: TwoFAStatus | null | undefined): boolean {
  return Boolean(status?.enabled);
}

/**
 * Withdrawals are blocked until the user finishes 2FA enrollment (matches backend
 * when `required_for_withdrawal` is on and the user has no confirmed secret).
 */
export function withdrawalBlockedUntilTwoFaEnrolled(
  status: TwoFAStatus | null | undefined,
): boolean {
  return Boolean(status?.required_for_withdrawal && !status.enabled);
}
