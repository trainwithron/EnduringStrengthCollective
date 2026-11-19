"use client";

import { confirmDialog } from "@/components/shared/confirm-dialog";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { saved } from "@/lib/saved";
import { ChevronDown, ChevronUp } from "lucide-react";
import { ExerciseNameInput } from "./exercise-name-input";

export type ExerciseTier = "A" | "B" | "C" | null;

export type MovementPlane = "sagittal" | "frontal" | "transverse" | null;

interface LadderItem {
  key: string;
  exerciseName: string;
  tier: ExerciseTier;
  // The one-sided version of the pattern (a single-arm row is a one-sided horizontal pull).
  unilateral?: boolean;
  // This exercise's own movement plane (Ron, Nov 19: "on each of the individual exercises, I need to be able to pick which movement plane").
  plane?: ExercisePlane;
}

// An exercise's plane is stored capitalized (movement_pattern_exercises.plane, migration 0161, which also allows "Multi-planar"); a pattern's own plane column is lowercase.
export type ExercisePlane = "Sagittal" | "Frontal" | "Transverse" | "Multi-planar" | null;
export const EXERCISE_PLANES = ["Sagittal", "Frontal", "Transverse"] as const;

export function MovementPatternRow({
  pattern,
  initialLadder,
  exerciseLibrary,
}: {
  pattern: { id: string; name: string };
  initialLadder: LadderItem[];
  exerciseLibrary: string[];
}) {
  const [expanded, setExpanded] = useState(false);
  const [ladder, setLadder] = useState<LadderItem[]>(
    initialLadder.length > 0
      ? initialLadder
      : [{ key: crypto.randomUUID(), exerciseName: "", tier: null, unilateral: false, plane: null }]
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();

  function updateItem(key: string, name: string) {
    setLadder((prev) =>
      prev.map((item) => (item.key === key ? { ...item, exerciseName: name } : item))
    );
  }

  function updateTier(key: string, tier: ExerciseTier) {
    setLadder((prev) => prev.map((item) => (item.key === key ? { ...item, tier } : item)));
  }

  function updateUnilateral(key: string, unilateral: boolean) {
    setLadder((prev) => prev.map((item) => (item.key === key ? { ...item, unilateral } : item)));
  }

  function updatePlane(key: string, plane: ExercisePlane) {
    setLadder((prev) => prev.map((item) => (item.key === key ? { ...item, plane } : item)));
  }

  function removeItem(key: string) {
    setLadder((prev) => prev.filter((item) => item.key !== key));
  }

  function moveItem(index: number, direction: -1 | 1) {
    setLadder((prev) => {
      const target = index + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = prev.slice();
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function handleSave() {
    const validItems = ladder
      .map((item) => ({ ...item, exerciseName: item.exerciseName.trim() }))
      .filter((item) => item.exerciseName.length > 0);

    if (validItems.length === 0) {
      setError("Add at least one exercise to the ladder.");
      return;
    }

    setSubmitting(true);
    setError(null);
    const supabase = createBrowserClient();

    // Nothing else references a specific ladder-exercise row's id (only the
    // pattern's own id is referenced elsewhere), so delete-all/reinsert is
    // safe here — unlike the workout builder's exercise list.
    const { error: deleteError } = await supabase
      .from("movement_pattern_exercises")
      .delete()
      .eq("movement_pattern_id", pattern.id);

    if (deleteError) {
      setError(deleteError.message);
      setSubmitting(false);
      return;
    }

    const { error: insertError } = await supabase.from("movement_pattern_exercises").insert(
      validItems.map((item, i) => ({
        movement_pattern_id: pattern.id,
        exercise_name: item.exerciseName,
        difficulty_rank: i,
        tier: item.tier,
        is_unilateral: !!item.unilateral,
        plane: item.plane ?? null,
      }))
    );

    if (insertError) {
      setError(insertError.message);
      setSubmitting(false);
      return;
    }

    setSubmitting(false);
    setExpanded(false);
    router.refresh();
  }

  async function handleDeletePattern() {
    if (!await confirmDialog(`Delete the "${pattern.name}" pattern? This can't be undone.`)) return;
    setSubmitting(true);
    const supabase = createBrowserClient();
    if (!(await saved(supabase.from("movement_patterns").delete().eq("id", pattern.id)))) {
      // The editor must not stay locked on "Saving…" after a failed delete.
      setSubmitting(false);
      return;
    }
    router.refresh();
  }

  return (
    <div className="py-3">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between text-left"
      >
        <span className="font-body font-medium text-[15px]">{pattern.name}</span>
        <span className="font-body text-xs text-steel">
          {initialLadder.length} {initialLadder.length === 1 ? "exercise" : "exercises"}
        </span>
      </button>

      {expanded && (
        <div className="mt-3 border border-steel/20 p-3 space-y-3">
          <p className="font-body text-xs text-steel">
            Easiest (regression) to hardest (progression)
          </p>
          <div className="space-y-2">
            {ladder.map((item, i) => (
              <div key={item.key} data-ladder-row>
              <div className="flex items-center gap-2">
                <span className="font-body text-xs text-steel w-4 shrink-0">{i + 1}</span>
                <div className="flex-1">
                  <ExerciseNameInput
                    value={item.exerciseName}
                    onChange={(name) => updateItem(item.key, name)}
                    suggestions={exerciseLibrary}
                  />
                </div>
                <div className="flex items-center gap-0.5 shrink-0" aria-label="Priority tier">
                  {(["A", "B", "C"] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => updateTier(item.key, item.tier === t ? null : t)}
                      aria-label={`Tier ${t}`}
                      className={`w-6 h-7 flex items-center justify-center border font-body text-xs transition-colors ${
                        item.tier === t
                          ? "bg-rust border-rust text-graphite"
                          : "border-steel/30 text-steel active:border-rust active:text-rust"
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => updateUnilateral(item.key, !item.unilateral)}
                  aria-pressed={!!item.unilateral}
                  aria-label="Unilateral"
                  className={`h-7 px-1.5 flex items-center justify-center border font-body text-xs transition-colors shrink-0 ${
                    item.unilateral ? "bg-rust border-rust text-graphite" : "border-steel/30 text-steel active:border-rust active:text-rust"
                  }`}
                >
                  Unilateral
                </button>
                <button
                  type="button"
                  onClick={() => moveItem(i, -1)}
                  disabled={i === 0}
                  aria-label="Move exercise up"
                  className="w-7 h-7 flex items-center justify-center text-steel disabled:opacity-30 shrink-0"
                >
                  <ChevronUp className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => moveItem(i, 1)}
                  disabled={i === ladder.length - 1}
                  aria-label="Move exercise down"
                  className="w-7 h-7 flex items-center justify-center text-steel disabled:opacity-30 shrink-0"
                >
                  <ChevronDown className="w-4 h-4" />
                </button>
                {ladder.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeItem(item.key)}
                    className="font-body text-xs text-steel shrink-0"
                  >
                    Remove
                  </button>
                )}
              </div>
              {/* Its own line under the name, so the row still fits a phone. */}
              <div className="pl-6 mt-1">
                <select
                  value={item.plane ?? ""}
                  onChange={(e) => updatePlane(item.key, (e.target.value || null) as ExercisePlane)}
                  aria-label={`Movement plane for ${item.exerciseName || `exercise ${i + 1}`}`}
                  className="h-7 bg-surface border border-steel/30 text-chalk px-1.5 font-body text-xs focus:outline-none focus:border-rust"
                >
                  <option value="">Plane</option>
                  {EXERCISE_PLANES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                  {item.plane === "Multi-planar" && <option value="Multi-planar">Multi-planar</option>}
                </select>
              </div>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={() =>
              setLadder((prev) => [
                ...prev,
                { key: crypto.randomUUID(), exerciseName: "", tier: null, unilateral: false, plane: null },
              ])
            }
            className="w-full h-9 border border-steel/30 text-steel font-body text-xs active:border-rust active:text-rust transition-colors"
          >
            + Add exercise
          </button>

          {error && (
            <p className="font-body text-xs text-rust" role="alert">
              {error}
            </p>
          )}

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleSave}
              disabled={submitting}
              className="h-10 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40"
            >
              {submitting ? "Saving…" : "Save ladder"}
            </button>
            <button
              type="button"
              onClick={handleDeletePattern}
              disabled={submitting}
              className="font-body text-xs text-steel active:text-rust transition-colors"
            >
              Delete pattern
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
