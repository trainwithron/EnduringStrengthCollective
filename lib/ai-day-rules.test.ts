import { describe, it, expect } from "vitest";
import { exercisesWanted, allowsRepeats, applyTimedConsistency, dedupeDay, longDayFlag, mobilityDaysWanted, mobilityInstruction, mobilityRole, plainLibraryName, type DayRow } from "@/lib/ai-day-rules";
import { scanConstraints } from "@/lib/constraint-scan";

// The explicit parts of the prompt Ron tested the builder with (only what he actually wrote).
const RON =
  "3 day full body program. The only heavy lifting is upper body: overhead press, bench press, dips. No core rotations. Keep the hips loose: upright posture cossack squat, hip CARs, upright squat sits, adductor iso. 2 of the days are mobility days. Leg extension, hamstring curl, adductor and abductor machines are fine for the lower body.";

const row = (name: string, over: Partial<DayRow> = {}): DayRow => ({ exerciseName: name, sets: 3, reps: "8", weight: null, rpe: null, rest: null, timeSeconds: null, ...over });
const asScan = (names: string[]) => names.map((n) => ({ week: "Week 1", day: "Day 1", exerciseName: n, sets: 3, reps: "8", weight: null, rpe: null, rest: null, timeSeconds: null }) as never);

describe("never the same exercise twice in one day", () => {
  it("keeps the first of a repeated exercise (Barbell Overhead Press twice on Day 1)", () => {
    const out = dedupeDay([row("Barbell Overhead Press", { sets: 4, reps: "6-8" }), row("Barbell Bench Press"), row("Barbell Overhead Press", { reps: "8" })], allowsRepeats(RON));
    expect(out.rows.map((r) => r.exerciseName)).toEqual(["Barbell Overhead Press", "Barbell Bench Press"]);
    expect(out.rows[0].reps).toBe("6-8");
    expect(out.removed).toEqual(["Barbell Overhead Press"]);
  });
  it("ignores case and punctuation, and lets a repeat through only when the words ask for it", () => {
    expect(dedupeDay([row("Hip CARs"), row("hip cars")], false).rows).toHaveLength(1);
    expect(dedupeDay([row("Hip CARs"), row("Hip CARs")], allowsRepeats("do hip CARs twice")).rows).toHaveLength(2);
  });
});

describe("mobility days", () => {
  it("reads how many days are mobility days from his words", () => {
    expect(mobilityDaysWanted(RON)).toBe(2);
    expect(mobilityDaysWanted("two mobility days a week")).toBe(2);
    expect(mobilityDaysWanted("make 1 of the days mobility")).toBe(1);
    expect(mobilityDaysWanted("3 day full body program")).toBeNull();
  });
  it("decides each day of a 3-day week so exactly 2 end up mobility", () => {
    expect(mobilityRole({ wanted: 2, builtMobility: 0, daysLeft: 3 })).toBe("free");
    expect(mobilityRole({ wanted: 2, builtMobility: 0, daysLeft: 2 })).toBe("must");
    expect(mobilityRole({ wanted: 2, builtMobility: 1, daysLeft: 2 })).toBe("free");
    expect(mobilityRole({ wanted: 2, builtMobility: 1, daysLeft: 1 })).toBe("must");
    expect(mobilityRole({ wanted: 2, builtMobility: 2, daysLeft: 1 })).toBe("must_not");
    expect(mobilityRole({ wanted: null, builtMobility: 0, daysLeft: 1 })).toBe("free");
  });
  it("tells the model what this day is", () => {
    expect(mobilityInstruction("must", 2)).toContain('call it "Mobility"');
    expect(mobilityInstruction("must_not", 2)).toContain("NOT a mobility day");
    expect(mobilityInstruction("free", 2)).toBeNull();
  });
});

describe("only what he said counts as a constraint", () => {
  it("does not flag the machines he allowed", () => {
    const flags = scanConstraints(RON, asScan(["Leg Extension", "Lying Leg Curl", "Hamstring Curl Machine", "Hip Adductor Machine", "Barbell Bench Press", "Dip"]));
    expect(flags).toEqual([]);
  });
  it("a rotation is a soft note, never a conflict, so mobility work is not retried", () => {
    const flags = scanConstraints(RON, asScan(["Thoracic Rotation Stretch (Lunge)", "Cable Woodchop"]));
    expect(flags.length).toBe(2);
    expect(flags.every((f) => /no rotations/.test(f) && /Fine if it is mobility work/.test(f))).toBe(true);
    expect(flags.some((f) => /conflicts with|said to leave out/.test(f))).toBe(false);
  });
  it("still flags a real exclusion hard", () => {
    const flags = scanConstraints("no barbell squats, no jumping", asScan(["Barbell Back Squat", "Box Jump"]));
    expect(flags.some((f) => /Barbell Back Squat/.test(f) && /leave out|conflicts/.test(f))).toBe(true);
    expect(flags.some((f) => /Box Jump/.test(f))).toBe(true);
  });
});

describe("timed work is written the same way every day", () => {
  it("foam rolling is a time, never '1 set', and reuses the time already used", () => {
    const known = new Map([["foam rolling", 300]]);
    const out = applyTimedConsistency([row("Foam Rolling", { sets: 1, reps: "1", timeSeconds: null }), row("Barbell Bench Press")], known);
    expect(out[0]).toMatchObject({ timeSeconds: 300, reps: null });
    expect(out[1]).toMatchObject({ timeSeconds: null, reps: "8" });
    expect(applyTimedConsistency([row("Foam Rolling", { sets: 1, reps: null })], new Map())[0].timeSeconds).toBe(60);
    expect(applyTimedConsistency([row("Couch Stretch", { timeSeconds: 120, reps: null, sets: 1 })], new Map())[0].timeSeconds).toBe(120);
  });
});

describe("plain library names", () => {
  const library = ["Dumbbell Curl", "Hammer Curl", "Cable Hammer Curl (Rope)", "Barbell Bench Press"];
  it("snaps a grip-bracket, bicep, plural name to the plain library name", () => {
    expect(plainLibraryName("Dumbbell Bicep Curls (Supinated Grip)", library)).toBe("Dumbbell Curl");
    expect(plainLibraryName("Dumbbell Curls", library)).toBe("Dumbbell Curl");
  });
  it("never changes a real variant or a name the library does not have a plain one for", () => {
    expect(plainLibraryName("Cable Hammer Curl (Rope)", library)).toBe("Cable Hammer Curl (Rope)");
    expect(plainLibraryName("Barbell Bench Press", library)).toBe("Barbell Bench Press");
    expect(plainLibraryName("Dumbbell Bicep Curls (Supinated Grip)", ["Barbell Curl"])).toBe("Dumbbell Bicep Curls (Supinated Grip)");
  });
});

describe("a sensible day length", () => {
  it("yields to a number of exercises he asks for", () => {
    expect(exercisesWanted("I want 12 exercises a day")).toBe(12);
    expect(exercisesWanted("short sessions")).toBeNull();
    expect(longDayFlag(1, 1, 12, 12)).toBeNull();
    expect(longDayFlag(1, 1, 13, 12)).toContain("13 exercises");
  });
  it("flags only a day over ten exercises", () => {
    expect(longDayFlag(1, 1, 10)).toBeNull();
    expect(longDayFlag(1, 1, 11)).toContain("Week 1, Day 1 has 11 exercises");
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("the day route applies the rules", () => {
  const route = readFileSync(join(__dirname, "..", "app/api/ai/build-day/route.ts"), "utf8").replace(/\r\n/g, "\n");
  const prompt = readFileSync(join(__dirname, "ai-day-run.ts"), "utf8").replace(/\r\n/g, "\n");
  it("retries a day once when it breaks something he said to leave out, and only if there is time", () => {
    expect(route).toContain("hard.length > 0 && elapsed <= 28_000");
    expect(route.match(/await attempt\(/g)?.length).toBe(2);
    expect(route).toContain("isHard");
  });
  it("removes repeats, keeps timed items consistent, snaps to plain names, names the day by its purpose", () => {
    expect(route).toContain("dedupeDay(snapped, allowRepeat)");
    expect(route).toContain("applyTimedConsistency(");
    expect(route).toContain("plainLibraryName(");
    expect(route).toContain('.update({ title: dayTitle })');
    expect(route).toContain("longDayFlag(");
  });
  it("tells the model the same rules", () => {
    expect(prompt).toContain("Never write the same exercise twice in one day");
    expect(prompt).toContain("5 to 8 exercises");
    expect(prompt).toContain("PURPOSE");
    expect(prompt).toContain("timeSeconds");
  });
});
