/** Shared density for spot/futures trading terminals (order book + form). */

/** Fallback when height is unknown. */
export const TERMINAL_BOOK_ROWS = 7;

/** Flex weights (StyleSheet). */
export const TERMINAL_PANEL_FLEX = 1;
export const TRADE_DATA_PANEL_FLEX = 0;

/** Fixed terminal height as % of window — matches reference (top panel ~54%). */
export const TERMINAL_HEIGHT_RATIO = 0.54;

/** Futures form is denser — slightly shorter terminal reduces dead space. */
export const FUTURES_TERMINAL_HEIGHT_RATIO = 0.50;
export const DATA_PANEL_HEIGHT_RATIO = 0.38;
export const DATA_PANEL_MIN_HEIGHT = 120;
export const DATA_PANEL_MAX_HEIGHT = 280;

/** Measured chrome heights for row budgeting (terminal variant). */
const BOOK_HEADER_H = 26;
const BOOK_MID_H = 42;
const BOOK_DEPTH_FOOTER_H = 26;
const BOOK_PANE_FOOTER_H = 26;
const BOOK_ROW_H = 21;

/**
 * Rows per side (asks / bids) so the book fills the terminal column
 * without scrolling — aligned to the buy/sell form height.
 * @param externalFooter — futures pane footer (B%/S% bar) instead of in-book depth bar
 */
export function computeTerminalBookRows(
  terminalHeight: number,
  externalFooter = false,
): number {
  if (!Number.isFinite(terminalHeight) || terminalHeight <= 0) {
    return TERMINAL_BOOK_ROWS;
  }
  const chrome = BOOK_HEADER_H + BOOK_MID_H
    + (externalFooter ? BOOK_PANE_FOOTER_H : BOOK_DEPTH_FOOTER_H);
  const budget = terminalHeight - chrome;
  const perSide = Math.floor(budget / 2 / BOOK_ROW_H);
  // Rows flex to fill the pane; allow more rows when the terminal grows (e.g. TP/SL).
  return Math.max(4, perSide);
}
