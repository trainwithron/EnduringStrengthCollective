"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { panMetrics, scrollForThumb, type PanMetrics } from "@/lib/pan-strip";

// One week's days in a single row. The days share the width equally; only when they cannot all fit (at their narrowest) does the row scroll sideways. Then a thin
// quiet strip sits ABOVE the row (the bottom scrollbar is hidden) that shows where you are and can be dragged. You can also pan with Shift + the wheel, by dragging with
// the middle mouse button, or by swiping on a touch screen. The plain vertical wheel still scrolls the page.
export function WeekDayRow({ children }: { children: ReactNode }) {
  const scroller = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [metrics, setMetrics] = useState<PanMetrics>({ overflowing: false, thumbWidth: 0, thumbLeft: 0 });

  const measure = useCallback(() => {
    const el = scroller.current;
    const tr = track.current;
    if (!el) return;
    setMetrics(panMetrics(el.scrollLeft, el.clientWidth, el.scrollWidth, tr?.clientWidth ?? el.clientWidth));
  }, []);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    // Always start with the first day fully in view.
    el.scrollLeft = 0;
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    if (el.firstElementChild) ro?.observe(el.firstElementChild);
    const mo = typeof MutationObserver !== "undefined" ? new MutationObserver(measure) : null;
    mo?.observe(el, { childList: true });
    window.addEventListener("resize", measure);
    return () => {
      ro?.disconnect();
      mo?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [measure]);

  // Middle mouse button: drag the row sideways.
  function onMouseDown(e: React.MouseEvent) {
    if (e.button !== 1) return;
    const el = scroller.current;
    if (!el) return;
    e.preventDefault();
    const startX = e.clientX;
    const startLeft = el.scrollLeft;
    const move = (ev: MouseEvent) => {
      el.scrollLeft = startLeft - (ev.clientX - startX);
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  // Drag the thumb of the strip.
  function onThumbPointerDown(e: React.PointerEvent) {
    const el = scroller.current;
    const tr = track.current;
    if (!el || !tr) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startThumb = metrics.thumbLeft;
    const move = (ev: PointerEvent) => {
      el.scrollLeft = scrollForThumb(startThumb + (ev.clientX - startX), el.clientWidth, el.scrollWidth, tr.clientWidth);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  // Click on the empty part of the strip: jump toward that spot.
  function onTrackPointerDown(e: React.PointerEvent) {
    const el = scroller.current;
    const tr = track.current;
    if (!el || !tr) return;
    const rect = tr.getBoundingClientRect();
    el.scrollLeft = scrollForThumb(e.clientX - rect.left - metrics.thumbWidth / 2, el.clientWidth, el.scrollWidth, tr.clientWidth);
  }

  return (
    <div>
      <div
        ref={track}
        data-testid="week-pan-strip"
        onPointerDown={onTrackPointerDown}
        aria-hidden="true"
        className={`relative h-1.5 mb-2 rounded-full bg-steel/15 ${metrics.overflowing ? "" : "invisible"}`}
      >
        <div
          onPointerDown={onThumbPointerDown}
          className="absolute top-0 h-full rounded-full bg-steel/50 hover:bg-steel/70 cursor-grab touch-none"
          style={{ width: metrics.thumbWidth, left: metrics.thumbLeft }}
        />
      </div>
      <div
        ref={scroller}
        data-testid="week-day-row"
        onScroll={measure}
        onMouseDown={onMouseDown}
        className="flex gap-4 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {children}
      </div>
    </div>
  );
}
