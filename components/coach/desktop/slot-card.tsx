"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/client";
import { bestEffort } from "@/lib/saved";
import { confirmDialog } from "@/components/shared/confirm-dialog";
import { SET_ROW_SELECT, mapSetRow } from "@/lib/exercise-fields";
import { slotLabel, slotPlaceholderName, type Side, type SlotSpec, type SlotTier } from "@/lib/slot-templates";
import type { BuilderExercise, ExerciseSetTarget } from "@/lib/types";

interface PatternOption {
  id: string;
  name: string;
}

const MAX_SETS = 12;
const select = "h-10 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm focus:outline-none focus:border-rust";

export const SIDE_OPTIONS: { value: "" | Side; label: string }[] = [
  { value: "", label: "Either side" },
  { value: "bilateral", label: "Bilateral" },
  { value: "unilateral", label: "Unilateral" },
];
export const CLASS_OPTIONS: { value: "" | SlotTier; label: string }[] = [
  { value: "", label: "Any class" },
  { value: "A", label: "Class A" },
  { value: "B", label: "Class B" },
  { value: "C", label: "Class C" },
];

// The slot's reps as the sets carry them (the same text on every set).
export function slotRepsOf(sets: ExerciseSetTarget[]): string {
  return sets[0]?.targetReps ?? "";
}

// Adds a slot to a day: a pattern, a side, a class, and sets x reps. It is saved as an exercise row marked as a slot, so ordering, deleting and copying work exactly as they do for an exercise.
export function AddSlotForm({
  workoutId,
  groupId,
  nextOrder,
  patterns,
  onAdded,
  onCancel,
  onError,
}: {
  workoutId: string;
  groupId: string;
  nextOrder: number;
  patterns: PatternOption[];
  onAdded: (item: BuilderExercise) => void;
  onCancel: () => void;
  onError: (message: string) => void;
}) {
  const [patternId, setPatternId] = useState("");
  const [side, setSide] = useState<"" | Side>("");
  const [tier, setTier] = useState<"" | SlotTier>("");
  const [sets, setSets] = useState("3");
  const [reps, setReps] = useState("8");
  const [busy, setBusy] = useState(false);

  const pattern = patterns.find((p) => p.id === patternId) ?? null;
  const setCount = Number(sets);
  const valid = !!pattern && Number.isInteger(setCount) && setCount >= 1 && setCount <= MAX_SETS;

  async function add() {
    if (!pattern || !valid || busy) return;
    setBusy(true);
    const spec: SlotSpec = { patternName: pattern.name, side: side || null, tier: tier || null };
    const supabase = createBrowserClient();
    const { data: row, error } = await supabase
      .from("group_workout_exercises")
      .insert({
        workout_id: workoutId,
        group_id: groupId,
        exercise_name: slotPlaceholderName(spec),
        exercise_order: nextOrder,
        movement_pattern_id: pattern.id,
        is_slot: true,
        slot_side: spec.side,
        slot_tier: spec.tier,
      })
      .select("id, tracked_fields")
      .single();
    if (error || !row) {
      setBusy(false);
      onError("Couldn't add that slot. Try again.");
      return;
    }
    const { data: setRows, error: setError } = await supabase
      .from("group_workout_exercise_sets")
      .insert(Array.from({ length: setCount }, (_, i) => ({ group_workout_exercise_id: row.id, set_order: i, target_reps: reps.trim() || null })))
      .select(SET_ROW_SELECT);
    if (setError) {
      // A slot with no sets is half-made: take it back out.
      await bestEffort(supabase.from("group_workout_exercises").delete().eq("id", row.id));
      setBusy(false);
      onError("Couldn't add that slot. Try again.");
      return;
    }
    setBusy(false);
    onAdded({
      kind: "exercise",
      id: row.id,
      order: nextOrder,
      exerciseName: slotPlaceholderName(spec),
      displayName: null,
      movementPatternId: pattern.id,
      trackedFields: row.tracked_fields ?? [],
      notes: null,
      videoPath: null,
      youtubeUrl: null,
      tier: null,
      slot: { side: spec.side, tier: spec.tier },
      sets: (setRows ?? []).map(mapSetRow).sort((a, b) => a.setOrder - b.setOrder),
    });
  }

  return (
    <div className="border border-dashed border-steel/40 p-3 space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="font-body text-xs text-steel">
          Pattern
          <select value={patternId} onChange={(e) => setPatternId(e.target.value)} className={`${select} block mt-1`}>
            <option value="">Choose a pattern</option>
            {patterns.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="font-body text-xs text-steel">
          Side
          <select value={side} onChange={(e) => setSide(e.target.value as "" | Side)} className={`${select} block mt-1`}>
            {SIDE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="font-body text-xs text-steel">
          Class
          <select value={tier} onChange={(e) => setTier(e.target.value as "" | SlotTier)} className={`${select} block mt-1`}>
            {CLASS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="font-body text-xs text-steel">
          Sets
          <input type="number" min={1} max={MAX_SETS} value={sets} onChange={(e) => setSets(e.target.value)} className={`${select} block mt-1 w-16`} />
        </label>
        <label className="font-body text-xs text-steel">
          Reps
          <input type="text" value={reps} onChange={(e) => setReps(e.target.value)} className={`${select} block mt-1 w-20`} />
        </label>
      </div>
      {patterns.length === 0 && <p className="font-body text-xs text-steel">You have no movement patterns yet. Add the starter ladders in the Exercise Library first.</p>}
      <div className="flex items-center gap-2">
        <button type="button" onClick={add} disabled={!valid || busy} className="min-h-10 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40">
          {busy ? "Adding…" : "Add slot"}
        </button>
        <button type="button" onClick={onCancel} className="min-h-10 px-3 font-body text-sm text-steel">
          Cancel
        </button>
      </div>
    </div>
  );
}

// A slot in a day: dashed, reads "Hinge · Unilateral · Class A", with sets x reps. Changing any part saves straight away.
export function SlotCard({
  exercise,
  patterns,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onChange,
  onDeleted,
  onError,
}: {
  exercise: BuilderExercise;
  patterns: PatternOption[];
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onChange: (patch: Partial<BuilderExercise>) => void;
  onDeleted: () => void;
  onError: (message: string) => void;
}) {
  const slot = exercise.slot ?? { side: null, tier: null };
  const pattern = patterns.find((p) => p.id === exercise.movementPatternId) ?? null;
  const [reps, setReps] = useState(slotRepsOf(exercise.sets));
  const [busy, setBusy] = useState(false);
  const label = pattern ? slotLabel({ patternName: pattern.name, side: slot.side, tier: slot.tier }) : exercise.exerciseName.replace(/^Slot: /, "");

  async function saveSpec(next: { patternId?: string; side?: Side | null; tier?: SlotTier | null }) {
    const patternId = next.patternId ?? exercise.movementPatternId;
    const patternName = patterns.find((p) => p.id === patternId)?.name;
    if (!patternId || !patternName) return;
    const spec: SlotSpec = { patternName, side: next.side !== undefined ? next.side : slot.side, tier: next.tier !== undefined ? next.tier : slot.tier };
    const { error } = await createBrowserClient()
      .from("group_workout_exercises")
      .update({ movement_pattern_id: patternId, exercise_name: slotPlaceholderName(spec), slot_side: spec.side, slot_tier: spec.tier })
      .eq("id", exercise.id);
    if (error) {
      onError("Couldn't save that change. Try again.");
      return;
    }
    onChange({ movementPatternId: patternId, exerciseName: slotPlaceholderName(spec), slot: { side: spec.side, tier: spec.tier } });
  }

  async function saveSets(count: number) {
    if (busy || !Number.isInteger(count) || count < 1 || count > MAX_SETS || count === exercise.sets.length) return;
    setBusy(true);
    const supabase = createBrowserClient();
    const sorted = exercise.sets.slice().sort((a, b) => a.setOrder - b.setOrder);
    if (count > sorted.length) {
      const { data, error } = await supabase
        .from("group_workout_exercise_sets")
        .insert(Array.from({ length: count - sorted.length }, (_, i) => ({ group_workout_exercise_id: exercise.id, set_order: sorted.length + i, target_reps: reps.trim() || null })))
        .select(SET_ROW_SELECT);
      if (error) onError("Couldn't save the sets. Try again.");
      else onChange({ sets: [...sorted, ...(data ?? []).map(mapSetRow)].sort((a, b) => a.setOrder - b.setOrder) });
    } else {
      const drop = sorted.slice(count).map((s) => s.id);
      const { error } = await supabase.from("group_workout_exercise_sets").delete().in("id", drop);
      if (error) onError("Couldn't save the sets. Try again.");
      else onChange({ sets: sorted.slice(0, count) });
    }
    setBusy(false);
  }

  async function saveReps() {
    const value = reps.trim() || null;
    if ((exercise.sets[0]?.targetReps ?? null) === value) return;
    const { error } = await createBrowserClient().from("group_workout_exercise_sets").update({ target_reps: value }).eq("group_workout_exercise_id", exercise.id);
    if (error) {
      onError("Couldn't save the reps. Try again.");
      return;
    }
    onChange({ sets: exercise.sets.map((s) => ({ ...s, targetReps: value })) });
  }

  async function remove() {
    if (!(await confirmDialog("Remove this slot?"))) return;
    const { error } = await createBrowserClient().from("group_workout_exercises").delete().eq("id", exercise.id);
    if (error) {
      onError("Couldn't remove that slot. Try again.");
      return;
    }
    onDeleted();
  }

  return (
    <div className="border border-dashed border-steel/40 bg-surface/20 p-3" data-testid="slot-card">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-body font-medium text-[15px]">{label}</p>
          <p className="font-body text-xs text-steel mt-0.5">The exercise is picked when you assign it.</p>
        </div>
        <div className="flex items-center shrink-0">
          <button type="button" onClick={onMoveUp} disabled={!canMoveUp} aria-label="Move up" className="w-9 h-9 flex items-center justify-center text-steel disabled:opacity-30">
            <ChevronUp className="w-4 h-4" />
          </button>
          <button type="button" onClick={onMoveDown} disabled={!canMoveDown} aria-label="Move down" className="w-9 h-9 flex items-center justify-center text-steel disabled:opacity-30">
            <ChevronDown className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-2 mt-2">
        <label className="font-body text-xs text-steel">
          Pattern
          <select value={exercise.movementPatternId ?? ""} onChange={(e) => void saveSpec({ patternId: e.target.value })} className={`${select} block mt-1`}>
            {patterns.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="font-body text-xs text-steel">
          Side
          <select value={slot.side ?? ""} onChange={(e) => void saveSpec({ side: (e.target.value || null) as Side | null })} className={`${select} block mt-1`}>
            {SIDE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="font-body text-xs text-steel">
          Class
          <select value={slot.tier ?? ""} onChange={(e) => void saveSpec({ tier: (e.target.value || null) as SlotTier | null })} className={`${select} block mt-1`}>
            {CLASS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="font-body text-xs text-steel">
          Sets
          <input
            type="number"
            min={1}
            max={MAX_SETS}
            defaultValue={exercise.sets.length}
            onBlur={(e) => void saveSets(Number(e.target.value))}
            className={`${select} block mt-1 w-16`}
          />
        </label>
        <label className="font-body text-xs text-steel">
          Reps
          <input type="text" value={reps} onChange={(e) => setReps(e.target.value)} onBlur={() => void saveReps()} className={`${select} block mt-1 w-20`} />
        </label>
        <button type="button" onClick={remove} className="min-h-10 px-3 font-body text-sm text-steel active:text-rust">
          Remove
        </button>
      </div>
    </div>
  );
}
