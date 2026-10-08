import { describe, it, expect } from "vitest";
import { summarizeSets } from "@/lib/exercise-summary";
import type { TrackedField } from "@/lib/exercise-fields";

const set = (o: Partial<Record<string, string | number | null>> = {}) => ({
  targetReps: null as string | null,
  targetWeight: null as number | null,
  targetTimeSeconds: null as number | null,
  targetDistance: null as number | null,
  targetHeight: null as number | null,
  targetRestSeconds: null as number | null,
  ...(o as object),
});
const repsWeight: TrackedField[] = ["reps", "weight", "rpe"];

describe("summarizeSets", () => {
  it("uniform reps: 3x10", () => {
    expect(summarizeSets([set({ targetReps: "10" }), set({ targetReps: "10" }), set({ targetReps: "10" })], repsWeight)).toBe("3x10");
  });
  it("adds the load when present: 3x10 @ 50 lb", () => {
    const s = [1, 2, 3].map(() => set({ targetReps: "10", targetWeight: 50 }));
    expect(summarizeSets(s, repsWeight)).toBe("3x10 @ 50 lb");
    expect(summarizeSets(s, repsWeight, { weightUnit: "kg" })).toBe("3x10 @ 50 kg");
  });
  it("a timed hold shows the time: 3x60s", () => {
    const s = [1, 2, 3].map(() => set({ targetTimeSeconds: 60 }));
    expect(summarizeSets(s, ["time"])).toBe("3x60s");
  });
  it("reps that step down read as a list: 10/8/6", () => {
    expect(summarizeSets([set({ targetReps: "10" }), set({ targetReps: "8" }), set({ targetReps: "6" })], repsWeight)).toBe("10/8/6");
  });
  it("reps that are not one steady direction read as a range: 3x8-10", () => {
    expect(summarizeSets([set({ targetReps: "8" }), set({ targetReps: "10" }), set({ targetReps: "8" })], repsWeight)).toBe("3x8-10");
  });
  it("a typed range per set stays as typed", () => {
    expect(summarizeSets([1, 2, 3].map(() => set({ targetReps: "8-12" })), repsWeight)).toBe("3x8-12");
  });
  it("different loads across sets are a range of loads", () => {
    const s = [set({ targetReps: "5", targetWeight: 135 }), set({ targetReps: "5", targetWeight: 155 }), set({ targetReps: "5", targetWeight: 175 })];
    expect(summarizeSets(s, repsWeight)).toBe("3x5 @ 135-175 lb");
  });
  it("sets with nothing filled in say so plainly", () => {
    expect(summarizeSets([set(), set(), set()], repsWeight)).toBe("3 sets");
    expect(summarizeSets([set()], repsWeight)).toBe("1 set");
    expect(summarizeSets([], repsWeight)).toBe("no sets yet");
  });
  it("rest is shown only when asked for (the preview), not on the compact card", () => {
    const s = [1, 2, 3].map(() => set({ targetReps: "10", targetRestSeconds: 90 }));
    const tracked: TrackedField[] = ["reps", "rest"];
    expect(summarizeSets(s, tracked)).toBe("3x10");
    expect(summarizeSets(s, tracked, { withRest: true })).toBe("3x10 · rest 90s");
  });
  it("a field the exercise does not track is ignored even if it holds a value", () => {
    expect(summarizeSets([set({ targetReps: "10", targetWeight: 50 })], ["reps"])).toBe("1x10");
  });
  it("distance and height are shown for exercises that track them", () => {
    expect(summarizeSets([set({ targetDistance: 400 }), set({ targetDistance: 400 })], ["distance"])).toBe("2x400");
    expect(summarizeSets([set({ targetHeight: 24 })], ["height"])).toBe("1x24");
  });
});
