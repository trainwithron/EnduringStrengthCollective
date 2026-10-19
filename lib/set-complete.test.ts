import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isSetFilled } from "./set-complete";

// Ron, Sep 12: "I hate the checkboxes in the workout logger ... The big ones are weights and reps are the two nonnegotiables that have to be there. Outside of that, everything else should be optional ... we need to be
// able to leave certain fields blank."
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const grid = read("components/logging/exercise-set-grid.tsx");

const STRENGTH = ["weight", "reps", "rpe", "rir", "restSeconds"];

describe("when a set is done", () => {
  it("weight and reps complete it with RPE, RIR and rest left blank", () => {
    expect(isSetFilled({ weight: 135, reps: 8, rpe: null, rir: null, restSeconds: null }, STRENGTH, false)).toBe(true);
  });
  it("a typed set with only weight, or only reps, is not done", () => {
    expect(isSetFilled({ weight: 135, reps: null }, STRENGTH, false)).toBe(false);
    expect(isSetFilled({ weight: null, reps: 8 }, STRENGTH, false)).toBe(false);
  });
  it("clearing weight or reps un-completes it (an empty box is not a value)", () => {
    expect(isSetFilled({ weight: "", reps: 8 }, STRENGTH, false)).toBe(false);
    expect(isSetFilled({ weight: 135, reps: undefined }, STRENGTH, false)).toBe(false);
  });
  it("0 is a real value", () => {
    expect(isSetFilled({ weight: 0, reps: 10 }, STRENGTH, false)).toBe(true);
  });
  it("a bodyweight movement needs reps only", () => {
    expect(isSetFilled({ weight: null, reps: 12, rpe: null }, ["weight", "reps", "rpe"], true)).toBe(true);
    expect(isSetFilled({ weight: null, reps: null }, ["weight", "reps", "rpe"], true)).toBe(false);
    // a no-load exercise whose grid does not show weight at all
    expect(isSetFilled({ reps: 12 }, ["reps"], false)).toBe(true);
  });
  it("a timed exercise (no weight, no reps) is done with one value", () => {
    expect(isSetFilled({ timeSeconds: 45, rpe: null }, ["timeSeconds", "rpe"], false)).toBe(true);
    expect(isSetFilled({ timeSeconds: null, rpe: null }, ["timeSeconds", "rpe"], false)).toBe(false);
    expect(isSetFilled({ distance: 400 }, ["distance", "pace"], false)).toBe(true);
  });
  it("box height, tempo, time and distance never block a set that tracks weight and reps", () => {
    expect(isSetFilled({ weight: 95, reps: 5 }, ["weight", "reps", "height", "tempo", "timeSeconds", "distance", "pace"], false)).toBe(true);
  });
});

describe("the left dot accepts the planned set (no new mechanism)", () => {
  // The dot copies set 1's value into every other set and marks every set touched; the sets then complete under the rule above.
  it("tapping the dot on Weight and on Reps with the plan prefilled (135 x 8, three sets) completes every set", () => {
    const sets = [1, 2, 3].map(() => ({ weight: 135, reps: 8, rpe: null }));
    // what handlePropagateRow does for one row: copy set 1's value into the others
    const propagate = (prop: "weight" | "reps") => sets.slice(1).forEach((s) => (s[prop] = sets[0][prop]));
    propagate("weight");
    propagate("reps");
    expect(sets.every((s) => isSetFilled(s, ["weight", "reps", "rpe"], false))).toBe(true);
    const handler = grid.slice(grid.indexOf("async function handlePropagateRow("), grid.indexOf("function RowHandle("));
    expect(handler).toContain("markTouched(first.id, ...rest.map((s) => s.id));");
    // and a touched, filled set completes
    expect(grid).toContain('if (allFilled && set.status !== "completed" && touched) {');
  });
});

describe("the set grid has no checkboxes", () => {
  it("no Status row, no tap-to-complete, and nothing completes a set but its values", () => {
    expect(grid).not.toContain("toggleCheck");
    expect(grid).not.toContain("forcedIds");
    expect(grid).not.toContain("forced");
    expect(grid).not.toContain('"Set complete, tap to undo"');
  });
  it("a done set's number turns green, and tapping the number still marks a warm-up", () => {
    expect(grid).toContain('const doneMark = done ? "text-moss font-bold" : "";');
    expect(grid).toContain('const next = warmup ? "working" : "warmup";');
  });
  it("a set completed before the checkboxes went stays completed when the page loads", () => {
    expect(grid).toContain('} else if (!allFilled && set.status === "completed" && touched) {');
  });
});
