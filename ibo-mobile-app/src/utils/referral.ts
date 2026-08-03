const PLAY_STORE_PACKAGE = 'com.ibomobileapp';
const DEFAULT_WEB_REGISTER = 'https://exchange.ibo.io/register';

function appendRef(baseUrl: string, code: string): string {
  const base = baseUrl.trim();
  const ref = code.trim();
  if (!base || !ref) return '';
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}ref=${encodeURIComponent(ref)}`;
}

/** Referral share URL — Play Store first on mobile, then website, then sensible fallback. */
export function buildReferralShareLink(
  shareLinks: { playstore?: string; website?: string } | undefined,
  code: string | undefined,
): string {
  const ref = (code || '').trim();
  if (!ref) return '';

  const play = (shareLinks?.playstore || '').trim();
  if (play) return appendRef(play, ref);

  const web = (shareLinks?.website || '').trim();
  if (web) return appendRef(web, ref);

  const playFallback = `https://play.google.com/store/apps/details?id=${PLAY_STORE_PACKAGE}&referrer=ref%3D${encodeURIComponent(ref)}`;
  return playFallback || appendRef(DEFAULT_WEB_REGISTER, ref);
}

export function buildReferralChildrenMap<T extends { uid: string; referred_by?: string; level?: number; name?: string }>(
  referrals: T[] | undefined,
): Record<string, T[]> {
  const byParent: Record<string, T[]> = {};
  for (const row of referrals || []) {
    const parent = row.referred_by;
    if (!parent) continue;
    (byParent[parent] = byParent[parent] || []).push(row);
  }
  for (const key of Object.keys(byParent)) {
    byParent[key].sort((a, b) => {
      const la = Number(a.level) || 0;
      const lb = Number(b.level) || 0;
      if (la !== lb) return la - lb;
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
  }
  return byParent;
}
