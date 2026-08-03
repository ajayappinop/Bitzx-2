/**
 * Central KYC flow routing — always pick AutoKyc vs manual wizard from server mode.
 */
import type { NavigationProp, ParamListBase } from '@react-navigation/native';
import type { KYCStatus } from '../types/auth.types';
import { getRootNavigation } from '../navigation/rootNavigation';
import { isKycApproved } from './kycGate';

export type KycMode = 'manual' | 'auto' | 'disabled';

export type KycFlowScreen = 'AutoKyc' | 'KYCWizard' | 'KYCStatus';

/** Which verification screen the user should enter (not yet approved). */
export function resolveKycFlowScreen(
  mode: KycMode | null | undefined,
  status: KYCStatus,
): KycFlowScreen {
  if (isKycApproved(status) || mode === 'disabled') return 'KYCStatus';
  if (!mode) return 'KYCStatus';
  return mode === 'auto' ? 'AutoKyc' : 'KYCWizard';
}

type Nav = Pick<NavigationProp<ParamListBase>, 'navigate'>;

/** Navigate from a nested tab into the Profile stack KYC flow. */
export function navigateToKycFlowFromRoot(
  navigation: Nav,
  mode: KycMode | null | undefined,
  status: KYCStatus,
) {
  const screen = resolveKycFlowScreen(mode, status);
  getRootNavigation(navigation).navigate('Profile', { screen });
}

/** Navigate inside ProfileStack. */
export function navigateToKycFlowInProfile(
  navigation: Nav,
  mode: KycMode | null | undefined,
  status: KYCStatus,
) {
  const screen = resolveKycFlowScreen(mode, status);
  navigation.navigate(screen);
}

export function normalizeKycMode(raw: string | undefined | null): KycMode {
  const s = String(raw ?? '').toLowerCase().trim();
  if (s === 'auto') return 'auto';
  if (s === 'disabled') return 'disabled';
  return 'manual';
}
