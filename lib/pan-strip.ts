// The thin pan strip above a week's days: where its thumb sits for a given scroll position, and the scroll position for a given thumb position.
// Pure so it can be tested; the strip itself is components/coach/desktop/week-day-row.tsx.

export interface PanMetrics {
  // True only when the content is wider than the visible row (otherwise there is nothing to pan and no strip is shown).
  overflowing: boolean;
  thumbWidth: number;
  thumbLeft: number;
}

const MIN_THUMB = 28;

export function panMetrics(scrollLeft: number, clientWidth: number, scrollWidth: number, trackWidth: number): PanMetrics {
  if (!(clientWidth > 0) || !(trackWidth > 0) || scrollWidth <= clientWidth + 1) return { overflowing: false, thumbWidth: trackWidth > 0 ? trackWidth : 0, thumbLeft: 0 };
  const thumbWidth = Math.min(trackWidth, Math.max(MIN_THUMB, (clientWidth / scrollWidth) * trackWidth));
  const maxScroll = scrollWidth - clientWidth;
  const maxThumb = trackWidth - thumbWidth;
  const clamped = Math.min(Math.max(scrollLeft, 0), maxScroll);
  return { overflowing: true, thumbWidth, thumbLeft: maxScroll > 0 ? (clamped / maxScroll) * maxThumb : 0 };
}

// The scroll position that puts the thumb's left edge at `thumbLeft` (dragging the thumb).
export function scrollForThumb(thumbLeft: number, clientWidth: number, scrollWidth: number, trackWidth: number): number {
  const m = panMetrics(0, clientWidth, scrollWidth, trackWidth);
  if (!m.overflowing) return 0;
  const maxThumb = trackWidth - m.thumbWidth;
  const maxScroll = scrollWidth - clientWidth;
  if (maxThumb <= 0) return 0;
  return Math.min(Math.max(thumbLeft / maxThumb, 0), 1) * maxScroll;
}
