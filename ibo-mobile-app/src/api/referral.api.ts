import apiClient from './client';
import { EP } from './endpoints';

export interface ReferralLevelSummary {
  level: number;
  amount_ibo: number;
  referral_count: number;
  earned_ibo: number;
  pending_ibo: number;
  flat_overflow?: boolean;
  flat_from_level?: number;
}

export interface ReferralSummary {
  direct_referral_count: number;
  total_referral_count: number;
  total_earned_ibo: number;
  total_pending_ibo: number;
  levels: ReferralLevelSummary[];
}

export interface ReferralMeResponse {
  referral_code: string;
  referral_enabled: boolean;
  share_links: {
    website?: string;
    playstore?: string;
  };
  summary: ReferralSummary;
  referrals?: ReferralTreeEntry[];
}

export interface ReferralTreeEntry {
  uid: string;
  name?: string;
  email?: string;
  avatar_url?: string;
  level: number;
  joined_at?: string;
  kyc_status?: string;
  referred_by?: string;
  earned_from_this_referral_ibo?: number;
  pending_from_this_referral_ibo?: number;
}

export interface ReferralTreeResponse {
  referrals: ReferralTreeEntry[];
}

export const referralApi = {
  getMyReferralInfo: () => apiClient.get<ReferralMeResponse>(EP.REFERRAL_ME),
  getMyReferralTree: () => apiClient.get<ReferralTreeResponse>(EP.REFERRAL_TREE),
};
