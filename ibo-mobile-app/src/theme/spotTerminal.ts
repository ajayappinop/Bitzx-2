import { Colors } from './colors';

/** Spot trade terminal — IBO chrome (gold) + standard buy/sell colors on book & form. */
export const SpotUi = {
  long: Colors.buyGreen,
  longDim: Colors.buyGreenDim,
  brand: Colors.gold,
  brandDim: Colors.goldAlpha15,
  short: Colors.sellRed,
  bookFlex: 2,
  formFlex: 3,
  terminalHeightRatio: 0.54,
} as const;
