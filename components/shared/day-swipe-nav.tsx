"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { SWIPE_EDGE_PX, swipeDirection } from "@/lib/day-swipe";

// Swipe left for the next day, right for the previous day, on a calendar day page (Ron, Nov 2). Touch only; a computer is unchanged. Draws nothing.
// Not a swipe: two fingers (zoom), a start at the screen's side (the phone's back gesture), a start in a text box or an open dialog, or inside something that scrolls sideways itself.
function ignoredStart(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"], [data-no-day-swipe]')) return true;
  for (let el: Element | null = target; el && el !== document.body; el = el.parentElement) {
    const overflowX = getComputedStyle(el).overflowX;
    if ((overflowX === "auto" || overflowX === "scroll") && el.scrollWidth > el.clientWidth) return true;
  }
  return false;
}

export function DaySwipeNav({ prevHref, nextHref }: { prevHref: string; nextHref: string }) {
  const router = useRouter();
  useEffect(() => {
    let start: { x: number; y: number; t: number } | null = null;
    const down = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (e.touches.length !== 1 || !touch || touch.clientX < SWIPE_EDGE_PX || touch.clientX > window.innerWidth - SWIPE_EDGE_PX || ignoredStart(e.target)) {
        start = null;
        return;
      }
      start = { x: touch.clientX, y: touch.clientY, t: Date.now() };
    };
    const up = (e: TouchEvent) => {
      const touch = e.changedTouches[0];
      if (!start || !touch) return;
      const direction = swipeDirection(touch.clientX - start.x, touch.clientY - start.y, Date.now() - start.t);
      start = null;
      // Replace, not push: the phone's back button goes back to the month, not through every day swiped past.
      if (direction) router.replace(direction === "next" ? nextHref : prevHref);
    };
    const cancel = () => {
      start = null;
    };
    document.addEventListener("touchstart", down, { passive: true });
    document.addEventListener("touchend", up, { passive: true });
    document.addEventListener("touchcancel", cancel, { passive: true });
    return () => {
      document.removeEventListener("touchstart", down);
      document.removeEventListener("touchend", up);
      document.removeEventListener("touchcancel", cancel);
    };
  }, [router, prevHref, nextHref]);
  return null;
}
