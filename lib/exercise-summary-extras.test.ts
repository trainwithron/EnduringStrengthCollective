import { describe, it, expect } from "vitest";
import { summarizeSets } from "@/lib/exercise-summary";

const set = (o: Record<string, unknown> = {}) => ({
  targetReps: null as string | null,
  targetWeight: null as number | null,
  targetTimeSeconds: null as number | null,
  targetDistance: null as number | null,
  targetHeight: null as number | null,
  targetRestSeconds: null as number | null,
  targetRpe: null as number | null,
  targetRir: null as number | null,
  targetTempo: null as string | null,
  targetPace: null as string | null,
  ...o,
});
const three = (o: Record<string, unknown>) => [1, 2, 3].map(() => set({ targetReps: "8", ...o }));
const extras = { withExtras: true };

describe("summarizeSets: effort and style, for the client preview", () => {
  it("RPE, as one value or a range", () => {
    expect(summarizeSets(three({ targetRpe: 8 }), ["reps", "rpe"], extras)).toBe("3x8 · RPE 8");
    const mixed = [set({ targetReps: "8", targetRpe: 7 }), set({ targetReps: "8", targetRpe: 8 }), set({ targetReps: "8", targetRpe: 8 })];
    expect(summarizeSets(mixed, ["reps", "rpe"], extras)).toBe("3x8 · RPE 7-8");
  });
  it("RIR, tempo and pace", () => {
    expect(summarizeSets(three({ targetRir: 2 }), ["reps", "rir"], extras)).toBe("3x8 · RIR 2");
    expect(summarizeSets(three({ targetTempo: "3-1-1" }), ["reps", "tempo"], extras)).toBe("3x8 · tempo 3-1-1");
    expect(summarizeSets(three({ targetPace: "8:30" }), ["reps", "pace"], extras)).toBe("3x8 · pace 8:30");
  });
  it("all together in a steady order: load, then effort and style, then rest", () => {
    const sets = three({ targetWeight: 100, targetRpe: 8, targetTempo: "3-1-1", targetRestSeconds: 120 });
    expect(summarizeSets(sets, ["reps", "weight", "rpe", "tempo", "rest"], { withExtras: true, withRest: true })).toBe("3x8 @ 100 lb · RPE 8 · tempo 3-1-1 · rest 120s");
  });
  it("is left out of the compact summary, and when a set has no value", () => {
    expect(summarizeSets(three({ targetRpe: 8 }), ["reps", "rpe"])).toBe("3x8");
    const gap = [set({ targetReps: "8", targetRpe: 8 }), set({ targetReps: "8" }), set({ targetReps: "8", targetRpe: 8 })];
    expect(summarizeSets(gap, ["reps", "rpe"], extras)).toBe("3x8");
  });
  it("a pace and load prescription is not hidden behind 'N sets' when nothing else is tracked", () => {
    const sets = [1, 2].map(() => set({ targetWeight: 40, targetPace: "easy" }));
    expect(summarizeSets(sets, ["weight", "pace"], extras)).toBe("2 sets @ 40 lb · pace easy");
  });
  it("a field the exercise does not track is ignored even if it holds a value", () => {
    expect(summarizeSets(three({ targetRpe: 8, targetTempo: "3-1-1" }), ["reps"], extras)).toBe("3x8");
  });
});
