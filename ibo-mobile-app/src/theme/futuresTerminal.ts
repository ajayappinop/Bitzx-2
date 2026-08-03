import { Colors } from './colors';

/** Pro-trader futures terminal — long/buy uses standard trading green. */
export const FuturesUi = {
  long: Colors.buyGreen,
  longLight: Colors.buyGreen,
  longDim: Colors.buyGreenDim,
  longDimStrong: 'rgba(34, 197, 94, 0.22)',
  longBorder: 'rgba(34, 197, 94, 0.35)',
  short: Colors.sellRed,
  shortDim: Colors.sellRedDim,
  /** Order book ~40%, trade form ~60% (reference proportions). */
  bookFlex: 2,
  formFlex: 3,
  /** Base terminal height — fits default form + submit buttons without clipping. */
  terminalHeightRatio: 0.54,
  /** Reference-matched touch targets for the futures order form. */
  form: {
    fieldMinH: 40,
    fieldPadV: 6,
    stepBtn: 34,
    tabPadV: 9,
    dropdownMinH: 38,
    dropdownPadV: 8,
    ctaMinH: 44,
    ctaPadV: 12,
    sectionGap: 8,
  },
} as const;
