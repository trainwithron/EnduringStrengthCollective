import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mobilityDayPlan, mobilityDaysWanted, mobilityInstruction, mobilityRole, namedMobilityDays, planRole } from "@/lib/ai-day-rules";
import { isFreshStart, isNewRequest, parseBuildRequest, planSlots, replanQueue, weekDaysFor } from "@/lib/ai-day-request";

// Ron, Nov 24 (by voice): every day of a 5-day split came out "Mobility". He meant "2 Mobility days"; the phone wrote "to".
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const RON = "5 day split 3 Days full body to Mobility days in between we will do a focus on she wants a bigger butt toned arms tone core strong back just generally aesthetic driven";

describe("how many mobility days", () => {
  it("Ron's exact sentence: 2 mobility days (\"to\" is \"two\"), in a 5-day week", () => {
    expect(mobilityDaysWanted(RON)).toBe(2);
    expect(parseBuildRequest(RON).daysPerWeek).toBe(5);
    expect(mobilityDaysWanted(RON, parseBuildRequest(RON).daysPerWeek)).toBe(2);
    expect(mobilityDaysWanted(RON.replace(" to Mobility", " 2 Mobility"))).toBe(2);
    expect(mobilityDaysWanted("3 full body days and too mobility days")).toBe(2);
  });
  it("a count never reaches across another number, split, program, week, full body or a list", () => {
    expect(mobilityDaysWanted("5 day split, 3 full body, 2 mobility days")).toBe(2);
    expect(mobilityDaysWanted("4 day split with legs and push and mobility work on day 4")).not.toBe(4);
    expect(mobilityDaysWanted("4 day program with mobility at the end of each day")).toBeNull();
    expect(mobilityDaysWanted("3 days full body mobility")).toBeNull();
  });
  it("the old cases still hold", () => {
    expect(mobilityDaysWanted("2 of the days are mobility")).toBe(2);
    expect(mobilityDaysWanted("two mobility days")).toBe(2);
    expect(mobilityDaysWanted("make 2 days mobility")).toBe(2);
    expect(mobilityDaysWanted("make 1 of the days mobility")).toBe(1);
    expect(mobilityDaysWanted("3 day full body program")).toBeNull();
  });
  it("a count not less than the week's days is not believed, unless the words say all / every day mobility", () => {
    expect(mobilityDaysWanted("5 mobility days", 5)).toBeNull();
    expect(mobilityDaysWanted("3 mobility days", 3)).toBeNull();
    expect(mobilityDaysWanted("2 mobility days", 3)).toBe(2);
    expect(mobilityDaysWanted("3 mobility days, all mobility this week", 3)).toBe(3);
    expect(mobilityDaysWanted("3 mobility sessions, mobility every day", 3)).toBe(3);
    // no week size known: the count stands
    expect(mobilityDaysWanted("3 mobility days")).toBe(3);
  });
  it("so Ron's week builds 3 lifting days: of 5 empty days, only the last 2 are forced to mobility", () => {
    const wanted = mobilityDaysWanted(RON, 5);
    expect(mobilityRole({ wanted, builtMobility: 0, daysLeft: 5 })).not.toBe("must");
    expect(mobilityRole({ wanted, builtMobility: 0, daysLeft: 2 })).toBe("must");
  });
});

// The same steps build-day takes for each day of the week (app/api/ai/build-day/route.ts): the week's size, the named days, the count, the plan, the role.
const RON_2 = "5 day split 3 day a week full body workouts then 2 days a week will be Mobility exercises she wants a strong core bigger butt toned arms and just generally aesthetic driven";
function weekRoles(sayings: string, opts: { sentDays?: number; trainingDays?: number[] | null } = {}): string[] {
  const daysInWeek = parseBuildRequest(sayings).daysPerWeek ?? opts.sentDays ?? (opts.trainingDays?.length || null);
  if (!daysInWeek) return [];
  const named = namedMobilityDays(sayings, daysInWeek, opts.trainingDays ?? null);
  const wanted = mobilityDaysWanted(sayings, daysInWeek) ?? (named ? named.length : null);
  const plan = wanted != null ? mobilityDayPlan(daysInWeek, wanted, named) : null;
  return Array.from({ length: daysInWeek }, (_, i) => (plan ? (planRole(i + 1, plan) === "must" ? "Mob" : "FB") : "free"));
}

describe("where the mobility days go: planned up front, never the model's choice", () => {
  it("Ron's two sentences: Full Body, Mobility, Full Body, Mobility, Full Body", () => {
    expect(weekRoles(RON)).toEqual(["FB", "Mob", "FB", "Mob", "FB"]);
    expect(weekRoles(RON_2)).toEqual(["FB", "Mob", "FB", "Mob", "FB"]);
    expect(mobilityDaysWanted(RON_2, 5)).toBe(2);
  });
  it("named days win: 'mobility Tuesday and Thursday' with Monday to Friday training days is days 2 and 4", () => {
    const s = "5 day split, full body Monday Wednesday Friday, mobility Tuesday and Thursday";
    expect(namedMobilityDays(s, 5)).toEqual([2, 4]);
    expect(namedMobilityDays(s, 5, [1, 2, 3, 4, 5])).toEqual([2, 4]);
    expect(weekRoles(s, { trainingDays: [1, 2, 3, 4, 5] })).toEqual(["FB", "Mob", "FB", "Mob", "FB"]);
    expect(namedMobilityDays("Tuesday and Thursday are mobility", 5)).toEqual([2, 4]);
    expect(namedMobilityDays("mobility on days 2 and 5", 5)).toEqual([2, 5]);
    // the program's own schedule: Mon, Tue, Thu, Fri, Sat -> Thursday is its 3rd training day
    expect(namedMobilityDays("mobility thursday", 5, [1, 2, 4, 5, 6])).toEqual([3]);
    expect(namedMobilityDays("full body every day", 5)).toBeNull();
  });
  it("spread: the main days first and last, mobility evenly between", () => {
    expect(mobilityDayPlan(5, 2)).toEqual([2, 4]);
    expect(mobilityDayPlan(3, 1)).toEqual([2]);
    expect(mobilityDayPlan(4, 1)).toEqual([3]);
    expect(mobilityDayPlan(6, 2)).toEqual([3, 5]);
    expect(mobilityDayPlan(7, 2)).toEqual([3, 6]);
    // more mobility days than gaps: the main days spread out, first and last
    expect(mobilityDayPlan(5, 3)).toEqual([2, 3, 4]);
    expect(mobilityDayPlan(4, 4)).toEqual([1, 2, 3, 4]);
  });
  it("with no mobility count, nothing changes (the old rule decides)", () => {
    expect(weekRoles("5 day split full body")).toEqual(["free", "free", "free", "free", "free"]);
    expect(mobilityRole({ wanted: null, builtMobility: 0, daysLeft: 5 })).toBe("free");
  });
  it("a main day is told which days are the mobility days, not that the week already has them", () => {
    expect(mobilityInstruction("must_not", 2, [2, 4])).toBe("This week's mobility days are days 2 and 4: this is a main training day, NOT a mobility day.");
    expect(mobilityInstruction("must", 2, [2, 4])).toContain("(days 2 and 4 of the week), and this is one of them");
    expect(mobilityInstruction("must_not", 2)).toBe("This week already has its 2 mobility days: this is NOT a mobility day.");
  });
  it("build-day plans the week from the request, else the week the builder sent, else the training days; the box sends it with every day", () => {
    const route = read("app/api/ai/build-day/route.ts");
    expect(route).toContain("const role = mobilityPlan ? planRole(day, mobilityPlan) : mobilityRole({ wanted: wantedMobility, builtMobility, daysLeft });");
    expect(route.indexOf("parseBuildRequest(sayings).daysPerWeek ??")).toBeLessThan(route.indexOf("(Number.isInteger(sentDays)"));
    expect(route).toContain('select("id, group_id, athlete_id, name, training_days")');
    const box = read("components/coach/desktop/ai-program-builder-box.tsx");
    expect(box).toContain("daysInWeek: runPlan.current?.daysPerWeek");
    expect(box).toContain("runPlan.current = { weeks: [week], daysPerWeek: weekDaysFor(existing, { daysPerWeek: lastRequest.current.daysPerWeek }, trainingDaysCount) };");
  });
});

describe("a new request always builds the whole week, in order (Ron, Nov 24: only days 3 to 5 were built)", () => {
  const none: { week: number; day: number; hasExercises: boolean }[] = [];
  it("what happened: a run paused after days 1-2, the week deleted, the new request typed into the paused run; it was taken as a correction and only days 3-5 were built", () => {
    const builtByRun = [{ week: 1, day: 1 }, { week: 1, day: 2 }];
    // after Delete week, nothing the run built is there: a fresh start, all 5 days in order
    expect(isFreshStart(none, builtByRun)).toBe(true);
    const parsed = parseBuildRequest(RON_2);
    expect(planSlots(none, parsed, null)).toEqual([1, 2, 3, 4, 5].map((day) => ({ week: 1, day })));
    expect(weekDaysFor(none, parsed, null)).toBe(5);
  });
  it("a day deleted while paused is built again, in order, when the run resumes", () => {
    const existing = [{ week: 1, day: 1, hasExercises: true }];
    expect(isFreshStart(existing, [{ week: 1, day: 1 }, { week: 1, day: 2 }])).toBe(false);
    expect(replanQueue(existing, { weeks: [1], daysPerWeek: 5 })).toEqual([2, 3, 4, 5].map((day) => ({ week: 1, day })));
  });
  it("a run that has built nothing yet is not a fresh start (Resume carries on)", () => {
    expect(isFreshStart(none, [])).toBe(false);
  });
  it("the box: Resume starts a new run when the run's days are gone, else plans its queue again from the days there now", () => {
    const box = read("components/coach/desktop/ai-program-builder-box.tsx");
    expect(box).toContain("if (said && isNewRequest(said)) startRun(said);\n      else startRun(request.current, said ? [said] : []);");
    expect(box).toContain("if (runPlan.current) queue.current = replanQueue(existingNow, runPlan.current);");
    expect(box).toContain("builtByRun.current.push(slot);");
    expect(box).toContain("stopAllMics();");
  });
});

describe("review of 54e68c07: only wording that makes the DAY a mobility day names it", () => {
  it("the good forms give days 2 and 4", () => {
    expect(namedMobilityDays("mobility Tuesday and Thursday", 5)).toEqual([2, 4]);
    expect(namedMobilityDays("Tuesday and Thursday are mobility", 5)).toEqual([2, 4]);
    expect(namedMobilityDays("Tuesday and Thursday will be mobility", 5)).toEqual([2, 4]);
    expect(namedMobilityDays("mobility on days 2 and 4", 5)).toEqual([2, 4]);
    expect(namedMobilityDays("mobility days are 2 and 4", 5)).toEqual([2, 4]);
    expect(namedMobilityDays("5 day split, full body Monday Wednesday Friday, mobility Tuesday and Thursday", 5)).toEqual([2, 4]);
  });
  it("mobility work inside a day never makes it a mobility day", () => {
    expect(namedMobilityDays("add mobility on day 1 as a warm-up", 4)).toBeNull();
    expect(namedMobilityDays("mobility on day 1 as a warm-up", 4)).toBeNull();
    expect(namedMobilityDays("mobility on day 2 with the core work", 4)).toBeNull();
    expect(namedMobilityDays("Monday legs, Wednesday push with mobility, Friday pull", 3, [1, 3, 5])).toBeNull();
    expect(weekRoles("add mobility on day 1 as a warm-up", { sentDays: 4 })).toEqual(["free", "free", "free", "free"]);
    expect(weekRoles("Monday legs, Wednesday push with mobility, Friday pull", { trainingDays: [1, 3, 5] })).toEqual(["free", "free", "free"]);
  });
  it("a comma ends the list", () => {
    expect(namedMobilityDays("mobility Tuesday, Thursday pull", 5)).toEqual([2]);
  });
  it("\"with\" closes the count gap: \"build 3 days with mobility work at the end\" is no mobility days", () => {
    expect(mobilityDaysWanted("build 3 days with mobility work at the end")).toBeNull();
    expect(mobilityDaysWanted("2 days will be mobility")).toBe(2);
  });
});

describe("review of 54e68c07: a change typed into a run whose days were deleted keeps the run's request", () => {
  it("a request in its own right starts over from its words; a change does not", () => {
    expect(isNewRequest(RON_2)).toBe(true);
    expect(isNewRequest("4 weeks of upper lower")).toBe(true);
    expect(isNewRequest("build a push pull legs program")).toBe(true);
    expect(isNewRequest("less volume")).toBe(false);
    expect(isNewRequest("swap the squats for leg press")).toBe(false);
    // re-check of 3a86f9fd: the bare word "program" or "split" is not a new request
    expect(isNewRequest("less volume in the program")).toBe(false);
    expect(isNewRequest("fewer sets, keep the split")).toBe(false);
    expect(isNewRequest("make me a 4 week program")).toBe(true);
    expect(isNewRequest("5-day split")).toBe(true);
  });
});
