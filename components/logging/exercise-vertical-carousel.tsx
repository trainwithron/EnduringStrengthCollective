"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, List, X } from "lucide-react";
import type { SessionExerciseEntry, SetLogEntry } from "@/lib/types";
import type { TrackedField } from "@/lib/exercise-fields";
import { ExerciseCard } from "./exercise-card";
import { ExerciseNoteCallout } from "./exercise-note-callout";

// Vertical-swipe variant of the exercise logging carousel
// (swipe_card_logging_and_spotter_nudge_idea.md, resolved 2026-09-14:
// swipe direction is now an athlete-facing preference, not a fixed
// decision — see exercise-swipe-carousel.tsx for the horizontal
// variant). Same data/mutation props and per-card content as that
// file, swiped up/down instead of left/right — closer to a feed-scroll
// feel, still a hard snap-stop per card rather than free momentum
// scroll.
//
// The horizontal mode's dot-row drag-scrubber doesn't map onto a
// vertical gesture, so this gets its own quick-nav affordance instead:
// a "zoom out" toggle that collapses to a plain vertical list of every
// exercise in its existing collapsed state — tap any item to jump
// straight into it, expanded.
export function ExerciseVerticalCarousel({
  exercises,
  lastTimeByExercise,
  ladderByExercise,
  coachNoteByExerciseName,
  readOnly,
  onSetChange,
  onSetAdded,
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
  // Same shared-strip mirror as exercise-swipe-carousel.tsx — kept
  // identical between both variants so the pinned-strip/next-preview
  // logic lives once, above whichever carousel is actually active.
  onActiveIndexChange?: (index: number) => void;
}) {
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    onActiveIndexChange?.(activeIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [overviewOpen, setOverviewOpen] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);

  function scrollToIndex(index: number) {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const slide = scroller.children[index] as HTMLElement | undefined;
    slide?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function handleScroll() {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const center = scroller.scrollTop + scroller.clientHeight / 2;
    let closest = 0;
    let closestDist = Infinity;
    Array.from(scroller.children).forEach((child, i) => {
      const el = child as HTMLElement;
      const childCenter = el.offsetTop + el.clientHeight / 2;
      const dist = Math.abs(childCenter - center);
      if (dist < closestDist) {
        closestDist = dist;
        closest = i;
      }
    });
    setActiveIndex(closest);
  }

  function jumpToExerciseExpanded(index: number) {
    const exercise = exercises[index];
    if (!exercise) return;
    setOverviewOpen(false);
    setExpandedId(exercise.id);
    // The carousel only remounts into view once overviewOpen flips back
    // to false — wait a frame so scrollToIndex has a real element to
    // measure/scroll to.
    requestAnimationFrame(() => scrollToIndex(index));
  }

  if (exercises.length === 0) return null;

  if (overviewOpen) {
    return (
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="font-body text-[11px] text-steel uppercase tracking-wide">All exercises</p>
          <button
            type="button"
            onClick={() => setOverviewOpen(false)}
            className="flex items-center gap-1 font-body text-[11px] text-steel uppercase tracking-wide active:text-rust transition-colors"
          >
            Close
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="flex flex-col gap-2">
          {exercises.map((exercise, i) => (
            <button
              key={exercise.id}
              type="button"
              onClick={() => jumpToExerciseExpanded(i)}
              className="text-left border border-steel/20 bg-surface/20 p-3 active:border-rust transition-colors"
            >
              <p className="font-body text-[11px] text-steel uppercase tracking-wide">
                Exercise {i + 1} of {exercises.length}
              </p>
              <p className="font-body text-sm text-chalk mt-0.5">{exercise.exerciseName}</p>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      {exercises.length > 1 && (
        <>
          <div className="flex items-center justify-center gap-1.5 mb-2">
            {exercises.map((ex, i) => (
              <span
                key={ex.id}
                className={`h-1.5 rounded-full transition-all ${
                  i === activeIndex ? "w-6 bg-rust" : "w-1.5 bg-steel/30"
                }`}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={() => setOverviewOpen(true)}
            aria-label="See all exercises"
            className="w-full flex items-center justify-center gap-1.5 mb-3 font-body text-[11px] text-steel uppercase tracking-wide active:text-rust transition-colors"
          >
            <List className="w-3.5 h-3.5" />
            See all {exercises.length} exercises
          </button>
        </>
      )}

      <div
        ref={scrollerRef}
        onScroll={handleScroll}
        className="flex flex-col overflow-y-auto snap-y snap-mandatory scroll-smooth gap-4 h-[65vh]"
        style={{ scrollbarWidth: "none" }}
      >
        {exercises.map((exercise) => {
          const expanded = expandedId === exercise.id;
          return (
            <div
              key={exercise.id}
              className="snap-center shrink-0 border border-steel/20 bg-surface/20 p-4"
            >
              <div className="flex items-center justify-between gap-2 mb-2">
                <p className="font-body text-[11px] text-steel uppercase tracking-wide">
                  Exercise {exercises.findIndex((e) => e.id === exercise.id) + 1} of {exercises.length}
                </p>
                <button
                  type="button"
                  onClick={() => setExpandedId(expanded ? null : exercise.id)}
                  className="flex items-center gap-1 font-body text-[11px] text-steel uppercase tracking-wide active:text-rust"
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
