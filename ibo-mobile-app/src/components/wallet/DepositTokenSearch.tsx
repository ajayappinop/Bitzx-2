import React, { useMemo } from 'react';
import {
  View, Text, TextInput, StyleSheet, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import CoinIcon from '../common/CoinIcon';
import Icon from '../common/AppIcon';
import { Colors, FontFamily, FontSize, Radius, Spacing } from '../../theme';
import type { DepositCatalogItem } from '../../hooks/useDepositCatalog';
import { PRIORITY_ASSETS } from '../../hooks/useDepositCatalog';
import { useResolvedCoinLogo } from '../../hooks/useCoinLogoUrl';

type Props = {
  items: DepositCatalogItem[];
  value: string;
  onSelect: (asset: string, item: DepositCatalogItem) => void;
  query: string;
  onQueryChange: (q: string) => void;
  loading?: boolean;
  error?: string | null;
  bep20Meta?: Record<string, unknown> | null;
  total?: number;
};

const QUICK_PICK_LIMIT = 10;
const SEARCH_RESULT_LIMIT = 40;

function buildQuickPicks(items: DepositCatalogItem[]): DepositCatalogItem[] {
  const out: DepositCatalogItem[] = [];
  const seen = new Set<string>();

  const add = (it: DepositCatalogItem | undefined) => {
    if (!it) return;
    const key = `${it.asset}|${it.network}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(it);
  };

  for (const sym of PRIORITY_ASSETS) {
    add(items.find((it) => it.asset === sym));
  }
  for (const it of items) {
    if (it.is_listed) add(it);
    if (out.length >= QUICK_PICK_LIMIT) break;
  }
  if (out.length < QUICK_PICK_LIMIT) {
    for (const it of items) {
      add(it);
      if (out.length >= QUICK_PICK_LIMIT) break;
    }
  }
  return out.slice(0, QUICK_PICK_LIMIT);
}

function DepositTokenRow({
  item, active, onSelect,
}: {
  item: DepositCatalogItem;
  active: boolean;
  onSelect: (asset: string, item: DepositCatalogItem) => void;
}) {
  const logoUrl = useResolvedCoinLogo(item.asset, item.logo_url);
  return (
    <TouchableOpacity
      style={[styles.row, active && styles.rowActive]}
      onPress={() => onSelect(item.asset, item)}
      activeOpacity={0.75}
    >
      <CoinIcon symbol={item.asset} logoUrl={logoUrl} size={28} />
      <View style={styles.rowBody}>
        <View style={styles.assetRow}>
          <Text style={styles.asset}>{item.asset}</Text>
          {item.is_listed ? (
            <Text style={styles.listedBadge}>Listed</Text>
          ) : null}
        </View>
        <Text style={styles.sub} numberOfLines={1}>{item.token_name}</Text>
      </View>
      {active ? <Icon name="check" size={18} color={Colors.goldLight} /> : null}
    </TouchableOpacity>
  );
}

export default function DepositTokenSearch({
  items, value, onSelect, query, onQueryChange, loading, error, bep20Meta, total,
}: Props) {
  const trimmedQuery = query.trim();
  const searching = trimmedQuery.length > 0;

  const searchResults = useMemo(() => {
    const q = trimmedQuery.toUpperCase();
    if (!q) return [];
    return items.filter((it) =>
      it.asset.includes(q)
      || it.token_name.toUpperCase().includes(q)
      || it.contract_address.toUpperCase().includes(q),
    ).slice(0, SEARCH_RESULT_LIMIT);
  }, [items, trimmedQuery]);

  const quickPicks = useMemo(() => buildQuickPicks(items), [items]);
  const displayItems = searching ? searchResults : quickPicks;

  return (
    <View>
      <Text style={styles.label}>Search coin</Text>
      <View style={styles.searchRow}>
        <Icon name="magnify" size={20} color={Colors.textMuted} />
        <TextInput
          style={styles.input}
          placeholder="Search BEP-20 (IBO, USDT, …)"
          placeholderTextColor={Colors.textMuted}
          value={query}
          onChangeText={onQueryChange}
          autoCapitalize="characters"
          autoCorrect={false}
        />
        {query ? (
          <TouchableOpacity onPress={() => onQueryChange('')}>
            <Icon name="close-circle" size={18} color={Colors.textMuted} />
          </TouchableOpacity>
        ) : null}
      </View>
      {bep20Meta?.enabled ? (
        <Text style={styles.note}>Universal BEP-20 deposit address enabled on BNB Chain.</Text>
      ) : null}
      {!searching ? (
        <Text style={styles.hint}>
          Popular tokens below. Type a name or symbol to search the full catalog
          {(total != null && total > QUICK_PICK_LIMIT) ? ` (${total.toLocaleString()}+ coins).` : '.'}
        </Text>
      ) : null}
      {loading ? <ActivityIndicator color={Colors.goldLight} style={{ marginVertical: 12 }} /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {!searching && displayItems.length > 0 ? (
        <Text style={styles.sectionTitle}>Popular</Text>
      ) : null}
      {searching && !loading ? (
        <Text style={styles.sectionTitle}>
          {searchResults.length ? `Results (${searchResults.length})` : 'No matches'}
        </Text>
      ) : null}

      {displayItems.length === 0 && !loading ? (
        <Text style={styles.empty}>
          {searching ? 'No tokens match your search.' : 'No deposit tokens available.'}
        </Text>
      ) : (
        displayItems.map((item) => (
          <DepositTokenRow
            key={`${item.asset}|${item.network}`}
            item={item}
            active={value === item.asset}
            onSelect={onSelect}
          />
        ))
      )}

      {searching && searchResults.length >= SEARCH_RESULT_LIMIT ? (
        <Text style={styles.count}>Refine your search for more results</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: Spacing[2],
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.surfaceBorder,
    backgroundColor: Colors.surfaceElevated,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing[3],
    minHeight: 48,
  },
  input: {
    flex: 1,
    fontFamily: FontFamily.medium,
    fontSize: FontSize.md,
    color: Colors.textPrimary,
    paddingVertical: 10,
  },
  note: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    marginTop: Spacing[2],
  },
  hint: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    marginTop: Spacing[2],
    lineHeight: 16,
  },
  sectionTitle: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    marginTop: Spacing[3],
    marginBottom: Spacing[1],
  },
  error: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.sm,
    color: Colors.danger,
    marginTop: Spacing[2],
  },
  empty: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.sm,
    color: Colors.textMuted,
    paddingVertical: Spacing[4],
    textAlign: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[3],
    paddingVertical: Spacing[3],
    paddingHorizontal: Spacing[3],
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: 'transparent',
    marginTop: Spacing[1],
  },
  rowActive: {
    backgroundColor: Colors.goldAlpha10,
    borderColor: Colors.goldAlpha30,
  },
  rowBody: { flex: 1, minWidth: 0 },
  assetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  asset: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.md,
    color: Colors.textPrimary,
  },
  listedBadge: {
    fontFamily: FontFamily.bold,
    fontSize: 9,
    color: Colors.goldLight,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: Colors.goldAlpha30,
    backgroundColor: Colors.goldAlpha15,
  },
  sub: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    marginTop: 2,
  },
  count: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    marginTop: Spacing[2],
    textAlign: 'center',
  },
});
