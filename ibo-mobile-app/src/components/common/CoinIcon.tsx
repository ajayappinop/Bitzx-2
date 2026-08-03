import React, { useEffect, useMemo, useState } from 'react';
import { Image, View, Text, StyleSheet } from 'react-native';
import { Colors, FontFamily } from '../../theme';
import { getCoinIconUrl, resolveCoinBase } from '../../utils/coinIcons';
import { API_URL } from '../../config/env';

export { COIN_ICONS, resolveCoinBase, getCoinIconUrl } from '../../utils/coinIcons';

interface Props {
  symbol: string;
  size?: number;
  /** Listed-token logo from deposit catalog (overrides static map). */
  logoUrl?: string;
}

export default function CoinIcon({ symbol, size = 36, logoUrl }: Props) {
  const base = resolveCoinBase(symbol);
  const fallbackUri = getCoinIconUrl(symbol);

  const normalizeLogoUri = (raw: string | undefined): string => {
    const s = String(raw ?? '').trim();
    if (!s) return '';
    if (s.startsWith('http://') || s.startsWith('https://')) return s;
    if (s.startsWith('//')) return `https:${s}`;
    const rel = s.startsWith('/') ? s : `/${s}`;
    return `${API_URL}${rel}`;
  };

  const candidates = useMemo(() => {
    const out: string[] = [];
    const primary = normalizeLogoUri(logoUrl);
    if (primary) out.push(primary);
    if (fallbackUri && !out.includes(fallbackUri)) out.push(fallbackUri);
    return out;
  }, [logoUrl, fallbackUri]);
  const [candidateIdx, setCandidateIdx] = useState(0);

  useEffect(() => {
    setCandidateIdx(0);
  }, [candidates]);

  const uri = candidates[candidateIdx];

  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={{ width: size, height: size, borderRadius: size / 2 }}
        resizeMode="contain"
        onError={() => setCandidateIdx((prev) => prev + 1)}
      />
    );
  }

  const label = (base || symbol || '?').slice(0, 3);

  return (
    <View style={[styles.fallback, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[styles.fallbackText, { fontSize: size * 0.35 }]}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: {
    backgroundColor: Colors.goldAlpha15,
    borderWidth: 1,
    borderColor: Colors.goldAlpha30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallbackText: {
    fontFamily: FontFamily.bold,
    color: Colors.goldLight,
    letterSpacing: 0.3,
  },
});
