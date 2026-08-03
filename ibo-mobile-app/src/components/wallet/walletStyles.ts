import { StyleSheet } from 'react-native';
import { Colors, FontFamily, FontSize, Spacing, Radius } from '../../theme';

/** Horizontal padding used across all wallet tabs */
export const WALLET_H_PAD = Spacing[4];

export const walletStyles = StyleSheet.create({
  screenPad: {
    paddingHorizontal: WALLET_H_PAD,
  },
  section: {
    marginBottom: Spacing[4],
  },
  sectionTitle: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: Spacing[3],
  },
  card: {
    backgroundColor: Colors.surfaceCard,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: Radius.xl,
    overflow: 'hidden',
  },
  cardPad: {
    padding: Spacing[4],
  },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing[2],
    marginBottom: Spacing[4],
  },
  statBox: {
    flexBasis: '48%',
    flexGrow: 1,
    backgroundColor: Colors.surfaceCard,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: Radius.lg,
    padding: Spacing[4],
    minHeight: 72,
    justifyContent: 'center',
  },
  statLabel: {
    fontFamily: FontFamily.medium,
    fontSize: 9,
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: Spacing[1],
  },
  statValue: {
    fontFamily: FontFamily.monoMedium,
    fontSize: FontSize.base,
    color: Colors.textPrimary,
  },
  statSub: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    marginTop: 2,
  },
  segmented: {
    flexDirection: 'row',
    backgroundColor: Colors.surfaceCard,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: Radius.lg,
    padding: 3,
    marginBottom: Spacing[4],
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: Spacing[2],
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentBtnActive: {
    backgroundColor: Colors.goldAlpha15,
    borderWidth: 1,
    borderColor: Colors.goldAlpha30,
  },
  segmentTxt: {
    fontFamily: FontFamily.medium,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
  },
  segmentTxtActive: {
    color: Colors.goldLight,
    fontFamily: FontFamily.semiBold,
  },
  listCard: {
    backgroundColor: Colors.surfaceCard,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: Radius.xl,
    overflow: 'hidden',
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.surfaceBorder,
  },
  listRowLast: {
    borderBottomWidth: 0,
  },
  empty: {
    paddingVertical: Spacing[10],
    paddingHorizontal: Spacing[4],
    alignItems: 'center',
  },
  emptyText: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.sm,
    color: Colors.textMuted,
    textAlign: 'center',
  },
  error: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: Colors.sellRed,
    marginBottom: Spacing[3],
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing[2],
    marginBottom: Spacing[3],
  },
  chip: {
    paddingHorizontal: Spacing[3],
    paddingVertical: 6,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    backgroundColor: Colors.surfaceCard,
  },
  chipActive: {
    backgroundColor: Colors.goldAlpha15,
    borderColor: Colors.goldAlpha30,
  },
  chipTxt: {
    fontFamily: FontFamily.medium,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    textTransform: 'capitalize',
  },
  chipTxtActive: {
    color: Colors.goldLight,
  },
  actionBtn: {
    flex: 1,
    paddingVertical: Spacing[2],
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buyBtn: {
    backgroundColor: Colors.buyGreenDim,
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.28)',
  },
  sellBtn: {
    backgroundColor: Colors.sellRedDim,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.28)',
  },
  buyTxt: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.xs,
    color: Colors.buyGreen,
  },
  sellTxt: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.xs,
    color: Colors.sellRed,
  },
});
