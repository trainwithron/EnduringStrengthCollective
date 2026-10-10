import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hasAnyLogged, loggedText, shapeLogged } from "@/lib/day-logged";
import { suggestedWeightsFromHistory } from "@/lib/suggested-weights";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");

describe("what the client logged, shaped for the builder", () => {
  const rows = [
    { set_order: 0, weight: 135, reps: 5, rpe: 7, rir: null, tempo: null, time_seconds: null, height: null, distance: null, rest_seconds: 90, pace: null, session_exercises: { group_workout_exercise_id: "slot1" } },
    { set_order: 1, weight: 135, reps: 4, rpe: null, rir: null, tempo: null, time_seconds: null, height: null, distance: null, rest_seconds: null, pace: null, session_exercises: { group_workout_exercise_id: "slot1" } },
    { set_order: 0, weight: 50, reps: 10, session_exercises: { group_workout_exercise_id: "slot2" } },
    { set_order: 0, weight: 1, reps: 1, session_exercises: { group_workout_exercise_id: null } },
  ];
  const logged = shapeLogged(rows as any);
  it("is by exercise slot and set number, set by set, with only the numbers that were logged", () => {
    expect(Object.keys(logged).sort()).toEqual(["slot1", "slot2"]);
    expect(logged.slot1[0]).toEqual({ weight: 135, reps: 5, rpe: 7, rest: 90 });
    expect(logged.slot1[1]).toEqual({ weight: 135, reps: 4 });
    expect(logged.slot2[0]).toEqual({ weight: 50, reps: 10 });
  });
  it("a set the client skipped has no entry, so it stays blank", () => {
    expect(logged.slot1[2]).toBeUndefined();
    expect(loggedText(logged.slot1[2], "weight")).toBe("");
  });
  it("reads as the prescription does: time and rest as m:ss", () => {
    expect(loggedText(logged.slot1[0], "rest")).toBe("1:30");
    expect(loggedText(logged.slot1[0], "weight")).toBe("135");
    expect(loggedText({ time: 90 }, "time")).toBe("1:30");
  });
  it("knows whether a day has anything logged", () => {
    expect(hasAnyLogged(logged)).toBe(true);
    expect(hasAnyLogged({})).toBe(false);
    expect(hasAnyLogged({ slot1: {} })).toBe(false);
  });
});

describe("the gray suggestion is the logger's, not a copy", () => {
  // A fake database that answers the one read the function makes: the template row each logged set was logged against (5 reps targeted).
  const db = { from: () => ({ select: () => ({ in: async () => ({ data: [{ group_workout_exercise_id: "t1", set_order: 0, target_reps: "5", target_rpe: null, target_rir: null }] }) }) }) };
  const history = [
    { weight: 100, reps: 5, rpe: null, rir: null, set_order: 0, completed_at: "2026-09-01T10:00:00Z", session_exercises: { exercise_name: "Back Squat", group_workout_exercise_id: "t1" } },
  ];
  it("gives the same weight the client's screen is given for the same data: history for the same reps, or a higher explicit target", async () => {
    const out = await suggestedWeightsFromHistory(
      db,
      [{ exerciseName: "Back Squat", sets: [{ id: "a", targetReps: "5", targetRpe: null, targetRir: null, targetWeight: null }, { id: "b", targetReps: "5", targetRpe: null, targetRir: null, targetWeight: 105 }, { id: "c", targetReps: "8", targetRpe: null, targetRir: null, targetWeight: null }] }],
      history
    );
    expect(out.get("a")).toBe(100);
    expect(out.get("b")).toBe(105);
    expect(out.has("c")).toBe(false);
  });
  it("the client's workout screen and the coach's builder route both call that one function, with the same history read", () => {
    const logger = read("lib/workout-overview-data.ts");
    const route = read("app/api/coach/day-logged/route.ts");
    for (const src of [logger, route]) {
      expect(src).toContain("suggestedWeightsFromHistory(");
      expect(src).toContain("PRIOR_SETS_SELECT");
      expect(src).not.toContain("findCorrelatingWeightSuggestion");
      expect(src).not.toContain("resolveWeightSuggestion");
    }
  });
});

describe("how it is wired without slowing the builder", () => {
  it("reads one day on demand, only for a client's own program and only while the day is open", () => {
    const card = read("components/coach/desktop/day-card.tsx");
    expect(card).toContain("useDayLogged(day.id, !!athleteId && !collapsed)");
    expect(read("components/coach/desktop/use-day-logged.ts")).toContain("if (!enabled) return;");
    expect(read("components/coach/desktop/week-grid.tsx")).toContain("athleteId={athleteId}");
  });
  it("the route is the group's coach only, returns nothing for a shared program, and computes suggestions only for a day with nothing logged", () => {
    const route = read("app/api/coach/day-logged/route.ts");
    expect(route).toContain('coach?.role !== "coach"');
    expect(route).toContain("if (!athleteId) return NextResponse.json({ logged: {}, suggestions: {} });");
    expect(route).toContain("if (hasAnyLogged(logged)) return NextResponse.json({ logged, suggestions: {} });");
    expect(route).toContain('.eq("status", "completed")');
  });
  it("logged cells are read-only and marked Logged, with no 'Prescribed' line (only what the client did), the stored prescription is never overwritten, and a gray suggestion is only a placeholder until the coach takes it", () => {
    const card = read("components/coach/exercise-builder-card.tsx");
    expect(card).toContain("Logged by the client");
    expect(card).not.toContain("prescribedSummary");
    expect(card).not.toContain("Prescribed");
    expect(card).toContain("placeholder={suggestion ??");
    expect(card).toContain("Use the suggested weights");
    // accepting writes each set's own suggested weight to the real prescription, nothing else
    expect(card).toContain('.update({ target_weight: suggestedWeights![s.id] })');
  });
});
