// Day-column width preference for the coach's program builder — lets a
// coach widen columns to see every set box at once, or narrow them to fit
// more days on screen. Free-dragged via a resize handle on each column's
// right edge (grabbable near the bottom corner too), with a few preset
// shortcuts. Remembered per-browser via localStorage. All columns share one
// width — dragging any single column's handle resizes every column
// together.
export const CARD_WIDTH_PRESETS = {
  compact: 224,
  normal: 288,
  wide: 420,
} as const;

export type CardWidthKey = keyof typeof CARD_WIDTH_PRESETS;

export const CARD_WIDTH_STORAGE_KEY = "esc-builder-card-width";
export const MIN_CARD_WIDTH = 180;
export const MAX_CARD_WIDTH = 640;

export function clampCardWidth(px: number): number {
  return Math.min(MAX_CARD_WIDTH, Math.max(MIN_CARD_WIDTH, Math.round(px)));
}
