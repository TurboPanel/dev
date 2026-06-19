import { useWindowSize } from "ink";

export const HEADER_ROWS = 1;

/**
 * Ink moves the cursor to `lines.length + 1` after drawing. If the app fills
 * the whole terminal, that targets one row past the bottom and many terminals
 * scroll, pushing the footer off-screen. Reserve the last row so app height is
 * strictly less than the terminal height.
 */
const BOTTOM_SAFETY_ROWS = 1;

/**
 * Live terminal size (re-renders on resize). `appHeight` is the height the root
 * box should occupy; `mainHeight` is the row budget for the main area after
 * the menu bar and footer.
 */
export function useTerminalLayout(footerRows: number) {
  const { rows, columns } = useWindowSize();
  const appHeight = Math.max(1, rows - BOTTOM_SAFETY_ROWS);
  const mainHeight = Math.max(1, appHeight - HEADER_ROWS - footerRows);

  return { rows, columns, appHeight, mainHeight };
}
