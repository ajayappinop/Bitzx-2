import { StyleSheet } from 'react-native';
import { Colors, FontFamily, FontSize, Spacing, Radius } from '../../theme';

export const PROFILE_H_PAD = Spacing[4];

export const profileStyles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: Colors.surface,
  },
  scrollContent: {
    paddingBottom: Spacing[10],
  },
  pageHeader: {
    paddingHorizontal: PROFILE_H_PAD,
    paddingTop: Spacing[3],
    paddingBottom: Spacing[2],
  },
  pageTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
  },
  pageTitle: {
    fontFamily: FontFamily.bold,
    fontSize: FontSize['2xl'],
    color: Colors.textPrimary,
    letterSpacing: -0.5,
  },
  pageSubtitle: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    marginTop: 2,
  },
  heroCard: {
    marginHorizontal: PROFILE_H_PAD,
    marginBottom: Spacing[4],
    backgroundColor: Colors.goldAlpha10,
    borderWidth: 1,
    borderColor: Colors.goldAlpha30,
    borderRadius: Radius.xl,
    padding: Spacing[5],
    alignItems: 'center',
  },
  section: {
    paddingHorizontal: PROFILE_H_PAD,
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
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.surfaceBorder,
    marginLeft: Spacing[4] + 40 + Spacing[3],
  },
  subHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: PROFILE_H_PAD,
    paddingVertical: Spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder,
    backgroundColor: Colors.surface,
  },
  subHeaderTitle: {
    flex: 1,
    fontFamily: FontFamily.bold,
    fontSize: FontSize.lg,
    color: Colors.textPrimary,
    marginLeft: Spacing[1],
  },
  content: {
    padding: PROFILE_H_PAD,
    gap: Spacing[4],
  },
  empty: {
    paddingVertical: Spacing[10],
    alignItems: 'center',
  },
  emptyText: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.sm,
    color: Colors.textMuted,
    textAlign: 'center',
  },
  footer: {
    paddingHorizontal: PROFILE_H_PAD,
    paddingTop: Spacing[2],
    alignItems: 'center',
  },
  footerText: {
    fontFamily: FontFamily.regular,
    fontSize: 9,
    color: Colors.textMuted,
    letterSpacing: 0.3,
  },
});
