/*
 * The main window's size and position, kept in `userData/window-state.json` and
 * restored on the next launch. A position that is no longer on any screen (a monitor was
 * unplugged) is dropped, so the window never opens out of sight.
 */
import { readFileSync, renameSync, writeFileSync } from "node:fs";

export interface ScreenArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  isMaximized: boolean;
}

export const DEFAULT_WINDOW_STATE: WindowState = { width: 1280, height: 820, isMaximized: false };
export const MINIMUM_WINDOW_SIZE = { width: 900, height: 600 };

/** How much of the window's title bar must be on a screen for the saved position to count. */
const VISIBLE_MARGIN = 80;

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : undefined;
}

function isOnSomeScreen(left: number, top: number, width: number, screenAreas: readonly ScreenArea[]): boolean {
  return screenAreas.some(
    (screenArea) =>
      left + width - VISIBLE_MARGIN >= screenArea.x &&
      left + VISIBLE_MARGIN <= screenArea.x + screenArea.width &&
      top >= screenArea.y &&
      top + VISIBLE_MARGIN <= screenArea.y + screenArea.height,
  );
}

/**
 * Turns whatever the state file held into usable bounds: sizes are clamped to the minimum and to
 * the largest screen, and a position off every screen is dropped (the window is then centred).
 *
 * @example
 * parseWindowState({ x: 5000, y: 0, width: 1000, height: 700 }, [{ x: 0, y: 0, width: 1440, height: 900 }]);
 * // { width: 1000, height: 700, isMaximized: false }
 */
export function parseWindowState(savedState: unknown, screenAreas: readonly ScreenArea[]): WindowState {
  if (typeof savedState !== "object" || savedState === null) return { ...DEFAULT_WINDOW_STATE };
  const fields = savedState as Record<string, unknown>;
  const largestWidth = Math.max(MINIMUM_WINDOW_SIZE.width, ...screenAreas.map((screenArea) => screenArea.width));
  const largestHeight = Math.max(MINIMUM_WINDOW_SIZE.height, ...screenAreas.map((screenArea) => screenArea.height));
  const width = Math.min(
    largestWidth,
    Math.max(MINIMUM_WINDOW_SIZE.width, readNumber(fields.width) ?? DEFAULT_WINDOW_STATE.width),
  );
  const height = Math.min(
    largestHeight,
    Math.max(MINIMUM_WINDOW_SIZE.height, readNumber(fields.height) ?? DEFAULT_WINDOW_STATE.height),
  );
  const windowState: WindowState = { width, height, isMaximized: fields.isMaximized === true };
  const left = readNumber(fields.x);
  const top = readNumber(fields.y);
  if (left !== undefined && top !== undefined && isOnSomeScreen(left, top, width, screenAreas)) {
    windowState.x = left;
    windowState.y = top;
  }
  return windowState;
}

/**
 * Reads the saved state; a missing or unreadable file gives the defaults.
 *
 * @example
 * const windowState = readWindowState(statePath, screen.getAllDisplays().map((display) => display.workArea));
 */
export function readWindowState(statePath: string, screenAreas: readonly ScreenArea[]): WindowState {
  try {
    return parseWindowState(JSON.parse(readFileSync(statePath, "utf8")), screenAreas);
  } catch {
    return { ...DEFAULT_WINDOW_STATE };
  }
}

/**
 * Saves the state through a temporary file and a rename, so a crash never leaves half a file.
 *
 * @example
 * writeWindowState(statePath, { ...window.getNormalBounds(), isMaximized: window.isMaximized() });
 */
export function writeWindowState(statePath: string, windowState: WindowState): void {
  try {
    const temporaryPath = `${statePath}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify(windowState)}\n`);
    renameSync(temporaryPath, statePath);
  } catch {
    /* Losing the window position is not worth an error dialog. */
  }
}
