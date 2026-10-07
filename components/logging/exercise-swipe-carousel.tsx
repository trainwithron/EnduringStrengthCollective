"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { SessionExerciseEntry, SetLogEntry } from "@/lib/types";
import type { TrackedField } from "@/lib/exercise-fields";
import { ExerciseCard } from "./exercise-card";
import { ExerciseNoteCallout } from "./exercise-note-callout";

// Replaces the old scroll-past exercise list with a snap-to-card
// carousel (mobile_home_workout_tab_merge_idea.md /
// swipe_card_logging_and_spotter_nudge_idea.md) — one exercise per
// full-width card, swipe to advance, snap-stop rather than momentum
// scroll. Each card starts collapsed (the compact set grid, exactly as
// the old list rendered it) and can expand for more room — real estate
// the coach-note/tip callout below uses, not decoration.
function vibrateTick() {
  try {
    navigator.vibrate?.(15);
  } catch {
    // Vibration API unsupported/blocked — the scrubber still works
    // (just silently) without it.
  }
}

export function ExerciseSwipeCarousel({
  exercises,
  lastTimeByExercise,
  ladderByExercise,
  coachNoteByExerciseName,
  readOnly,
  onSetChange,
  onSetAdded,
  onSetRemoved,
  onRenamed,
  onTrackedFieldsChange,
  onDelete,
  deletingId,
  sessionId,
  groupId,
  athleteId,
  viewerId,
  canUploadVideo,
  onSetCompleted,
  gamificationEnabled,
  onActiveIndexChange,
}: {
  exercises: SessionExerciseEntry[];
  lastTimeByExercise: Record<string, { weight: number; reps: number }>;
  ladderByExercise: Record<string, string[]>;
  coachNoteByExerciseName: Record<string, string | null>;
  readOnly: boolean;
  onSetChange: (exerciseId: string, setId: string, patch: Partial<SetLogEntry>) => void;
  onSetAdded: (exerciseId: string, set: SetLogEntry) => void;
  onSetRemoved: (exerciseId: string, setId: string) => void;
  onRenamed: (exerciseId: string, name: string) => void;
  onTrackedFieldsChange: (exerciseId: string, fields: TrackedField[]) => void;
  onDelete: (exerciseId: string) => void;
  deletingId: string | null;
  sessionId: string;
  groupId: string;
  athleteId: string;
  viewerId: string | null;
  canUploadVideo: boolean;
  onSetCompleted: (set: SetLogEntry) => void;
  gamificationEnabled: boolean;
  // SessionLogger mirrors this into its own state to drive the shared
  // pinned-strip/next-exercise preview (SessionProgressStrip) above both
  // carousel variants — this component's own scroll/scrub mechanics are
  // otherwise completely untouched.
  onActiveIndexChange?: (index: number) => void;
}) {
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    onActiveIndexChange?.(activeIndex);
    // onActiveIndexChange is a fresh closure every render (SessionLogger
    // passes setActiveIndex inline) — only activeIndex itself should
    // retrigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const dotsRef = useRef<HTMLDivElement>(null);
  const scrubIndexRef = useRef<number | null>(null);
  // The scroller is as tall as the ACTIVE card, not the tallest card in the day. A flex row stretches every card to the tallest one (and reserves that height
  // for the row), which left a large empty dark area inside a short card (Johann, beta: "quite a bit of room at the bottom"). The height is measured, so it
  // follows the card as sets are added or removed and when the next exercise comes into view.
  const [activeHeight, setActiveHeight] = useState<number | null>(null);
  const activeExerciseId = exercises[Math.min(activeIndex, exercises.length - 1)]?.id;
  // After exercises are deleted the active index can point past the end: clamp it back.
  useEffect(() => {
    if (exercises.length > 0 && activeIndex > exercises.length - 1) setActiveIndex(exercises.length - 1);
  }, [exercises.length, activeIndex]);
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    const slide = scroller?.children[activeIndex] as HTMLElement | undefined;
    if (!scroller || !slide) return;
    // The row is overflow-y: hidden, but a browser still scrolls it to reveal a field focused in a neighbouring (taller) card; once the active card changes and
    // the row grows, that leftover offset would cut the top of the card off. Always show the top. The height is rounded UP so a fractional card height cannot
    // clip its bottom border or focus ring.
    scroller.scrollTop = 0;
    const measure = () => setActiveHeight(Math.ceil(slide.getBoundingClientRect().height));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(slide);
    return () => ro.disconnect();
    // The active exercise id is a dependency so a swap or reorder (same count) re-targets the observer to the right element.
  }, [activeIndex, activeExerciseId, exercises.length]);

  function scrollToIndex(index: number) {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const slide = scroller.children[index] as HTMLElement | undefined;
    slide?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }

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

  // Dragging anywhere across the dot row jumps directly to whichever
  // exercise the pointer is currently closest to — a real scrubber, not
  // just per-dot taps — with a haptic tick each time the drag crosses
  // into a new dot's zone. Pointer capture (same fix as
  // exercise-set-grid.tsx's swipe-to-fill) keeps the drag tracking even
  // once the finger moves off the row's own narrow height.
  //
  // Measures each dot's REAL rendered center rather than dividing the
  // row's bounding box evenly by count — the dots sit center-clustered
  // via justify-center (not edge-to-edge across the full row), and the
  // active dot is wider than the rest, so an even division doesn't
  // actually line up with where the dots render; verified live that an
  // even-division version was consistently one dot off.
  function handleScrubMove(clientX: number) {
    const row = dotsRef.current;
    if (!row) return;
    let closest = 0;
    let closestDist = Infinity;
    Array.from(row.children).forEach((child, i) => {
      const rect = (child as HTMLElement).getBoundingClientRect();
      const center = rect.left + rect.width / 2;
      const dist = Math.abs(clientX - center);
      if (dist < closestDist) {
        closestDist = dist;
        closest = i;
      }
    });
    if (closest !== scrubIndexRef.current) {
      scrubIndexRef.current = closest;
      vibrateTick();
      scrollToIndex(closest);
    }
  }

  if (exercises.length === 0) return null;

  return (
    <div>
      {/* Position dots double as a drag-to-scrub quick-jump — a coach's
          day plan is usually short enough (2-6 exercises) that this
          reads as a real nav aid, not clutter. */}
      {exercises.length > 1 && (
        <div
          ref={dotsRef}
          className="flex items-center justify-center gap-1.5 mb-3 py-2 touch-none"
          onPointerDown={(e) => {
            scrubIndexRef.current = null;
            try {
              e.currentTarget.setPointerCapture(e.pointerId);
            } catch {
              // Pointer capture unsupported/blocked — falls back to
              // requiring the finger to stay over the row.
            }
            handleScrubMove(e.clientX);
          }}
          onPointerMove={(e) => {
            if (e.buttons === 0) return;
            handleScrubMove(e.clientX);
          }}
          onPointerUp={(e) => {
            scrubIndexRef.current = null;
            try {
              e.currentTarget.releasePointerCapture(e.pointerId);
            } catch {
              // No-op if it was never captured.
            }
          }}
        >
          {exercises.map((ex, i) => (
            <button
              key={ex.id}
              type="button"
              aria-label={`Go to ${ex.exerciseName}`}
              onClick={() => scrollToIndex(i)}
              className={`h-1.5 rounded-full transition-all pointer-events-none ${
                i === activeIndex ? "w-6 bg-rust" : "w-1.5 bg-steel/30"
              }`}
            />
          ))}
        </div>
      )}

      <div
        ref={scrollerRef}
        onScroll={handleScroll}
        className="flex items-start overflow-x-auto overflow-y-hidden snap-x snap-mandatory scroll-smooth -mx-5 px-5 gap-4 transition-[height] duration-200 ease-out motion-reduce:transition-none"
        style={{ scrollbarWidth: "none", height: activeHeight ?? undefined }}
      >
        {exercises.map((exercise) => {
          const expanded = expandedId === exercise.id;
          return (
            <div
              key={exercise.id}
              data-exercise-id={exercise.id}
              className="snap-center shrink-0 w-full border border-steel/20 bg-surface/20 p-4"
            >
              <div className="flex items-center justify-between gap-2 mb-2">
                <p className="font-body text-xs text-steel uppercase tracking-wide">
                  Exercise {exercises.findIndex((e) => e.id === exercise.id) + 1} of {exercises.length}
                </p>
                <button
                  type="button"
                  onClick={() => setExpandedId(expanded ? null : exercise.id)}
                  className="flex items-center gap-1 min-h-[44px] px-2 -mr-2 font-body text-xs text-steel uppercase tracking-wide active:text-rust"
                >
                  {expanded ? "Less room" : "More room"}
                  {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </button>
              </div>

              {expanded && (
                <div className="mb-3">
                  <ExerciseNoteCallout coachNote={coachNoteByExerciseName[exercise.exerciseName] ?? null} />
                </div>
              )}

              <ExerciseCard
                exercise={exercise}
                lastTime={lastTimeByExercise[exercise.exerciseName]}
                ladder={ladderByExercise[exercise.exerciseName]}
                readOnly={readOnly}
                onSetChange={(setId, patch) => onSetChange(exercise.id, setId, patch)}
                onSetAdded={(set) => onSetAdded(exercise.id, set)}
                onSetRemoved={(setId) => onSetRemoved(exercise.id, setId)}
                onRenamed={(name) => onRenamed(exercise.id, name)}
                onTrackedFieldsChange={(fields) => onTrackedFieldsChange(exercise.id, fields)}
                onDelete={() => onDelete(exercise.id)}
                deleting={deletingId === exercise.id}
                sessionId={sessionId}
                groupId={groupId}
                athleteId={athleteId}
                viewerId={viewerId}
                canUpload={canUploadVideo}
                onSetCompleted={onSetCompleted}
                gamificationEnabled={gamificationEnabled}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
