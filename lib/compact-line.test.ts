import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { formatCompactLine, clock } from "@/lib/compact-line";
import { compactKey, parseCompact, readCompact, serializeCompact, toggleDay, toggleWeek, writeCompact } from "@/lib/compact-days";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");
const set = (o: Partial<{ targetReps: string | null; targetWeight: number | null; targetTimeSeconds: number | null; targetDistance: number | null; repMin: number | null; repMax: number | null }> = {}) => ({
  targetReps: null, targetWeight: null, targetTimeSeconds: null, targetDistance: null, repMin: null, repMax: null, ...o,
});

describe("the compact line for an exercise", () => {
  it("reads sets x reps", () => {
    expect(formatCompactLine([set({ targetReps: "8" }), set({ targetReps: "8" }), set({ targetReps: "8" })], ["reps"])).toBe("3x8");
    expect(formatCompactLine(Array.from({ length: 4 }, () => set({ targetReps: "10" })), ["reps", "weight"])).toBe("4x10");
  });
  it("shows a rep range as written", () => {
    expect(formatCompactLine(Array.from({ length: 4 }, () => set({ targetReps: "6-8" })), ["reps"])).toBe("4x6-8");
    expect(formatCompactLine(Array.from({ length: 4 }, () => set({ targetReps: "6 - 8" })), ["reps"])).toBe("4x6-8");
    expect(formatCompactLine(Array.from({ length: 3 }, () => set({ repMin: 5, repMax: 7 })), ["reps"])).toBe("3x5-7");
  });
  it("shows the weight only when one is set (or logged)", () => {
    expect(formatCompactLine(Array.from({ length: 4 }, () => set({ targetReps: "8", targetWeight: 135 })), ["reps", "weight"])).toBe("4x8 @135");
    expect(formatCompactLine(Array.from({ length: 4 }, () => set({ targetReps: "8" })), ["reps", "weight"])).toBe("4x8");
    expect(formatCompactLine(Array.from({ length: 4 }, () => set({ targetReps: "8" })), ["reps", "weight"], 95)).toBe("4x8 @95");
    // a weight is not shown if the exercise does not track weight
    expect(formatCompactLine([set({ targetReps: "8", targetWeight: 135 })], ["reps"])).toBe("1x8");
  });
  it("lists the values when the sets differ instead of hiding it", () => {
    expect(formatCompactLine([set({ targetReps: "8" }), set({ targetReps: "6" }), set({ targetReps: "6" })], ["reps"])).toBe("8/6/6");
    expect(formatCompactLine([set({ targetReps: "5", targetWeight: 135 }), set({ targetReps: "5", targetWeight: 155 })], ["reps", "weight"])).toBe("2x5 @135/155");
  });
  it("shows a timed row as m:ss", () => {
    expect(formatCompactLine([set({ targetTimeSeconds: 1200 })], ["time"])).toBe("20:00");
    expect(formatCompactLine([set({ targetTimeSeconds: 90 }), set({ targetTimeSeconds: 90 }), set({ targetTimeSeconds: 90 })], ["time"])).toBe("3x1:30");
    expect(clock(65)).toBe("1:05");
  });
  it("falls back to the number of sets when there is nothing to show", () => {
    expect(formatCompactLine([set(), set()], ["reps"])).toBe("2 sets");
    expect(formatCompactLine([set()], ["reps"])).toBe("1 set");
    expect(formatCompactLine([], ["reps"])).toBe("No sets");
  });
});

describe("remembering the compact days", () => {
  it("parses safely and round-trips", () => {
    expect(parseCompact(null).size).toBe(0);
    expect(parseCompact("not json").size).toBe(0);
    expect(parseCompact('{"a":1}').size).toBe(0);
    expect([...parseCompact(serializeCompact(new Set(["a", "b"])))].sort()).toEqual(["a", "b"]);
  });
  it("switches one day, and the whole week", () => {
    expect([...toggleDay(new Set(["a"]), "b")].sort()).toEqual(["a", "b"]);
    expect([...toggleDay(new Set(["a", "b"]), "a")]).toEqual(["b"]);
    expect([...toggleWeek(new Set(["a"]), ["a", "b", "c"])].sort()).toEqual(["a", "b", "c"]);
    expect([...toggleWeek(new Set(["a", "b", "c", "z"]), ["a", "b", "c"])]).toEqual(["z"]);
    expect(toggleWeek(new Set(), []).size).toBe(0);
  });
  it("is kept per program and week in this browser, never in the program, and survives a storage that fails", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    writeCompact(storage, "p1", 2, new Set(["d1"]));
    expect([...readCompact(storage, "p1", 2)]).toEqual(["d1"]);
    expect(readCompact(storage, "p1", 3).size).toBe(0);
    expect(readCompact(storage, "p2", 2).size).toBe(0);
    expect(compactKey("p1", 2)).toBe("builder-compact:p1:2");
    const broken = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } };
    expect(readCompact(broken, "p1", 2).size).toBe(0);
    expect(() => writeCompact(broken, "p1", 2, new Set(["d1"]))).not.toThrow();
  });
});

describe("the builder wiring", () => {
  it("each day has its own Compact / Full switch, the week keeps its Compact view, and compact days get a narrower column", () => {
    const day = read("components/coach/desktop/day-card.tsx");
    expect(day).toContain("onToggleCondensed");
    expect(day).toContain('{condensed ? "Full" : "Compact"}');
    expect(day).toContain("formatCompactLine(item.sets, item.trackedFields, loggedWeight)");
    const grid = read("components/coach/desktop/week-grid.tsx");
    expect(grid).toContain("min-w-[220px] max-w-[300px]");
    expect(grid).toContain("editingCompactIds.has(day.id)");
    expect(grid).toContain("min-w-[300px] max-w-[420px]");
    expect(grid).toContain('"Full view" : "Compact view"');
    expect(grid).toContain("writeCompact(window.localStorage, programId, weekNumber, next)");
  });
  it("a compact line opens the normal editor in place, and notes and demos stay reachable as icons", () => {
    const day = read("components/coach/desktop/day-card.tsx");
    expect(day).toContain("function renderExerciseCard(");
    expect(day).toContain("openCompactIds.has(item.id)");
    expect(day).toContain('aria-label="Has a coach note"');
    expect(day).toContain('aria-label="Has a demo video"');
  });
});
