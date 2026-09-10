"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import type { BuilderDay, BuilderItem } from "@/lib/types";
import { SET_ROW_SELECT, mapSetRow, type TrackedField } from "@/lib/exercise-fields";
import {
  generateLinearProgression,
  generateDoubleProgression,
  generateUndulatingProgression,
  generateIntervalProgression,
  parseNumericPaceSecondsPerUnit,
  formatPaceSecondsToClock,
  DEFAULT_UNDULATING_WAVE,
  type ProgressionResultWeek,
  type IntervalResultWeek,
  type UndulatingWaveStep,
} from "@/lib/progression-models";
import { flashSaved, flashSaveError } from "@/lib/save-toast";

type Model = "linear" | "double" | "undulating";
type IntervalAxis = "rounds" | "rest" | "work";

// An interval exercise (Time + Rest tracked) progresses at the exercise
// level — "rounds" is literally how many set rows exist, not a per-set
// value — so it can't share the per-set progression tracks below at all;
// a distance/pace exercise (Distance + Pace, no Reps) *does* share that
// system, just with distance mapped onto the "reps" slot and a parsed
// numeric pace onto "weight" (see buildProgressionSource) — the exact
// reuse the original ask called for.
function isIntervalExercise(trackedFields: TrackedField[]): boolean {
  return trackedFields.includes("time") && trackedFields.includes("rest");
}
function isDistancePaceExercise(trackedFields: TrackedField[]): boolean {
  return trackedFields.includes("distance") && trackedFields.includes("pace") && !trackedFields.includes("reps");
}

function parseReps(text: string | null): number | null {
  if (!text) return null;
  const n = parseInt(text, 10);
  return Number.isFinite(n) ? n : null;
}

// A rep target that isn't a plain integer — "8-12", "AMRAP", "5+" — can't
// be meaningfully run through the numeric progression math (parseReps
// used to silently truncate "8-12" down to 8, discarding the range). For
// anything that doesn't round-trip as a plain integer, the target_reps
// text is carried forward unchanged onto every generated week instead of
// being computed — the same "leave it alone" behavior already used when
// no reps are set at all, just applied to non-numeric text too.
function isPlainInteger(text: string | null): boolean {
  if (!text) return false;
  return /^-?\d+$/.test(text.trim()) && Number.isFinite(parseInt(text, 10));
}

export function DuplicateWeekPanel({
  programId,
  groupId,
  sourceWeekNumber,
  sourceDays,
  existingWeekNumbers,
  onGenerated,
}: {
  programId: string;
  groupId: string;
  sourceWeekNumber: number;
  sourceDays: BuilderDay[];
  existingWeekNumbers: number[];
  onGenerated: (newDays: BuilderDay[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [model, setModel] = useState<Model>("linear");
  const [weeks, setWeeks] = useState("3");
  const [linearWeightPct, setLinearWeightPct] = useState("2.5");
  const [doubleWeightBumpPct, setDoubleWeightBumpPct] = useState("5");
  const [wave, setWave] = useState<UndulatingWaveStep[]>(DEFAULT_UNDULATING_WAVE);
  const [intervalAxis, setIntervalAxis] = useState<IntervalAxis>("rounds");
  const [intervalAmountPerWeek, setIntervalAmountPerWeek] = useState("1");
  const [classRepsEnabled, setClassRepsEnabled] = useState(false);
  const [classRepCycles, setClassRepCycles] = useState<Record<"A" | "B" | "C", string>>({
    A: "",
    B: "",
    C: "",
  });
  const [generating, setGenerating] = useState(false);

  function updateWaveStep(index: number, patch: Partial<UndulatingWaveStep>) {
    setWave((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  const hasIntervalExercise = sourceDays.some((d) =>
    d.items.some((i) => i.kind === "exercise" && isIntervalExercise(i.trackedFields))
  );

  async function handleGenerate() {
    const weekCount = Number(weeks);
    if (!weekCount || weekCount < 1) return;
    setGenerating(true);

    const startingWeek =
      existingWeekNumbers.length > 0 ? Math.max(...existingWeekNumbers) + 1 : sourceWeekNumber + 1;

    // Flatten every set across the source week into an independent
    // progression track — each set only depends on its own targets, never
    // on any other set's. A distance/pace exercise shares this exact
    // system (distance mapped onto the "reps" slot, a parsed numeric pace
    // onto "weight") — only a true interval exercise (Time+Rest) is
    // fundamentally different, since its "rounds" is a row count, not a
    // per-set value, and gets its own track list below.
    interface SetTrack {
      dayIndex: number;
      dayTitle: string;
      itemOrder: number;
      exerciseName: string;
      movementPatternId: string | null;
      trackedFields: TrackedField[];
      notes: string | null;
      tier: "A" | "B" | "C" | null;
      setOrder: number;
      isDistancePace: boolean;
      otherTargets: {
        rpe: number | null;
        rir: number | null;
        tempo: string | null;
        timeSeconds: number | null;
        height: number | null;
        distance: number | null;
        restSeconds: number | null;
        pace: string | null;
      };
      // Carried through unchanged onto every generated week's sets — the
      // range itself doesn't move, only where reps/distance sit within
      // it — so a coach can chain another duplication off these new
      // weeks later.
      repRange: { min: number | null; max: number | null };
      results: ProgressionResultWeek[];
      // Set when the source reps text wasn't a plain integer (a range
      // like "8-12", "AMRAP", "5+") and wasn't overridden by a class rep
      // cycle — the write step uses this raw text instead of the model's
      // (meaningless, truncated) numeric result for every generated week.
      preserveRepsText: string | null;
      // Same idea for a distance/pace exercise's pace, when it's an
      // effort label ("easy") rather than a real parseable pace — the
      // model's computed "weight" (bumped pace) is meaningless for text
      // like that, so the original label carries forward unchanged.
      preservePaceText: string | null;
    }

    interface IntervalTrack {
      dayIndex: number;
      dayTitle: string;
      itemOrder: number;
      exerciseName: string;
      movementPatternId: string | null;
      trackedFields: TrackedField[];
      notes: string | null;
      tier: "A" | "B" | "C" | null;
      otherTargets: { rpe: number | null; rir: number | null; tempo: string | null; height: number | null };
      results: IntervalResultWeek[];
    }

    const sortedDays = sourceDays.slice().sort((a, b) => a.dayIndex - b.dayIndex);
    const dayNoteTracks: { dayIndex: number; dayTitle: string; itemOrder: number; body: string }[] = [];
    const setTracks: SetTrack[] = [];
    const intervalTracks: IntervalTrack[] = [];

    for (const day of sortedDays) {
      for (const item of day.items) {
        if (item.kind === "note") {
          dayNoteTracks.push({
            dayIndex: day.dayIndex,
            dayTitle: day.title,
            itemOrder: item.order,
            body: item.body,
          });
          continue;
        }

        if (isIntervalExercise(item.trackedFields)) {
          const firstSet = item.sets[0];
          const results = generateIntervalProgression(
            {
              rounds: item.sets.length,
              workSeconds: firstSet?.targetTimeSeconds ?? 0,
              restSeconds: firstSet?.targetRestSeconds ?? 0,
            },
            { weeks: weekCount, axis: intervalAxis, amountPerWeek: Number(intervalAmountPerWeek) || 0 }
          );
          intervalTracks.push({
            dayIndex: day.dayIndex,
            dayTitle: day.title,
            itemOrder: item.order,
            exerciseName: item.exerciseName,
            movementPatternId: item.movementPatternId,
            trackedFields: item.trackedFields,
            notes: item.notes,
            tier: item.tier,
            otherTargets: {
              rpe: firstSet?.targetRpe ?? null,
              rir: firstSet?.targetRir ?? null,
              tempo: firstSet?.targetTempo ?? null,
              height: firstSet?.targetHeight ?? null,
            },
            results,
          });
          continue;
        }

        const isDistancePace = isDistancePaceExercise(item.trackedFields);

        for (const set of item.sets) {
          const source = isDistancePace
            ? {
                weight: parseNumericPaceSecondsPerUnit(set.targetPace),
                reps: set.targetDistance,
                repMin: set.repMin,
                repMax: set.repMax,
              }
            : {
                weight: set.targetWeight,
                reps: parseReps(set.targetReps),
                repMin: set.repMin,
                repMax: set.repMax,
              };

          let results: ProgressionResultWeek[];
          if (model === "linear") {
            results = generateLinearProgression(source, {
              weeks: weekCount,
              weightPctIncreasePerWeek: Number(linearWeightPct) || 0,
            });
          } else if (model === "double") {
            results = generateDoubleProgression(source, {
              weeks: weekCount,
              weightBumpPct: Number(doubleWeightBumpPct) || 0,
            });
          } else {
            results = generateUndulatingProgression(source, { weeks: weekCount, wave });
          }

          // Rep targets by class override reps only, regardless of which
          // weight-progression model produced `results` — a coach can
          // set week-by-week rep targets per A/B/C class independent of
          // whether weight is climbing linearly, via double progression,
          // or an undulating wave. Doesn't apply to a distance/pace
          // exercise — there are no reps to override there.
          let repsOverriddenByClass = false;
          if (!isDistancePace && classRepsEnabled && item.tier) {
            const cycleText = classRepCycles[item.tier];
            const cycle = cycleText
              .split(",")
              .map((s) => parseInt(s.trim(), 10))
              .filter((n) => Number.isFinite(n));
            if (cycle.length > 0) {
              results = results.map((r, i) => ({ ...r, reps: cycle[i % cycle.length] }));
              repsOverriddenByClass = true;
            }
          }

          setTracks.push({
            dayIndex: day.dayIndex,
            dayTitle: day.title,
            itemOrder: item.order,
            exerciseName: item.exerciseName,
            movementPatternId: item.movementPatternId,
            trackedFields: item.trackedFields,
            notes: item.notes,
            tier: item.tier,
            setOrder: set.setOrder,
            isDistancePace,
            otherTargets: {
              rpe: set.targetRpe,
              rir: set.targetRir,
              tempo: set.targetTempo,
              timeSeconds: set.targetTimeSeconds,
              height: set.targetHeight,
              distance: set.targetDistance,
              restSeconds: set.targetRestSeconds,
              pace: set.targetPace,
            },
            repRange: { min: set.repMin, max: set.repMax },
            results,
            preserveRepsText:
              !isDistancePace && !repsOverriddenByClass && set.targetReps && !isPlainInteger(set.targetReps)
                ? set.targetReps
                : null,
            preservePaceText:
              isDistancePace && set.targetPace && parseNumericPaceSecondsPerUnit(set.targetPace) === null
                ? set.targetPace
                : null,
          });
        }
      }
    }

    const supabase = createBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const generatedDays: BuilderDay[] = [];
    let anyFailed = false;

    for (let offset = 0; offset < weekCount; offset++) {
      const weekNumber = startingWeek + offset;

      for (const day of sortedDays) {
        const { data: workoutRow, error: workoutError } = await supabase
          .from("workouts")
          .insert({
            program_id: programId,
            group_id: groupId,
            title: day.title,
            week_number: weekNumber,
            day_index: day.dayIndex,
          })
          .select("id, title, week_number, day_index")
          .single();
        if (workoutError || !workoutRow) {
          anyFailed = true;
          continue;
        }

        const items: BuilderItem[] = [];

        for (const note of dayNoteTracks.filter((n) => n.dayIndex === day.dayIndex)) {
          // group_id and created_by are NOT NULL with no default — omitting
          // them (as this insert used to) fails silently here since the
          // result is only used via an `if (noteRow)` check, quietly
          // dropping every note a duplicated week was supposed to carry.
          const { data: noteRow, error: noteError } = await supabase
            .from("workout_notes")
            .insert({
              workout_id: workoutRow.id,
              group_id: groupId,
              body: note.body,
              position: note.itemOrder,
              created_by: user?.id,
            })
            .select("id, body, position")
            .single();
          if (noteRow) {
            items.push({ kind: "note", id: noteRow.id, order: noteRow.position, body: noteRow.body });
          } else if (noteError) {
            anyFailed = true;
          }
        }

        const tracksForDay = setTracks.filter((t) => t.dayIndex === day.dayIndex);
        const intervalTracksForDay = intervalTracks.filter((t) => t.dayIndex === day.dayIndex);
        const exerciseOrders = Array.from(
          new Set([...tracksForDay.map((t) => t.itemOrder), ...intervalTracksForDay.map((t) => t.itemOrder)])
        ).sort((a, b) => a - b);

        for (const itemOrder of exerciseOrders) {
          const intervalTrack = intervalTracksForDay.find((t) => t.itemOrder === itemOrder);

          if (intervalTrack) {
            const { data: exerciseRow, error: exerciseError } = await supabase
              .from("group_workout_exercises")
              .insert({
                workout_id: workoutRow.id,
                group_id: groupId,
                exercise_name: intervalTrack.exerciseName,
                exercise_order: itemOrder,
                movement_pattern_id: intervalTrack.movementPatternId,
                tracked_fields: intervalTrack.trackedFields,
                notes: intervalTrack.notes,
              })
              .select("id")
              .single();
            if (exerciseError || !exerciseRow) {
              anyFailed = true;
              continue;
            }

            const result = intervalTrack.results[offset];
            const setsPayload = Array.from({ length: result.rounds }, (_, i) => ({
              group_workout_exercise_id: exerciseRow.id,
              set_order: i,
              target_time_seconds: result.workSeconds,
              target_rest_seconds: result.restSeconds,
              target_rpe: intervalTrack.otherTargets.rpe,
              target_rir: intervalTrack.otherTargets.rir,
              target_tempo: intervalTrack.otherTargets.tempo,
              target_height: intervalTrack.otherTargets.height,
            }));

            const { data: setsData, error: setsError } = await supabase
              .from("group_workout_exercise_sets")
              .insert(setsPayload)
              .select(SET_ROW_SELECT);
            if (setsError) anyFailed = true;

            items.push({
              kind: "exercise",
              id: exerciseRow.id,
              order: itemOrder,
              exerciseName: intervalTrack.exerciseName,
              movementPatternId: intervalTrack.movementPatternId,
              trackedFields: intervalTrack.trackedFields,
              notes: intervalTrack.notes,
              videoPath: null,
              youtubeUrl: null,
              tier: intervalTrack.tier,
              sets: (setsData ?? []).map(mapSetRow),
            });
            continue;
          }

          const tracksForExercise = tracksForDay.filter((t) => t.itemOrder === itemOrder);
          const first = tracksForExercise[0];

          const { data: exerciseRow, error: exerciseError } = await supabase
            .from("group_workout_exercises")
            .insert({
              workout_id: workoutRow.id,
              group_id: groupId,
              exercise_name: first.exerciseName,
              exercise_order: itemOrder,
              movement_pattern_id: first.movementPatternId,
              tracked_fields: first.trackedFields,
              notes: first.notes,
            })
            .select("id")
            .single();
          if (exerciseError || !exerciseRow) {
            anyFailed = true;
            continue;
          }

          const setsPayload = tracksForExercise
            .slice()
            .sort((a, b) => a.setOrder - b.setOrder)
            .map((track) => {
              const result = track.results[offset];
              if (track.isDistancePace) {
                return {
                  group_workout_exercise_id: exerciseRow.id,
                  set_order: track.setOrder,
                  target_distance: result.reps,
                  target_pace:
                    track.preservePaceText ??
                    (result.weight != null ? formatPaceSecondsToClock(result.weight) : null),
                  target_rpe: track.otherTargets.rpe,
                  target_rir: track.otherTargets.rir,
                  target_tempo: track.otherTargets.tempo,
                  target_time_seconds: track.otherTargets.timeSeconds,
                  target_height: track.otherTargets.height,
                  target_rest_seconds: track.otherTargets.restSeconds,
                  rep_min: track.repRange.min,
                  rep_max: track.repRange.max,
                };
              }
              return {
                group_workout_exercise_id: exerciseRow.id,
                set_order: track.setOrder,
                target_reps:
                  track.preserveRepsText ?? (result.reps != null ? String(result.reps) : null),
                target_weight: result.weight,
                target_rpe: track.otherTargets.rpe,
                target_rir: track.otherTargets.rir,
                target_tempo: track.otherTargets.tempo,
                target_time_seconds: track.otherTargets.timeSeconds,
                target_height: track.otherTargets.height,
                target_distance: track.otherTargets.distance,
                target_rest_seconds: track.otherTargets.restSeconds,
                target_pace: track.otherTargets.pace,
                rep_min: track.repRange.min,
                rep_max: track.repRange.max,
              };
            });

          const { data: setsData, error: setsError } = await supabase
            .from("group_workout_exercise_sets")
            .insert(setsPayload)
            .select(SET_ROW_SELECT);
          if (setsError) anyFailed = true;

          items.push({
            kind: "exercise",
            id: exerciseRow.id,
            order: itemOrder,
            exerciseName: first.exerciseName,
            movementPatternId: first.movementPatternId,
            trackedFields: first.trackedFields,
            notes: first.notes,
            videoPath: null,
            youtubeUrl: null,
            tier: first.tier,
            sets: (setsData ?? []).map(mapSetRow),
          });
        }

        generatedDays.push({
          id: workoutRow.id,
          title: workoutRow.title,
          weekNumber: workoutRow.week_number,
          dayIndex: workoutRow.day_index,
          items,
        });
      }
    }

    onGenerated(generatedDays);
    setGenerating(false);
    setOpen(false);
    if (anyFailed) {
      flashSaveError(
        generatedDays.length > 0
          ? "Some of the generated weeks didn't save fully — check them before relying on them."
          : "Couldn't generate those weeks — try again."
      );
    } else {
      flashSaved();
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="font-body text-xs text-rust border border-rust px-3 h-8"
      >
        Duplicate with progression →
      </button>
    );
  }

  return (
    <div className="border border-rust/40 bg-surface/60 p-4 space-y-3">
      <h3 className="font-display uppercase text-sm tracking-wide">
        Duplicate Week {sourceWeekNumber} with progression
      </h3>

      <div className="flex items-center gap-2">
        <span className="font-body text-xs text-steel uppercase tracking-wide">Weeks to add</span>
        <input
          type="number"
          value={weeks}
          onChange={(e) => setWeeks(e.target.value)}
          className="w-16 h-8 bg-graphite border border-steel/30 text-chalk px-2 font-body text-xs"
        />
      </div>

      {hasIntervalExercise && (
        <div className="border border-steel/20 p-3 space-y-2">
          <p className="font-body text-xs text-steel uppercase tracking-wide">
            Interval exercises (Time + Rest) — progress:
          </p>
          <div className="flex gap-1">
            {(["rounds", "rest", "work"] as IntervalAxis[]).map((axis) => (
              <button
                key={axis}
                type="button"
                onClick={() => setIntervalAxis(axis)}
                className={`h-8 px-3 font-body text-xs border ${
                  intervalAxis === axis ? "bg-rust text-graphite border-rust" : "border-steel/30 text-steel"
                }`}
              >
                {axis === "rounds" ? "Rounds" : axis === "rest" ? "Rest" : "Work"}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2">
            <span className="font-body text-xs text-steel w-40">
              {intervalAxis === "rounds"
                ? "Rounds / week"
                : intervalAxis === "rest"
                ? "Rest change / week (s)"
                : "Work change / week (s)"}
            </span>
            <input
              type="number"
              value={intervalAmountPerWeek}
              onChange={(e) => setIntervalAmountPerWeek(e.target.value)}
              className="w-20 h-8 bg-graphite border border-steel/30 text-chalk px-2 font-body text-xs"
            />
            <span className="font-body text-[11px] text-steel">
              {intervalAxis === "rest" ? "(negative = shorter rest)" : "(negative to decrease)"}
            </span>
          </label>
          <p className="font-body text-[11px] text-steel">
            Non-interval exercises in this week use the model below instead.
          </p>
        </div>
      )}

      <div className="flex gap-1">
        {(["linear", "double", "undulating"] as Model[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setModel(m)}
            className={`h-8 px-3 font-body text-xs border ${
              model === m ? "bg-rust text-graphite border-rust" : "border-steel/30 text-steel"
            }`}
          >
            {m === "linear" ? "Linear" : m === "double" ? "Double Progression" : "Undulating"}
          </button>
        ))}
      </div>

      {model === "linear" && (
        <div className="space-y-2">
          <label className="flex items-center gap-2">
            <span className="font-body text-xs text-steel w-40">Weight increase / week (%)</span>
            <input
              type="number"
              value={linearWeightPct}
              onChange={(e) => setLinearWeightPct(e.target.value)}
              className="w-20 h-8 bg-graphite border border-steel/30 text-chalk px-2 font-body text-xs"
            />
          </label>
        </div>
      )}

      {model === "double" && (
        <label className="flex items-center gap-2">
          <span className="font-body text-xs text-steel w-40">Weight bump on reset (%)</span>
          <input
            type="number"
            value={doubleWeightBumpPct}
            onChange={(e) => setDoubleWeightBumpPct(e.target.value)}
            className="w-20 h-8 bg-graphite border border-steel/30 text-chalk px-2 font-body text-xs"
          />
          <span className="font-body text-[11px] text-steel">
            (needs a rep range set on each exercise)
          </span>
        </label>
      )}

      {model === "undulating" && (
        <div className="space-y-1.5">
          {["Heavy", "Moderate", "Light"].map((label, i) => (
            <div key={label} className="flex items-center gap-2">
              <span className="font-body text-xs text-steel w-20">{label}</span>
              <span className="font-body text-[11px] text-steel">Reps</span>
              <input
                type="number"
                value={wave[i].reps}
                onChange={(e) => updateWaveStep(i, { reps: Number(e.target.value) })}
                className="w-16 h-8 bg-graphite border border-steel/30 text-chalk px-1 font-body text-xs"
              />
            </div>
          ))}
        </div>
      )}

      <div className="pt-2 border-t border-steel/15 space-y-1.5">
        <label className="flex items-center gap-2 font-body text-xs text-steel">
          <input
            type="checkbox"
            checked={classRepsEnabled}
            onChange={(e) => setClassRepsEnabled(e.target.checked)}
            className="w-4 h-4"
          />
          Set rep targets by class (A/B/C) — overrides reps only, weight
          still follows the model above
        </label>
        {classRepsEnabled && (
          <div className="space-y-1.5 pl-6">
            {(["A", "B", "C"] as const).map((tier) => (
              <label key={tier} className="flex items-center gap-2">
                <span className="font-body text-xs text-steel w-24">Class {tier} reps</span>
                <input
                  type="text"
                  value={classRepCycles[tier]}
                  onChange={(e) =>
                    setClassRepCycles((prev) => ({ ...prev, [tier]: e.target.value }))
                  }
                  placeholder="e.g. 5, 8, 12"
                  className="flex-1 h-8 bg-graphite border border-steel/30 text-chalk px-2 font-body text-xs"
                />
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-2 pt-2">
        <button
          type="button"
          onClick={handleGenerate}
          disabled={generating}
          className="h-9 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40"
        >
          {generating ? "Generating…" : `Generate ${weeks || 0} weeks`}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={generating}
          className="h-9 px-4 border border-steel/30 text-steel font-body text-sm disabled:opacity-40"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
