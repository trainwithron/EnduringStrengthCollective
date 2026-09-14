"use client";

import { useRef, useState } from "react";
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
export function ExerciseSwipeCarousel({
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
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

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

  if (exercises.length === 0) return null;

  return (
    <div>
      {/* Position dots double as quick-jump targets — a coach's day plan
          is usually short enough (2-6 exercises) that this reads as a
          real nav aid, not clutter. */}
      {exercises.length > 1 && (
        <div className="flex items-center justify-center gap-1.5 mb-3">
          {exercises.map((ex, i) => (
            <button
              key={ex.id}
              type="button"
              aria-label={`Go to ${ex.exerciseName}`}
              onClick={() => scrollToIndex(i)}
              className={`h-1.5 rounded-full transition-all ${
                i === activeIndex ? "w-6 bg-rust" : "w-1.5 bg-steel/30"
              }`}
            />
          ))}
        </div>
      )}

      <div
        ref={scrollerRef}
        onScroll={handleScroll}
        className="flex overflow-x-auto snap-x snap-mandatory scroll-smooth -mx-5 px-5 gap-4"
        style={{ scrollbarWidth: "none" }}
      >
        {exercises.map((exercise) => {
          const expanded = expandedId === exercise.id;
          return (
            <div
              key={exercise.id}
              className="snap-center shrink-0 w-full border border-steel/20 bg-surface/20 p-4"
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
