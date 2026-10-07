import { describe, expect, it } from "vitest";
import {
  applyStandingTarget,
  conflictFixes,
  describeApplyOutcome,
  describeRemovedScheduled,
  scheduledConfirmMessage,
  describeConflicts,
  historyAfterApply,
  insertCheckinOnce,
  planApply,
  pushMessageForApply,
  updateConflictingDays,
  type DayOverrideRow,
  type DayPlanRow,
} from "@/lib/apply-standing";
import { saveStandingTarget } from "@/lib/standing-macros";
import { standingForDate, type StandingHistory } from "@/lib/macro-resolution";

const T = (calories: number) => ({ calories, proteinG: 180, carbsG: 250, fatG: 60 });
const row = (effective_from: string, calories: number | null) => ({ effective_from, calories, protein_g: calories ? 180 : null, carbs_g: calories ? 250 : null, fat_g: calories ? 60 : null });
const override = (log_date: string, calories: number): DayOverrideRow => ({ log_date, calories, protein_g: 150, carbs_g: 200, fat_g: 50 });
const plan = (log_date: string, calories: number): DayPlanRow => ({
  log_date,
  macros: { daily: { calories, protein: 180, carbs: 250, fats: 60 } },
  meals: { daily: [{ mealId: "m1", title: "Breakfast" }] },
});

describe("the standing history after an apply", () => {
  it("replaces the row on that date and drops every later-dated row (A2: a scheduled row must not come back)", () => {
    const history: StandingHistory = [row("2026-09-01", 2000), row("2026-10-07", 2100), row("2026-10-14", 2500)];
    const after = historyAfterApply(history, "2026-10-07", T(2300));
    expect(after.map((r) => r.effective_from)).toEqual(["2026-09-01", "2026-10-07"]);
    expect(after[1].calories).toBe(2300);
    // On the later date the NEW decision holds, not the old scheduled one.
    expect(standingForDate(after, "2026-10-14")?.calories).toBe(2300);
    expect(standingForDate(history, "2026-10-14")?.calories).toBe(2500);
  });
  it("keeps earlier rows exactly, and works from an empty history", () => {
    expect(historyAfterApply([row("2026-09-01", 2000)], "2026-10-07", T(2300))[0].calories).toBe(2000);
    expect(historyAfterApply([], "2026-10-07", T(2300))).toHaveLength(1);
  });
  it("removing the target (null) leaves a removal row and still drops later rows", () => {
    const after = historyAfterApply([row("2026-09-01", 2000), row("2026-10-14", 2500)], "2026-10-07", null);
    expect(after.map((r) => r.effective_from)).toEqual(["2026-09-01", "2026-10-07"]);
    expect(standingForDate(after, "2026-10-20")).toBeNull();
  });
});

describe("what the client will really see (A1)", () => {
  const history: StandingHistory = [row("2026-09-01", 2000)];

  it("no override and no plan: nothing is in the way, and today changes", () => {
    const p = planApply({ history, startKey: "2026-10-07", todayKey: "2026-10-07", target: T(2300), overrides: [], plans: [] });
    expect(p.conflicts).toEqual([]);
    expect(p.todayBeforeCalories).toBe(2000);
    expect(p.todayAfterCalories).toBe(2300);
    expect(p.todayChanged).toBe(true);
  });
  it("a one-day target for today still wins: the apply is reported as in the way, and today did NOT change", () => {
    const p = planApply({ history, startKey: "2026-10-07", todayKey: "2026-10-07", target: T(2300), overrides: [override("2026-10-07", 1900)], plans: [] });
    expect(p.conflicts).toEqual([{ date: "2026-10-07", source: "override", calories: 1900, hasPlan: false }]);
    expect(p.todayChanged).toBe(false);
    expect(p.todayAfterCalories).toBe(1900);
  });
  it("an assigned meal plan built for another number still wins on its days", () => {
    const p = planApply({ history, startKey: "2026-10-07", todayKey: "2026-10-07", target: T(2300), overrides: [], plans: [plan("2026-10-09", 2000), plan("2026-10-10", 2000)] });
    expect(p.conflicts.map((c) => [c.date, c.source, c.calories])).toEqual([
      ["2026-10-09", "meal_plan", 2000],
      ["2026-10-10", "meal_plan", 2000],
    ]);
    expect(p.todayChanged).toBe(true);
  });
  it("a day whose override or plan already equals the new target is not a conflict", () => {
    const p = planApply({ history, startKey: "2026-10-07", todayKey: "2026-10-07", target: T(2300), overrides: [override("2026-10-08", 2300)], plans: [plan("2026-10-09", 2300)] });
    expect(p.conflicts).toEqual([]);
  });
  it("only the 14 days from the start are checked", () => {
    const p = planApply({ history, startKey: "2026-10-07", todayKey: "2026-10-07", target: T(2300), overrides: [override("2026-10-20", 1000), override("2026-10-21", 1000)], plans: [] });
    expect(p.conflicts.map((c) => c.date)).toEqual(["2026-10-20"]);
  });
  it("a future start date: today is untouched, and the future days are checked", () => {
    const p = planApply({ history, startKey: "2026-10-14", todayKey: "2026-10-07", target: T(2300), overrides: [override("2026-10-15", 1900)], plans: [] });
    expect(p.todayChanged).toBe(false);
    expect(p.todayAfterCalories).toBe(2000);
    expect(p.conflicts.map((c) => c.date)).toEqual(["2026-10-15"]);
  });
  it("a scheduled later row that the apply removes is not left to take over (end to end through the planner), and the coach is told which one went", () => {
    const scheduled: StandingHistory = [row("2026-09-01", 2000), row("2026-10-14", 2500)];
    const p = planApply({ history: scheduled, startKey: "2026-10-07", todayKey: "2026-10-07", target: T(2300), overrides: [], plans: [] });
    expect(p.historyAfter.map((r) => r.effective_from)).toEqual(["2026-09-01", "2026-10-07"]);
    expect(p.removedScheduled).toEqual([{ date: "2026-10-14", calories: 2500 }]);
    expect(describeRemovedScheduled(p.removedScheduled)).toEqual(["This also removed the target scheduled from Oct 14 (2,500)."]);
  });
  it("nothing scheduled, nothing removed; a row ON the start date is replaced, not reported as removed", () => {
    const p = planApply({ history: [row("2026-09-01", 2000), row("2026-10-07", 2100)], startKey: "2026-10-07", todayKey: "2026-10-07", target: T(2300), overrides: [], plans: [] });
    expect(p.removedScheduled).toEqual([]);
    expect(describeRemovedScheduled([{ date: "2026-10-14", calories: null }])).toEqual(["This also removed the standing-target removal scheduled from Oct 14."]);
  });
});

describe("the sentences for the coach", () => {
  it("one day with its own target, a range with a plan, a month boundary", () => {
    const lines = describeConflicts([
      { date: "2026-10-09", source: "override", calories: 2000, hasPlan: false },
      { date: "2026-10-10", source: "meal_plan", calories: 2300, hasPlan: true },
      { date: "2026-10-11", source: "meal_plan", calories: 2300, hasPlan: true },
      { date: "2026-10-12", source: "meal_plan", calories: 2300, hasPlan: true },
    ]);
    expect(lines).toEqual(["Oct 9 has its own target (2,000).", "The meal plan assigned for Oct 10 to 12 is built for 2,300."]);
    expect(
      describeConflicts([
        { date: "2026-10-30", source: "override", calories: 1800, hasPlan: false },
        { date: "2026-10-31", source: "override", calories: 1800, hasPlan: false },
        { date: "2026-11-01", source: "override", calories: 1800, hasPlan: false },
      ])
    ).toEqual(["Oct 30 to Nov 1 have their own target (1,800)."]);
  });
  it("different numbers are not merged, and a missing number reads plainly", () => {
    expect(
      describeConflicts([
        { date: "2026-10-09", source: "override", calories: 1800, hasPlan: false },
        { date: "2026-10-10", source: "override", calories: 1900, hasPlan: false },
      ])
    ).toEqual(["Oct 9 has its own target (1,800).", "Oct 10 has its own target (1,900)."]);
    expect(describeConflicts([{ date: "2026-10-09", source: "override", calories: null, hasPlan: false }])[0]).toContain("another number");
    expect(describeConflicts([])).toEqual([]);
  });
  it("fixes: every one-day target is removed (no notice is ever sent for a removal); a meal plan is listed for a new plan, never overwritten", () => {
    const fixes = conflictFixes([
      { date: "2026-10-09", source: "override", calories: 2000, hasPlan: false },
      { date: "2026-10-10", source: "meal_plan", calories: 2300, hasPlan: true },
      { date: "2026-10-11", source: "override", calories: 2000, hasPlan: true },
    ]);
    expect(fixes.removeDates).toEqual(["2026-10-09", "2026-10-11"]);
    expect(fixes.planDates).toEqual(["2026-10-10", "2026-10-11"]);
  });
});

describe("what the client is told", () => {
  it("says the target IS now N only when today's number really changed", () => {
    expect(pushMessageForApply({ newCalories: 2300, startKey: "2026-10-07", todayKey: "2026-10-07", todayChanged: true })).toBe("Your daily target is now 2,300 calories");
  });
  it("never claims a number the client does not see: a one-day target or plan still wins today", () => {
    const m = pushMessageForApply({ newCalories: 2300, startKey: "2026-10-07", todayKey: "2026-10-07", todayChanged: false });
    expect(m).toBe("Your coach changed your calorie target, from Oct 7");
    expect(m).not.toContain("2,300");
  });
  it("a later start says what changes and when, not that it is already so", () => {
    expect(pushMessageForApply({ newCalories: 2300, startKey: "2026-10-14", todayKey: "2026-10-07", todayChanged: false })).toBe("Your daily target changes to 2,300 calories, from Oct 14");
  });
  it("copes with no calorie number", () => {
    expect(pushMessageForApply({ newCalories: null, startKey: "2026-10-14", todayKey: "2026-10-07", todayChanged: false })).toBe("Your coach changed your calorie target, from Oct 14");
    expect(pushMessageForApply({ newCalories: null, startKey: "2026-10-07", todayKey: "2026-10-07", todayChanged: true })).toBe("Your coach changed your calorie target, from Oct 7");
  });
});

// ---- the database side, with a recording fake ----
type Log = { table: string; op: string; payload?: unknown; filters?: unknown[] }[];
function fake(log: Log, data: Record<string, unknown[]> = {}, failOn: string | null = null) {
  return {
    from(table: string) {
      const filters: unknown[] = [];
      const result = (op: string) => ({ error: failOn === `${table}:${op}` ? { message: "nope", code: "X" } : null });
      const chain: any = {
        select: () => chain,
        eq: (c: string, v: unknown) => (filters.push(["eq", c, v]), chain),
        gt: (c: string, v: unknown) => (filters.push(["gt", c, v]), chain),
        gte: (c: string, v: unknown) => (filters.push(["gte", c, v]), chain),
        lte: (c: string, v: unknown) => (filters.push(["lte", c, v]), chain),
        in: (c: string, v: unknown) => (filters.push(["in", c, v]), chain),
        order: () => chain,
        upsert: async (payload: unknown) => (log.push({ table, op: "upsert", payload }), result("upsert")),
        delete: () => {
          const d: any = {
            eq: (c: string, v: unknown) => (filters.push(["eq", c, v]), d),
            gt: (c: string, v: unknown) => (filters.push(["gt", c, v]), d),
            in: (c: string, v: unknown) => (filters.push(["in", c, v]), d),
            then: (res: (v: unknown) => unknown) => (log.push({ table, op: "delete", filters: [...filters] }), Promise.resolve(result("delete")).then(res)),
          };
          return d;
        },
        then: (res: (v: unknown) => unknown) => Promise.resolve({ data: data[table] ?? [], error: null }).then(res),
      };
      return chain;
    },
  } as never;
}

describe("saving the standing target removes later-dated rows", () => {
  it("upserts the row for the start date, then deletes every row after it for that client and group", async () => {
    const log: Log = [];
    const r = await saveStandingTarget(fake(log), { athleteId: "a1", groupId: "g1", userId: "u1", target: T(2300), today: "2026-10-07" });
    expect(r.ok).toBe(true);
    expect(log.map((l) => l.op)).toEqual(["upsert", "delete"]);
    expect(log[0].table).toBe("client_macro_target_history");
    expect(log[1].filters).toEqual([
      ["eq", "athlete_id", "a1"],
      ["eq", "group_id", "g1"],
      ["gt", "effective_from", "2026-10-07"],
    ]);
  });
  it("removing the standing target (null) also clears later rows", async () => {
    const log: Log = [];
    await saveStandingTarget(fake(log), { athleteId: "a1", groupId: "g1", userId: "u1", target: null, today: "2026-10-07" });
    expect(log.map((l) => l.op)).toEqual(["upsert", "delete"]);
  });
  it("if clearing the later rows fails, the save is reported as failed so the coach retries, never as done", async () => {
    const log: Log = [];
    const r = await saveStandingTarget(fake(log, {}, "client_macro_target_history:delete"), { athleteId: "a1", groupId: "g1", userId: "u1", target: T(2300), today: "2026-10-07" });
    expect(r.ok).toBe(false);
  });
});

describe("applyStandingTarget and the fix", () => {
  it("reads what is in the way, saves from the start date, and reports it", async () => {
    const log: Log = [];
    const db = fake(log, {
      client_macro_target_history: [{ athlete_id: "a1", effective_from: "2026-09-01", calories: 2000, protein_g: 150, carbs_g: 200, fat_g: 60 }],
      daily_macros: [override("2026-10-08", 1900)],
      meal_plans: [plan("2026-10-10", 2000)],
    });
    const r = await applyStandingTarget(db, { athleteId: "a1", groupId: "g1", userId: "u1", target: T(2300), startKey: "2026-10-07", todayKey: "2026-10-07" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.todayChanged).toBe(true);
    expect(r.conflicts.map((c) => [c.date, c.source])).toEqual([
      ["2026-10-08", "override"],
      ["2026-10-10", "meal_plan"],
    ]);
    expect(log.some((l) => l.op === "upsert" && l.table === "client_macro_target_history")).toBe(true);
  });
  it("a failed save is a failed apply", async () => {
    const r = await applyStandingTarget(fake([], {}, "client_macro_target_history:upsert"), { athleteId: "a1", groupId: "g1", userId: "u1", target: T(2300), startKey: "2026-10-07", todayKey: "2026-10-07" });
    expect(r.ok).toBe(false);
  });
  it("the fix only DELETES one-day targets (a delete sends the client nothing) and never writes a target, so it cannot stack up notices", async () => {
    const log: Log = [];
    const r = await updateConflictingDays(fake(log), {
      athleteId: "a1",
      groupId: "g1",
      conflicts: [
        { date: "2026-10-08", source: "override", calories: 1900, hasPlan: false },
        { date: "2026-10-10", source: "meal_plan", calories: 2000, hasPlan: true },
        { date: "2026-10-11", source: "override", calories: 1800, hasPlan: true },
      ],
    });
    expect(r).toEqual({ ok: true, removed: 2 });
    expect(log.map((l) => l.op)).toEqual(["delete"]);
    expect(log[0].table).toBe("daily_macros");
    expect(log[0].filters).toContainEqual(["in", "log_date", ["2026-10-08", "2026-10-11"]]);
    expect(log.some((l) => l.op === "upsert")).toBe(false);
  });
  it("a plan-only conflict removes nothing and writes nothing", async () => {
    const log: Log = [];
    const r = await updateConflictingDays(fake(log), { athleteId: "a1", groupId: "g1", conflicts: [{ date: "2026-10-10", source: "meal_plan", calories: 2000, hasPlan: true }] });
    expect(r).toEqual({ ok: true, removed: 0 });
    expect(log).toEqual([]);
  });
  it("a failed fix says so", async () => {
    const r = await updateConflictingDays(fake([], {}, "daily_macros:delete"), {
      athleteId: "a1",
      groupId: "g1",
      conflicts: [{ date: "2026-10-08", source: "override", calories: 1900, hasPlan: false }],
    });
    expect(r.ok).toBe(false);
  });
});

describe("asking before a save removes a scheduled target", () => {
  it("names each scheduled target and asks", () => {
    expect(scheduledConfirmMessage([{ date: "2026-10-14", calories: 2500 }])).toBe("Saving this also removes the target scheduled from Oct 14 (2,500). Continue?");
    expect(scheduledConfirmMessage([{ date: "2026-10-14", calories: 2500 }, { date: "2026-10-21", calories: null }])).toBe(
      "Saving this also removes the target scheduled from Oct 14 (2,500) and the removal scheduled from Oct 21. Continue?"
    );
  });
  it("says nothing when nothing is scheduled", () => {
    expect(scheduledConfirmMessage([])).toBe("");
  });
});

describe("the summary line", () => {
  const base = { historyAfter: [], todayBeforeCalories: 2000, todayAfterCalories: 2300, todayChanged: true, conflicts: [], removedScheduled: [] };
  it("says what happened in the coach's terms", () => {
    expect(describeApplyOutcome({ plan: base, newCalories: 2300, startKey: "2026-10-07", todayKey: "2026-10-07" })).toBe("Applied. Today's target is now 2,300.");
    expect(describeApplyOutcome({ plan: { ...base, todayChanged: false, todayAfterCalories: 1900 }, newCalories: 2300, startKey: "2026-10-07", todayKey: "2026-10-07" })).toBe(
      "Saved as the standing target, but today still shows 1,900 (see below)."
    );
    expect(describeApplyOutcome({ plan: { ...base, todayChanged: false }, newCalories: 2300, startKey: "2026-10-14", todayKey: "2026-10-07" })).toBe("Saved. From Oct 14 the standing target is 2,300. Until then nothing changes.");
  });
});

describe("the check-in is recorded once, however many times Apply is retried", () => {
  const row = { athlete_id: "a1", group_id: "g1", new_calories: 2300, rationale: "Weight is flat.", phase: "fat_loss" };
  it("inserts when the same check-in is not already there", async () => {
    const log: Log = [];
    const db = {
      from(table: string) {
        const chain: any = {
          select: () => chain,
          eq: () => chain,
          gte: () => chain,
          limit: () => chain,
          insert: async (payload: unknown) => (log.push({ table, op: "insert", payload }), { error: null }),
          then: (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res),
        };
        return chain;
      },
    } as never;
    expect((await insertCheckinOnce(db, row)).ok).toBe(true);
    expect(log.map((l) => l.op)).toEqual(["insert"]);
  });
  it("does NOT insert a second one when the same check-in was recorded in the last day", async () => {
    const log: Log = [];
    const db = {
      from(table: string) {
        const chain: any = {
          select: () => chain,
          eq: () => chain,
          gte: () => chain,
          limit: () => chain,
          insert: async (payload: unknown) => (log.push({ table, op: "insert", payload }), { error: null }),
          then: (res: (v: unknown) => unknown) => Promise.resolve({ data: [{ id: "c1" }], error: null }).then(res),
        };
        return chain;
      },
    } as never;
    expect((await insertCheckinOnce(db, row)).ok).toBe(true);
    expect(log).toEqual([]);
  });
  it("reports a failed insert", async () => {
    const db = {
      from() {
        const chain: any = {
          select: () => chain,
          eq: () => chain,
          gte: () => chain,
          limit: () => chain,
          insert: async () => ({ error: { message: "x" } }),
          then: (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res),
        };
        return chain;
      },
    } as never;
    expect((await insertCheckinOnce(db, row)).ok).toBe(false);
  });
});
