// Keeps a floating box (tooltip, popover, menu) inside the screen. Anything positioned from a button's
// rectangle can land past an edge on a phone; these two helpers are the one place that is worked out.

export const VIEWPORT_MARGIN = 16;

// The widest the box may be: what it wants, but never more than the screen minus a margin on each side.
export function clampedWidth(desiredWidth: number, viewportWidth: number, margin = VIEWPORT_MARGIN): number {
  return Math.max(0, Math.min(desiredWidth, viewportWidth - margin * 2));
}

// The left edge for a box of `width` that would like to start at `desiredLeft`, pulled back inside the screen.
export function clampedLeft(desiredLeft: number, width: number, viewportWidth: number, margin = VIEWPORT_MARGIN): number {
  const maxLeft = viewportWidth - margin - width;
  if (maxLeft < margin) return margin;
  return Math.min(Math.max(desiredLeft, margin), maxLeft);
}

// Below the anchor when there is room for the box, otherwise above it; never off the top or bottom.
export function placeVertically(
  anchorTop: number,
  anchorBottom: number,
  height: number,
  viewportHeight: number,
  gap = 8,
  margin = VIEWPORT_MARGIN
): number {
  const below = anchorBottom + gap;
  if (below + height + margin <= viewportHeight) return below;
  const above = anchorTop - gap - height;
  if (above >= margin) return above;
  return Math.max(margin, Math.min(below, viewportHeight - margin - height));
}
