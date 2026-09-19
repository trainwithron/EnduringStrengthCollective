"use client";

import { useEffect, useRef, useState } from "react";
import { SpotBusinessPanel } from "./spot-business-panel";
import { SpotClientsGroupsPanel } from "./spot-clients-groups-panel";
import { SpotBuilderPanel } from "./spot-builder-panel";

// the_spot_dropdown_widget_redesign_sept16.md "REVISED 2026-09-19" — the
// single swipeable 3-panel container that replaces the two separate
// 9/16 triggers. Native scroll-snap (same proven pattern as
// components/logging/exercise-swipe-carousel.tsx) rather than hand-
// rolled touch-event math — real swipe physics for free, and a
// tap-on-a-dot fallback for anyone who'd rather not swipe.
//
// Panel order, left to right: Business/calendar glance, Clients/Groups
// (the default landing — index 1), AI Program Builder. Center-anchored
// per Ron's own locked framing of the structure.
const PANEL_COUNT = 3;
const DEFAULT_INDEX = 1;
const BUILDER_INDEX = 2;

export function SpotPanel({
  groupId,
  onClose,
  initialAthleteId,
  initialAthleteName,
}: {
  groupId: string;
  onClose: () => void;
  initialAthleteId?: string | null;
  initialAthleteName?: string | null;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(initialAthleteId ? BUILDER_INDEX : DEFAULT_INDEX);

  // Position the scroller on open without an animated scroll — this is
  // the panel's very first paint, not a user-driven navigation.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const child = scroller.children[activeIndex] as HTMLElement | undefined;
    if (child) scroller.scrollLeft = child.offsetLeft;
    // Deliberately once-on-mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleScroll() {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const center = scroller.scrollLeft + scroller.clientWidth / 2;
    let closest = 0;
    let closestDist = Infinity;
    Array.from(scroller.children).forEach((child, i) => {
      const el = child as HTMLElement;
      const childCenter = el.offsetLeft + el.clientWidth / 2;
      const dist = Math.abs(childCenter - center);
      if (dist < closestDist) {
        closestDist = dist;
        closest = i;
      }
    });
    setActiveIndex(closest);
  }

  function scrollToIndex(index: number) {
    // Reflects the tap immediately rather than waiting for the smooth-
    // scroll animation's own scroll events to settle and recompute it —
    // a tapped dot is explicit user intent, not something that should
    // lag behind however long the browser's scroll animation takes.
    setActiveIndex(index);
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const slide = scroller.children[index] as HTMLElement | undefined;
    slide?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }

  return (
    <div>
      <div
        ref={scrollerRef}
        onScroll={handleScroll}
        className="flex overflow-x-auto snap-x snap-mandatory scroll-smooth"
        style={{ scrollbarWidth: "none" }}
      >
        <div className="snap-center shrink-0 w-full max-h-[65vh] overflow-y-auto pr-0.5">
          <SpotBusinessPanel groupId={groupId} />
        </div>
        <div className="snap-center shrink-0 w-full max-h-[65vh] overflow-y-auto pr-0.5">
          <SpotClientsGroupsPanel groupId={groupId} onNavigated={onClose} />
        </div>
        <div className="snap-center shrink-0 w-full max-h-[65vh] overflow-y-auto pr-0.5">
          <SpotBuilderPanel groupId={groupId} initialAthleteId={initialAthleteId} initialAthleteName={initialAthleteName} />
        </div>
      </div>

      <div className="flex items-center justify-center gap-1.5 mt-3">
        {Array.from({ length: PANEL_COUNT }).map((_, i) => (
          <button
            key={i}
            type="button"
            aria-label={`Go to panel ${i + 1}`}
            onClick={() => scrollToIndex(i)}
            className={`h-1.5 rounded-full transition-all ${i === activeIndex ? "w-6 bg-rust" : "w-1.5 bg-steel/30"}`}
          />
        ))}
      </div>
    </div>
  );
}
