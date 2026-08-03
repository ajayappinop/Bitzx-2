/**
 * IBO Brand Color System
 * Exact match to ibo-exchange tailwind.config.js + index.css palette
 */

export const Colors = {
  // ── Brand accent (logo cyan → lime → blue) ───────────────
  gold: '#0EA4AB',
  goldLight: '#C5E35B',
  goldDark: '#1B5FFF',

  // ── Surfaces (navy backgrounds from logo) ────────────────
  surface: '#0a1024',
  surfaceDark: '#050a1a',
  surfaceCard: '#0d1530',
  surfaceBorder: '#1a2748',
  surfaceHover: '#121c38',
  surfaceElevated: '#101a36',

  // ── Text ─────────────────────────────────────────────────
  textPrimary: '#f4f4f5',
  textSecondary: '#a1a1aa',   // zinc-400
  textMuted: '#71717a',       // zinc-500
  textDisabled: '#52525b',    // zinc-600
  tabInactive: '#71717a',

  // ── Status ───────────────────────────────────────────────
  success: '#22c55e',
  successDim: 'rgba(34, 197, 94, 0.12)',
  danger: '#ef4444',
  dangerDim: 'rgba(239, 68, 68, 0.12)',
  warning: '#f59e0b',
  warningDim: 'rgba(245, 158, 11, 0.12)',
  info: '#3b82f6',
  infoDim: 'rgba(59, 130, 246, 0.12)',

  // ── Trading ──────────────────────────────────────────────
  buyGreen: '#22c55e',
  buyGreenDim: 'rgba(34, 197, 94, 0.15)',
  sellRed: '#ef4444',
  sellRedDim: 'rgba(239, 68, 68, 0.15)',

  // ── Transparency helpers ──────────────────────────────────
  goldAlpha15: 'rgba(14, 164, 171, 0.15)',
  goldAlpha30: 'rgba(14, 164, 171, 0.30)',
  goldAlpha10: 'rgba(14, 164, 171, 0.10)',
  goldLightAlpha35: 'rgba(197, 227, 91, 0.35)',
  white05: 'rgba(255, 255, 255, 0.05)',
  white08: 'rgba(255, 255, 255, 0.08)',
  white12: 'rgba(255, 255, 255, 0.12)',
  black40: 'rgba(0, 0, 0, 0.40)',
  black60: 'rgba(0, 0, 0, 0.60)',

  // ── Transparent ───────────────────────────────────────────
  transparent: 'transparent',
  white: '#ffffff',
  black: '#000000',
} as const;

/** Chart / market UI aliases (maxbyte parity). */
export const LayoutColors = {
  marketUp: Colors.buyGreen,
  marketDown: Colors.sellRed,
  canvas: Colors.surface,
  cardAlt: Colors.surfaceBorder,
} as const;

export type ColorKey = keyof typeof Colors;
