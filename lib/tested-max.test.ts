import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseTestedMax, testedByName } from "./tested-max";

// Wave 2 T2 (Ron, Nov 20): a coach-typed tested max per athlete per lift that the coach can LOCK, so auto-estimates don't overwrite it.
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

describe("what the coach types", () => {
  it("a lift and a weight in pounds, checked the way the database checks them", () => {
    expect(parseTestedMax(" Back Squat ", "225")).toEqual({ ok: true, name: "Back Squat", weight: 225 });
    expect(parseTestedMax("Bench", "182,5")).toEqual({ ok: true, name: "Bench", weight: 182.5 });
    expect(parseTestedMax("", "225").ok).toBe(false);
    expect(parseTestedMax("Bench", "0").ok).toBe(false);
    expect(parseTestedMax("Bench", "2001").ok).toBe(false);
    expect(parseTestedMax("Bench", "lots").ok).toBe(false);
  });
  it("a kilogram coach types kilograms; it is stored in pounds (Code Chat's review of 3234005a)", () => {
    expect(parseTestedMax("Bench", "100", "kg")).toEqual({ ok: true, name: "Bench", weight: 220.5 });
    expect(parseTestedMax("Bench", "908", "kg").ok).toBe(false);
    expect(read("app/(coach)/groups/[groupId]/athletes/[athleteId]/page.tsx")).toContain("liftUnit={coachLiftUnit}");
    const control = read("components/coach/progress/tested-max-control.tsx");
    expect(control).toContain("parseTestedMax(name, draft, unit)");
    expect(control).toContain("formatLift(tested.weight, unit)");
  });
});

describe("what the cards show", () => {
  it("only locked rows count as tested, matched by name the way the cards match", () => {
    const m = testedByName([
      { exercise_name: "Back Squat", estimated_max: "225", locked: true, tested_at: "2026-11-20T00:00:00Z" },
      { exercise_name: "Bench Press", estimated_max: 180, locked: false, tested_at: null },
    ]);
    expect([...m.keys()]).toEqual(["back squat"]);
    expect(m.get("back squat")?.weight).toBe(225);
  });
  it("a tested max shows instead of the estimate, and a coach of the client (not on their own page) can set or unlock it", () => {
    const cards = read("components/coach/progress/training-max-cards.tsx");
    expect(cards).toContain("{Math.round((c.tested?.weight ?? c.bestE1rm) as number)}");
    expect(cards).toContain("<TestedMaxControl athleteId={athleteId} exerciseName=\"\" tested={null} askName unit={liftUnit} />");
    const page = read("app/(coach)/groups/[groupId]/athletes/[athleteId]/page.tsx");
    expect(page).toContain("canEditTested={!selfView && !testedRead.error}");
    const control = read("components/coach/progress/tested-max-control.tsx");
    expect(control).toContain('rpc("set_tested_max", { p_athlete: athleteId, p_exercise: parsed.name, p_weight: parsed.weight })');
    expect(control).toContain('rpc("unlock_tested_max", { p_athlete: athleteId, p_exercise: exerciseName })');
  });
});

describe("the database keeps it (step 214)", () => {
  const sql = read("supabase/migrations/0458_wave2_calendar.sql");
  it("in the training-max row every program rule already reads, locked, with who and when", () => {
    expect(sql).toContain("add column if not exists locked boolean not null default false");
    expect(sql).toContain("values (p_athlete, v_name, round(p_weight, 1), round(p_weight, 1), 1, 10, false, now(), true, auth.uid(), now())");
  });
  it("both estimate writers skip a locked max, and only a coach of the athlete may set it", () => {
    expect(sql).toContain("and not public.athlete_training_maxes.locked;");
    expect(sql).toContain("and not m.locked");
    expect(sql).toContain("if auth.uid() is null or not public.is_coach_of_athlete(p_athlete) then");
  });
});
