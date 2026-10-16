import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ageStatusFromDob, athleteAgeStatus, clampYouthRows, YOUTH_RPE_CAP } from "@/lib/youth-block";
import { assignNotices } from "@/lib/assign-notice";
import { clampMealMacros, clampPer100g, userBelongsToAGroup } from "@/lib/ai-nutrition-clamp";
import { PAIN_MONITORING_GUIDANCE } from "@/lib/pain-guidance";
import { buildDaySystemPrompt } from "@/lib/ai-day-run";

const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const now = new Date("2026-10-16T12:00:00Z");

describe("an unknown age is never treated as an adult", () => {
  it("a missing or broken birthdate is 'unknown', an old one adult, a young one minor", () => {
    expect(ageStatusFromDob(null, now)).toBe("unknown");
    expect(ageStatusFromDob("", now)).toBe("unknown");
    expect(ageStatusFromDob("not a date", now)).toBe("unknown");
    expect(ageStatusFromDob("1990-04-23", now)).toBe("adult");
    expect(ageStatusFromDob("2010-04-23", now)).toBe("minor");
  });
  it("a failed read is 'unknown' too, never 'adult'", async () => {
    const q: any = { select: () => q, eq: () => q, maybeSingle: () => Promise.resolve({ data: null, error: { message: "x" } }) };
    expect(await athleteAgeStatus({ from: () => q } as any, "a")).toBe("unknown");
  });
  it("the three AI routes use it", () => {
    for (const p of ["app/api/ai/build-day/route.ts", "app/api/ai/generate-program/route.ts", "app/api/ai/pick-template/route.ts"]) expect(src(p), p).toContain("athleteAgeStatus");
  });
});

describe("a young client's program is clamped on the server", () => {
  it("effort above RPE 8 is lowered, reps outside 6 to 15 are flagged, AMRAP and in-range reps are left", () => {
    const rows = [
      { exerciseName: "Squat", reps: "5", rpe: 9 },
      { exerciseName: "Curl", reps: "20", rpe: 7 },
      { exerciseName: "Row", reps: "8-12", rpe: 8 },
      { exerciseName: "Plank Hold", reps: "AMRAP", rpe: null },
    ];
    const out = clampYouthRows(rows);
    expect(out.rows.map((r) => r.rpe)).toEqual([YOUTH_RPE_CAP, 7, 8, null]);
    expect(out.flags.some((f) => f.startsWith("Squat is written as 5 reps"))).toBe(true);
    expect(out.flags.some((f) => f.startsWith("Curl is written as 20 reps"))).toBe(true);
    expect(out.flags.some((f) => f.startsWith("Row"))).toBe(false);
    expect(out.flags.some((f) => f.startsWith("Effort was lowered to RPE 8"))).toBe(true);
    expect(clampYouthRows([{ exerciseName: "Squat", reps: "8", rpe: 7 }]).flags).toEqual([]);
  });
});

describe("the day builder says the same about pain as the whole-program builder", () => {
  it("a client with a flagged concern gets the shared pain guidance in the day prompt", () => {
    expect(buildDaySystemPrompt({ youthBlock: null, hasInjury: true })).toContain(PAIN_MONITORING_GUIDANCE);
    expect(buildDaySystemPrompt({ youthBlock: null, hasInjury: false })).not.toContain(PAIN_MONITORING_GUIDANCE);
    expect(src("app/api/ai/generate-program/route.ts")).toContain('from "@/lib/pain-guidance"');
  });
});

describe("assigning a program tells the coach what is on file now", () => {
  it("under 18, no birthdate and a flagged health concern each get one plain line", () => {
    const out = assignNotices(
      [
        { name: "Sam", dateOfBirth: "2012-01-05", parqFlagged: false },
        { name: "Lee", dateOfBirth: null, parqFlagged: false },
        { name: "Kim", dateOfBirth: "1990-01-05", parqFlagged: true },
        { name: "Pat", dateOfBirth: "1990-01-05", parqFlagged: false },
      ],
      now
    );
    expect(out).toEqual([
      "Sam is under 18. Check the program is technique first, with no max testing and no maximal loads.",
      "Lee has no birthdate on file. Check their age before you assign.",
      "Kim has a flagged health concern on their screening. Check the program works around it.",
    ]);
    expect(assignNotices([{ name: "Pat", dateOfBirth: "1990-01-05", parqFlagged: false }], now)).toEqual([]);
    expect(src("components/coach/desktop/program-assign-panel.tsx")).toContain("assignNotices(");
  });
});

describe("meal and recipe numbers from the AI are believable", () => {
  it("meal macros are held to 0..5000 kcal and 0..500 g, whatever the model said", () => {
    expect(clampMealMacros({ calories: 90000, proteinG: -5, carbsG: 1200, fatG: 40.6 })).toEqual({ calories: 5000, proteinG: 0, carbsG: 500, fatG: 41 });
    expect(clampMealMacros({ calories: Number.NaN, proteinG: 30, carbsG: 50, fatG: 10 }).calories).toBe(0);
  });
  it("food per 100 g cannot have more than 100 g of a macro", () => {
    expect(clampPer100g({ calories: 5000, proteinG: 250, carbsG: -1, fatG: 99 })).toEqual({ calories: 900, proteinG: 100, carbsG: 0, fatG: 99 });
  });
  it("the AI calls need a group, and the routes use the clamps", async () => {
    const withGroup: any = { from: () => ({ select: () => ({ eq: () => ({ limit: () => Promise.resolve({ data: [{ group_id: "g" }], error: null }) }) }) }) };
    const none: any = { from: () => ({ select: () => ({ eq: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }) }) };
    expect(await userBelongsToAGroup(withGroup, "u")).toBe(true);
    expect(await userBelongsToAGroup(none, "u")).toBe(false);
    for (const p of ["app/api/ai/parse-food-log/route.ts", "app/api/ai/parse-food-photo/route.ts"]) {
      expect(src(p), p).toContain("clampMealMacros(parsed)");
      expect(src(p), p).toContain("userBelongsToAGroup");
    }
    expect(src("app/api/ai/parse-inbody-scan/route.ts")).toContain("userBelongsToAGroup");
    expect(src("app/api/ai/parse-recipe/route.ts")).toContain("clampPer100g(");
    expect(src("app/api/ai/parse-session-nl/route.ts")).toContain("clampAiRow(");
    expect(src("app/api/ai/parse-session-nl/route.ts")).toContain("exerciseNameProblem(r.exerciseName)");
  });
});

describe("the builder routes", () => {
  it("pick-template charges only for a usable answer, program-chat saves only a real answer, coach-conversation has a hard stop", () => {
    const pick = src("app/api/ai/pick-template/route.ts");
    expect(pick.indexOf("if (!picks.some((p) => p.exercise))")).toBeLessThan(pick.indexOf("checkAndSpendCoachCredits("));
    const chat = src("app/api/ai/program-chat/route.ts");
    expect(chat).toContain("if (answered) {");
    expect(chat.indexOf("if (answered) {")).toBeLessThan(chat.indexOf('from("coach_chat_messages").insert'));
    expect(src("app/api/ai/coach-conversation/route.ts")).toContain("conv.coach_turns > chapter.maxCoachTurns");
  });
  it("the AI-built names are cleaned and checked, and the AI run secret fails closed in production", () => {
    const day = src("app/api/ai/build-day/route.ts");
    expect(day).toContain(".filter((e) => !exerciseNameProblem(e.exerciseName))");
    expect(day).toContain("is not in your library.");
    expect(src("lib/ai-day-run.ts")).toContain('throw new Error("AI run secret is not configured")');
  });
  it("preference text is capped on the way in and out, and a whole roster's training maxes are not put in a prompt", () => {
    expect(src("app/api/ai/coach-conversation/route.ts")).toContain(".slice(0, MAX_RULE_TEXT)");
    expect(src("app/api/learned-rules/[ruleId]/route.ts")).toContain(".slice(0, MAX_RULE_TEXT)");
    expect(src("app/api/ai/explain-program/route.ts")).toContain(".slice(0, MAX_RULE_TEXT)");
    const gen = src("app/api/ai/generate-program/route.ts");
    expect(gen).toContain(".slice(0, 10);");
    expect(gen).toContain("const athleteIds = namedRows.map");
    expect(src("lib/collective-intelligence-lookups.ts")).toContain("Math.min(365, Math.max(1,");
  });
  it("a transfer already made for a Stripe event is found by its group before another is created", () => {
    expect(src("app/api/stripe/webhook/route.ts")).toContain("stripe.transfers.list({ transfer_group: eventId");
  });
});
