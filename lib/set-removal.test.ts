import { describe, expect, it } from "vitest";
import { canRemoveSet, lastSet, prescribedNote, removeSetConfirmText, restoreSetRow, setHasLoggedWork } from "@/lib/set-removal";
import type { SetLogEntry } from "@/lib/types";

function set(over: Partial<SetLogEntry> = {}): SetLogEntry {
  return {
    id: "s1",
    setOrder: 0,
    weight: null,
    reps: null,
    rpe: null,
    rir: null,
    tempo: null,
    timeSeconds: null,
    height: null,
    distance: null,
    restSeconds: null,
    pace: null,
    status: "pending",
    ...over,
  };
}

describe("taking a set off an exercise", () => {
  it("always keeps at least one set", () => {
    expect(canRemoveSet([])).toBe(false);
    expect(canRemoveSet([set()])).toBe(false);
    expect(canRemoveSet([set(), set({ id: "s2", setOrder: 1 })])).toBe(true);
  });

  it("takes the set with the highest order, whatever order the list is in", () => {
    const sets = [set({ id: "b", setOrder: 2 }), set({ id: "a", setOrder: 0 }), set({ id: "c", setOrder: 3 }), set({ id: "d", setOrder: 1 })];
    expect(lastSet(sets)?.id).toBe("c");
    expect(lastSet([])).toBeNull();
  });

  it("an untouched set, even one pre-filled by the program, goes without asking", () => {
    expect(setHasLoggedWork(set())).toBe(false);
    // Starting a workout pre-fills the program's own weight and reps: equal to the prescription means nobody touched it.
    expect(setHasLoggedWork(set({ weight: 185, reps: 5, targetWeight: 185, targetReps: 5 }))).toBe(false);
    expect(setHasLoggedWork(set({ reps: 5, targetReps: 5 }))).toBe(false);
  });

  it("typed numbers count as logged work even if the set was never completed (they would be lost)", () => {
    // reps typed on a set with no prescription, and reps changed from the prescription
    expect(setHasLoggedWork(set({ reps: 8 }))).toBe(true);
    expect(setHasLoggedWork(set({ reps: 8, targetReps: 5 }))).toBe(true);
    // weight typed or changed
    expect(setHasLoggedWork(set({ weight: 200 }))).toBe(true);
    expect(setHasLoggedWork(set({ weight: 200, targetWeight: 185 }))).toBe(true);
    // any of the other tracked numbers or notes
    for (const field of ["rpe", "rir", "timeSeconds", "height", "distance", "restSeconds"] as const) {
      expect(setHasLoggedWork(set({ [field]: 1 }))).toBe(true);
    }
    expect(setHasLoggedWork(set({ tempo: "3010" }))).toBe(true);
    expect(setHasLoggedWork(set({ pace: "8:30" }))).toBe(true);
  });

  it("a completed, skipped or weight-confirmed set asks first", () => {
    expect(setHasLoggedWork(set({ status: "completed" }))).toBe(true);
    expect(setHasLoggedWork(set({ status: "skipped" }))).toBe(true);
    expect(setHasLoggedWork(set({ weightConfirmed: true }))).toBe(true);
  });

  it("the confirm line names the set by its position", () => {
    expect(removeSetConfirmText(2)).toBe("Remove set 2? It's already logged.");
  });

  it("Undo puts back the same row: same id, order and values, a fresh completed time only for a completed set", () => {
    const now = new Date("2026-10-07T15:00:00Z");
    const done = restoreSetRow(set({ id: "x", setOrder: 2, weight: 135, reps: 8, status: "completed", weightConfirmed: true }), "ex1", now);
    expect(done).toMatchObject({ id: "x", session_exercise_id: "ex1", set_order: 2, weight: 135, reps: 8, status: "completed", weight_confirmed: true, completed_at: now.toISOString() });
    const skipped = restoreSetRow(set({ id: "y", status: "skipped" }), "ex1", now);
    expect(skipped).not.toHaveProperty("completed_at");
    expect(skipped).toMatchObject({ status: "skipped", weight_confirmed: false });
  });

  it("the coach's prescription stays visible: 'Prescribed 4' only when the count differs", () => {
    expect(prescribedNote(4, 3)).toBe("Prescribed 4");
    expect(prescribedNote(4, 5)).toBe("Prescribed 4");
    expect(prescribedNote(4, 4)).toBeNull();
    expect(prescribedNote(null, 3)).toBeNull();
    expect(prescribedNote(undefined, 3)).toBeNull();
    expect(prescribedNote(0, 3)).toBeNull();
  });
});
