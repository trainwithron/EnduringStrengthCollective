"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import type { SessionExerciseEntry, SetLogEntry } from "@/lib/types";
import { TRACKED_FIELD_DEFS, ACTUAL_COLUMN, ACTUAL_PROP, fieldDef, type TrackedField } from "@/lib/exercise-fields";
import { ExerciseSetGrid } from "./exercise-set-grid";
import { SetStepper } from "./set-stepper";
import { UNDO_REMOVE_SET_MS, canRemoveSet, lastSet, prescribedNote, removeSetConfirmText, restoreSetRow, setHasLoggedWork } from "@/lib/set-removal";
import { useSetSave } from "./set-save-context";
import { classifyEquipmentType } from "@/lib/equipment-classifier";
import { ExerciseVideoThread } from "./exercise-video-thread";
import { ExerciseDemoButton } from "./exercise-demo-button";
import { useDemoLibrary, useOpenDemo } from "./demo-library-context";
import { DemoThumb } from "./demo-thumb";
import { useDemosHidden } from "./demo-preference";
import { findDemo } from "@/lib/exercise-demo";
import { ExerciseAthleteNote } from "./exercise-athlete-note";
import { EquipmentVisual } from "./equipment-visual";
import { ExerciseVolumeHistory } from "./exercise-volume-history";
import { findLoadRatio } from "@/lib/equipment-load-ratio-gather";
import { convertWeightAcrossVariants } from "@/lib/equipment-load-ratio";

export function ExerciseCard({
  exercise,
  lastTime,
  ladder,
  readOnly,
  onSetChange,
  onSetAdded,
  onSetRemoved,
  onRenamed,
  onTrackedFieldsChange,
  onDelete,
  deleting,
  sessionId,
  groupId,
  athleteId,
  viewerId,
  canUpload,
  onSetCompleted,
  gamificationEnabled,
}: {
  exercise: SessionExerciseEntry;
  lastTime?: { weight: number; reps: number };
  ladder?: string[];
  readOnly: boolean;
  onSetChange: (setId: string, patch: Partial<SetLogEntry>) => void;
  onSetAdded: (set: SetLogEntry) => void;
  onSetRemoved: (setId: string) => void;
  onRenamed: (name: string) => void;
  onTrackedFieldsChange: (fields: TrackedField[]) => void;
  onDelete?: () => void;
  deleting?: boolean;
  sessionId: string;
  groupId: string;
  athleteId: string;
  viewerId: string | null;
  canUpload: boolean;
  onSetCompleted?: (set: SetLogEntry) => void;
  gamificationEnabled?: boolean;
}) {
  const { discard: discardPendingSaves, remove: removeSetRow, unsavedIds } = useSetSave();
  // The demo is found from the exercise's current name (so a swapped or added exercise has one too); a client can hide the button in Settings.
  const demoLibrary = useDemoLibrary();
  const openDemo = useOpenDemo();
  const demosHidden = useDemosHidden();
  const demo = demoLibrary
    ? findDemo(demoLibrary, exercise.exerciseName)
    : exercise.videoUrl || exercise.youtubeUrl
    ? { videoPath: null, youtubeUrl: exercise.youtubeUrl, foundAs: exercise.exerciseName }
    : null;
  const [swapping, setSwapping] = useState(false);
  const [nameDraft, setNameDraft] = useState(exercise.exerciseName);
  const [swapBusy, setSwapBusy] = useState(false);
  const [swapError, setSwapError] = useState<string | null>(null);
  // Guards handleAddSet against a real race: it computes set_order off the
  // `exercise.sets` closure, stale until the parent re-renders with the new
  // array. A fast double-tap on "+ set" mid-workout would otherwise insert
  // two set_logs rows with the same set_order (found and fixed for the
  // coach-builder equivalent of this same bug tonight).
  const [addSetBusy, setAddSetBusy] = useState(false);
  // Taking a set off: a logged set asks first (confirmRemoveId), then can be put back for a few seconds (removed).
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [removed, setRemoved] = useState<{ set: SetLogEntry; error?: string } | null>(null);
  // True while Undo is putting a set back: adding or removing then could give two rows the same set number.
  const [undoBusy, setUndoBusy] = useState(false);
  useEffect(() => {
    if (!removed) return;
    const t = setTimeout(() => setRemoved(null), UNDO_REMOVE_SET_MS);
    return () => clearTimeout(t);
  }, [removed]);
  const [fieldsOpen, setFieldsOpen] = useState(false);
  const [fieldsBusy, setFieldsBusy] = useState(false);
  // Phase 3 (custom_shape_theming_idea.md) — the per-set equipment-visual
  // confirm animation fires on a real weight commit, cleared shortly
  // after so it never lingers as stuck-looking state.
  const [justConfirmedWeightSetId, setJustConfirmedWeightSetId] = useState<string | null>(null);

  async function applySwap(name: string) {
    if (!name || name === exercise.exerciseName) {
      setSwapping(false);
      return;
    }
    setSwapBusy(true);
    setSwapError(null);
    const oldName = exercise.exerciseName;
    const supabase = createBrowserClient();
    const { error } = await supabase
      .from("session_exercises")
      .update({ exercise_name: name, is_swapped: true })
      .eq("id", exercise.id);

    setSwapBusy(false);
    // Only reflect the swap in the UI once it's actually saved — otherwise
    // a failed write would show the new exercise name while the database
    // still has the old one, with no way to tell the two apart.
    if (error) {
      setSwapError("Couldn't swap — check your connection and try again.");
      return;
    }
    onRenamed(name);
    setSwapping(false);

    // Equipment-variant load-ratio suggestion
    // (equipment_variant_load_ratio_and_smart_swap_scoping_sept19.md) —
    // a swap mid-session is exactly the moment this app has zero logged
    // history under the NEW name yet, so the normal correlating-week
    // weight suggestion (lib/set-suggestions.ts) has nothing to work
    // with. If this athlete has a learned conversion between the old and
    // new exercise, convert their last known weight on the old one and
    // offer it the same way any other weight suggestion is offered —
    // a swipeable placeholder (suggestedWeight), never an assertion, and
    // only into sets that don't already have a real logged value.
    if (lastTime?.weight != null) {
      const ratioRow = await findLoadRatio(supabase, {
        athleteId,
        exerciseNameOne: oldName,
        exerciseNameTwo: name,
      });
      if (ratioRow) {
        const suggested = convertWeightAcrossVariants(lastTime.weight, oldName, name, ratioRow);
        if (suggested != null) {
          for (const set of exercise.sets) {
            if (set.weight == null) onSetChange(set.id, { suggestedWeight: suggested });
          }
        }
      }
    }
  }

  async function handleAddSet() {
    if (addSetBusy || undoBusy) return;
    setAddSetBusy(true);
    try {
      const supabase = createBrowserClient();
      const nextOrder =
        exercise.sets.length > 0 ? Math.max(...exercise.sets.map((s) => s.setOrder)) + 1 : 0;

      const { data: set } = await supabase
        .from("set_logs")
        .insert({ session_exercise_id: exercise.id, set_order: nextOrder })
        .select("id, set_order, weight, reps, rpe, rir, tempo, time_seconds, height, distance, rest_seconds, pace, status")
        .single();

      if (set) {
        onSetAdded({
          id: set.id,
          setOrder: set.set_order,
          weight: set.weight,
          reps: set.reps,
          rpe: set.rpe,
          rir: set.rir,
          tempo: set.tempo,
          timeSeconds: set.time_seconds,
          height: set.height,
          distance: set.distance,
          restSeconds: set.rest_seconds,
          pace: set.pace,
          status: set.status,
        });
      }
    } finally {
      setAddSetBusy(false);
    }
  }

  // The minus on the Sets stepper: takes the LAST set off. An untouched set goes at once; a logged one asks first. An exercise keeps at least one set.
  function handleRemoveLastSet() {
    if (undoBusy || confirmRemoveId || !canRemoveSet(exercise.sets)) return;
    const target = lastSet(exercise.sets);
    if (!target) return;
    if (setHasLoggedWork(target)) {
      setConfirmRemoveId(target.id);
      return;
    }
    removeLastSet(target);
  }

  function removeLastSet(target: SetLogEntry) {
    setConfirmRemoveId(null);
    // Queued like any other logging write: it keeps retrying on a bad signal, and Complete workout waits for it.
    removeSetRow(target.id);
    onSetRemoved(target.id);
    setRemoved(setHasLoggedWork(target) ? { set: target } : null);
  }

  async function handleUndoRemove() {
    if (!removed || undoBusy || unsavedIds.has(removed.set.id)) return;
    const snapshot = removed.set;
    setUndoBusy(true);
    const supabase = createBrowserClient();
    const { error } = await supabase.from("set_logs").insert(restoreSetRow(snapshot, exercise.id));
    setUndoBusy(false);
    if (error) {
      setRemoved({ set: snapshot, error: "Couldn't put it back. Add a set instead." });
      return;
    }
    onSetAdded(snapshot);
    setRemoved(null);
  }

  // Which metrics this exercise actually tracks is a per-session-instance
  // choice, not fixed by the program template — a coach standing there
  // in person needs to add "distance" for a sprint drill someone swapped
  // in, or drop RPE for an exercise it never made sense for, without
  // leaving the log screen to go edit the program builder.
  async function handleAddField(field: TrackedField) {
    if (fieldsBusy) return;
    setFieldsBusy(true);
    try {
      const nextFields = [...exercise.trackedFields, field];
      const supabase = createBrowserClient();
      await supabase.from("session_exercises").update({ tracked_fields: nextFields }).eq("id", exercise.id);
      onTrackedFieldsChange(nextFields);
      setFieldsOpen(false);
    } finally {
      setFieldsBusy(false);
    }
  }

  async function handleRemoveField(field: TrackedField) {
    if (fieldsBusy) return;
    // Dropping a metric clears it on every set — including sets already
    // logged. Never do that without asking.
    const prop = ACTUAL_PROP[field] as keyof SetLogEntry;
    const filled = exercise.sets.filter((s) => s[prop] !== null && s[prop] !== undefined).length;
    if (
      filled > 0 &&
      !window.confirm(
        `Remove ${fieldDef(field).label}? This clears the ${fieldDef(field).label} you've already entered on ${filled} ${filled === 1 ? "set" : "sets"}.`
      )
    ) {
      return;
    }
    setFieldsBusy(true);
    try {
      const nextFields = exercise.trackedFields.filter((f) => f !== field);
      const supabase = createBrowserClient();
      await supabase.from("session_exercises").update({ tracked_fields: nextFields }).eq("id", exercise.id);
      const setIds = exercise.sets.map((s) => s.id);
      if (setIds.length > 0) {
        await supabase
          .from("set_logs")
          .update({ [ACTUAL_COLUMN[field]]: null })
          .in("id", setIds);
      }
      onTrackedFieldsChange(nextFields);
      for (const set of exercise.sets) {
        onSetChange(set.id, { [prop]: null } as Partial<SetLogEntry>);
      }
    } finally {
      setFieldsBusy(false);
    }
  }

  const untrackedFields = TRACKED_FIELD_DEFS.map((f) => f.key).filter(
    (k) => !exercise.trackedFields.includes(k)
  );

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-1">
        {swapping ? (
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <input
                type="text"
                autoFocus
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                disabled={swapBusy}
                className="flex-1 h-11 bg-surface border border-steel/30 text-chalk px-2 font-body text-sm focus:outline-none focus:border-rust disabled:opacity-60"
              />
              <button
                type="button"
                onClick={() => applySwap(nameDraft.trim())}
                disabled={swapBusy}
                className="font-body text-xs text-rust disabled:opacity-40"
              >
                {swapBusy ? "Saving…" : "Save"}
              </button>
            </div>
            {swapError && (
              <p className="font-body text-xs text-rust mt-1" role="alert">
                {swapError}
              </p>
            )}
          </div>
        ) : (
          <>
            <h2 className="font-body font-medium text-[15px]">
              {exercise.exerciseName || "Untitled exercise"}
              {exercise.isSwapped && (
                <span className="font-body text-xs text-steel ml-2 align-middle">
                  swapped
                </span>
              )}
            </h2>
            {!readOnly && (
              <div className="flex items-center gap-3 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setNameDraft(exercise.exerciseName);
                    setSwapping(true);
                  }}
                  className="font-body text-xs text-steel"
                >
                  Swap Exercise
                </button>
                {exercise.isAdded && onDelete && (
                  <button
                    type="button"
                    onClick={() => {
                      discardPendingSaves(exercise.sets.map((s) => s.id));
                      onDelete();
                    }}
                    disabled={deleting}
                    className="font-body text-xs text-rust disabled:opacity-40"
                  >
                    {deleting ? "Removing…" : "Remove"}
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* The demo thumbnail and "Last time" / history side by side, so one short row has both: glanceable, and a tap opens the demo sheet. */}
      {((demo && !demosHidden) || lastTime || (exercise.volumeHistory && exercise.volumeHistory.length > 0)) && (
        <div className="flex items-start gap-3 mb-2">
          {demo && !demosHidden && openDemo && (
            <DemoThumb title={exercise.exerciseName || "Exercise"} youtubeUrl={demo.youtubeUrl} onOpen={() => openDemo(exercise.id)} />
          )}
          {demo && !demosHidden && !openDemo && (
            <ExerciseDemoButton
              title={exercise.exerciseName || "Exercise"}
              youtubeUrl={demo.youtubeUrl}
              videoUrl={exercise.videoUrl}
              videoPath={demo.videoPath}
            />
          )}
          <div className="min-w-0 flex-1">
            {lastTime && (
              <p className="font-body text-xs text-steel mb-1">
                Last time: {lastTime.weight} &times; {lastTime.reps}
              </p>
            )}
            {exercise.volumeHistory && <ExerciseVolumeHistory history={exercise.volumeHistory} />}
          </div>
        </div>
      )}

      {!readOnly && ladder && ladder.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {ladder.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => applySwap(name)}
              disabled={swapBusy || name === exercise.exerciseName}
              className={`h-7 px-2.5 border font-body text-xs transition-colors ${
                name === exercise.exerciseName
                  ? "bg-rust border-rust text-graphite"
                  : "border-steel/30 text-steel active:border-rust active:text-rust"
              }`}
            >
              {name}
            </button>
          ))}
        </div>
      )}

      {exercise.notes && (
        <p className="font-body text-xs text-steel mb-2">{exercise.notes}</p>
      )}

      <ExerciseAthleteNote
        sessionExerciseId={exercise.id}
        initialNote={exercise.athleteNote ?? null}
        readOnly={readOnly}
      />

      {!readOnly && (
        <div className="relative mb-2">
          <button
            type="button"
            onClick={() => setFieldsOpen((v) => !v)}
            className="font-body text-xs text-steel active:text-rust transition-colors"
          >
            Edit metrics
          </button>
          {fieldsOpen && (
            <div className="absolute z-10 left-0 mt-1 bg-surface border border-steel/30 p-2 w-56">
              {exercise.trackedFields.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-1.5">
                  {exercise.trackedFields.map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => handleRemoveField(f)}
                      disabled={fieldsBusy}
                      className="h-7 px-2 border border-rust/40 text-rust font-body text-xs disabled:opacity-40"
                    >
                      {fieldDef(f).label} &times;
                    </button>
                  ))}
                </div>
              )}
              {untrackedFields.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {untrackedFields.map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => handleAddField(f)}
                      disabled={fieldsBusy}
                      className="h-7 px-2 border border-steel/30 text-steel font-body text-xs active:border-rust active:text-rust disabled:opacity-40"
                    >
                      + {fieldDef(f).label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {!readOnly && (
        <EquipmentVisual
          equipmentType={exercise.equipmentType}
          sets={exercise.sets}
          justConfirmedSetId={justConfirmedWeightSetId}
        />
      )}

      <ExerciseSetGrid
        sets={exercise.sets}
        trackedFields={exercise.trackedFields}
        readOnly={readOnly}
        weightOptional={classifyEquipmentType(exercise.exerciseName) === "bodyweight"}
        onSetChange={(setId, patch) => {
          const set = exercise.sets.find((s) => s.id === setId);
          const wasCompleted = set?.status === "completed";
          onSetChange(setId, patch);
          if (patch.status === "completed" && !wasCompleted && set) {
            onSetCompleted?.({ ...set, ...patch });
          }
          if ("weight" in patch && patch.weight != null) {
            setJustConfirmedWeightSetId(setId);
            setTimeout(() => setJustConfirmedWeightSetId(null), 800);
          }
        }}
        priorBest={exercise.priorBest}
        gamificationEnabled={gamificationEnabled ?? true}
      />

      {!readOnly && (
        <SetStepper
          count={exercise.sets.length}
          canRemove={canRemoveSet(exercise.sets) && !undoBusy && !confirmRemoveId}
          addBusy={addSetBusy || undoBusy}
          onAdd={handleAddSet}
          onRemove={handleRemoveLastSet}
          prescribedNote={prescribedNote(exercise.prescribedSetCount, exercise.sets.length)}
          confirmText={
            confirmRemoveId && lastSet(exercise.sets)?.id === confirmRemoveId
              ? removeSetConfirmText(exercise.sets.findIndex((s) => s.id === confirmRemoveId) + 1)
              : null
          }
          onConfirmRemove={() => {
            const target = lastSet(exercise.sets);
            if (target) removeLastSet(target);
          }}
          onKeep={() => setConfirmRemoveId(null)}
          undo={
            removed
              ? {
                  text: removed.error ?? `Set ${removed.set.setOrder + 1} removed.`,
                  pending: unsavedIds.has(removed.set.id) || undoBusy,
                  onUndo: handleUndoRemove,
                }
              : null
          }
        />
      )}

      <ExerciseVideoThread
        sessionId={sessionId}
        sessionExerciseId={exercise.id}
        groupId={groupId}
        athleteId={athleteId}
        viewerId={viewerId}
        canUpload={canUpload}
      />
    </div>
  );
}
