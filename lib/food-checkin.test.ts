import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  answeredNotice,
  cardMessage,
  checkinAllowed,
  checkinIsOpen,
  checkinTrigger,
  cleanCheckinAnswer,
  clientNotice,
  reworkRequests,
  sentNotice,
  triggerPill,
  type FoodRow,
} from "@/lib/food-checkin";

// The food check-in (Ron, Nov 24: "build it"; reports/nutrition-checkin-nudge-mockup.html).
const ROOT = join(__dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8").replace(/\r\n/g, "\n");
const TODAY = "2026-11-24";
const day = (n: number) => {
  const d = new Date(`${TODAY}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};
const food = (n: number, calories: number | null, extra: Partial<FoodRow> = {}): FoodRow => ({ log_date: day(n), status: "quick_log", food_source: null, calories, ...extra });
const base = { todayKey: TODAY, targetKcal: 2000, targetSinceKey: "2026-10-01", everLoggedBefore: true };

describe("when a check-in goes out", () => {
  it("quiet: nothing logged on the 3 days before today (nor today)", () => {
    expect(checkinTrigger({ ...base, entries: [food(4, 1800), food(5, 2000)] })).toEqual({ kind: "quiet" });
    // something yesterday, or already today: not quiet
    expect(checkinTrigger({ ...base, entries: [food(1, 1800)] })?.kind).not.toBe("quiet");
    expect(checkinTrigger({ ...base, entries: [food(0, 300)] })).toBeNull();
  });

  it("quiet only for someone who logged before, or has had a target for 3 days", () => {
    expect(checkinTrigger({ ...base, entries: [], everLoggedBefore: false, targetSinceKey: day(1) })).toBeNull();
    expect(checkinTrigger({ ...base, entries: [], everLoggedBefore: false, targetSinceKey: day(3) })).toEqual({ kind: "quiet" });
    expect(checkinTrigger({ ...base, entries: [], everLoggedBefore: true, targetSinceKey: day(1) })).toEqual({ kind: "quiet" });
  });

  it("skipped meals and imported history are not logging", () => {
    const notReally = [food(1, 1800, { status: "skipped" }), food(2, 1800, { food_source: "import" }), food(3, 900, { status: "skipped" })];
    expect(checkinTrigger({ ...base, entries: notReally })).toEqual({ kind: "quiet" });
  });

  it("off: at least 4 of the last 7 full days logged, average more than 15% off target", () => {
    const low = [food(1, 1600), food(2, 1500), food(3, 1700), food(5, 1600), food(6, 1550)];
    expect(checkinTrigger({ ...base, entries: low })).toEqual({ kind: "off", avgDiffKcal: -410, daysLogged: 5, targetKcal: 2000 });
    const high = [food(1, 2500), food(2, 2400), food(3, 2450), food(4, 2350)];
    expect(checkinTrigger({ ...base, entries: high })).toMatchObject({ kind: "off", avgDiffKcal: 425 });
    // within 15%
    expect(checkinTrigger({ ...base, entries: [food(1, 1750), food(2, 1800), food(3, 2200), food(4, 1900)] })).toBeNull();
    // only 3 logged days
    expect(checkinTrigger({ ...base, entries: [food(1, 1000), food(2, 1000), food(3, 1000)] })).toBeNull();
  });

  it("off: the average is over the days with calories; today does not count (it is not over)", () => {
    const rows = [food(0, 100), food(1, 1600), food(2, 1600), food(3, null), food(4, 1600), food(5, 1600)];
    expect(checkinTrigger({ ...base, entries: rows })).toEqual({ kind: "off", avgDiffKcal: -400, daysLogged: 5, targetKcal: 2000 });
  });

  it("no target, no check-in", () => {
    expect(checkinTrigger({ ...base, entries: [], targetKcal: null })).toBeNull();
    expect(checkinTrigger({ ...base, entries: [], targetKcal: 0 })).toBeNull();
  });

  it("at most one in 7 days, answered or not; one still unanswered is open for 7 days", () => {
    const now = new Date("2026-11-24T15:00:00Z");
    expect(checkinAllowed([], now)).toBe(true);
    expect(checkinAllowed(["2026-11-20T15:00:00Z"], now)).toBe(false);
    expect(checkinAllowed(["2026-11-17T14:00:00Z"], now)).toBe(true);
    expect(checkinIsOpen({ status: "sent", sent_at: "2026-11-20T15:00:00Z" }, now)).toBe(true);
    expect(checkinIsOpen({ status: "sent", sent_at: "2026-11-16T15:00:00Z" }, now)).toBe(false);
    expect(checkinIsOpen({ status: "answered", sent_at: "2026-11-23T15:00:00Z" }, now)).toBe(false);
  });
});

describe("the job only checks the clients it should", () => {
  const job = read("app/api/cron/food-checkins/route.ts");
  it("skips tracking off, group clients, No macros, the safety switch, Food check-ins off and youth mode", () => {
    expect(job).toContain("s.food_tracking_enabled !== false");
    expect(job).toContain('s.client_tier !== "group"');
    expect(job).toContain("s.coach_sets_macros !== false");
    expect(job).toContain("!paused.profiles.has(s.profile_id)");
    expect(job).toContain('.eq("checkins_off", true)');
    expect(job).toContain("!switchedOff.has(`${s.profile_id}|${s.group_id}`)");
    expect(job).toContain("if (g.nutrition_youth_mode) youth.add(g.id)");
    expect(job).toContain("if (!youth.has(s.group_id))");
  });
  it("sends at 10 in the client's own morning, never within 7 days of the last one, one per client", () => {
    expect(job).toContain("if (hour !== CHECKIN_LOCAL_HOUR)");
    // a group in another zone (no zone of their own) only skips that group, not the client's other groups
    expect(job.slice(job.indexOf("if (hour !== CHECKIN_LOCAL_HOUR)"), job.indexOf("if (hour !== CHECKIN_LOCAL_HOUR)") + 120)).toContain("continue;");
    expect(read("supabase/migrations/0471_food_checkins.sql")).toContain("create unique index if not exists client_food_checkins_one_a_day");
    expect(job).toContain("if (recent.has(athleteId)) return;");
    expect(job).toContain("return; // one per client, even if several groups qualify");
    // the record before the notices, so the limit sees it
    expect(job.indexOf('from("client_food_checkins").insert(record)')).toBeLessThan(job.indexOf('type: "food_checkin"'));
    expect(read("vercel.json")).toContain('"path": "/api/cron/food-checkins"');
  });
  it("tells the client (bell + push, from the coach) and gives the coach one bell, no push", () => {
    expect(job.match(/type: "food_checkin"/g)).toHaveLength(1);
    expect(job.match(/type: "food_checkin_sent"/g)).toHaveLength(1);
    expect(job.match(/sendPushToProfile\(/g)).toHaveLength(1);
    expect(job).not.toContain("sendCoachPush");
  });
});

describe("the words: from the coach, never AI", () => {
  const quiet = { kind: "quiet" } as const;
  const low = { kind: "off", avgDiffKcal: -410, daysLogged: 5, targetKcal: 2000 } as const;
  it("the push and bell carry the coach's first name", () => {
    expect(clientNotice(quiet, "Ron Arnold")).toEqual({ title: "Ron", body: "Haven't seen your food in a few days. Everything OK with the plan?", line: "Ron: Haven't seen your food in a few days. Everything OK with the plan?" });
    expect(clientNotice(low, "Ron Arnold").line).toBe("Ron: Your calories have been running low this week. Is the plan working for you?");
    expect(clientNotice({ ...low, avgDiffKcal: 300 }, "Ron").body).toContain("running high");
  });
  it("the card, as the mockup: the average difference rounded to 50, under or over", () => {
    expect(cardMessage({ trigger: "quiet", avg_diff_kcal: null }, "Robyn Lee")).toBe("Hey Robyn, I haven't seen your food in a few days. No stress, just checking in. Is something not working with the plan?");
    expect(cardMessage({ trigger: "off", avg_diff_kcal: -410 }, "Robyn Lee")).toBe("Hey Robyn, your calories have been running about 400 under your target this week. Is something not working with the plan?");
    expect(cardMessage({ trigger: "off", avg_diff_kcal: 430 }, "Robyn")).toContain("about 450 over");
  });
  it("no client-facing text says AI, Spotter or automatic", () => {
    const texts = [clientNotice(quiet, "Ron").line, clientNotice(low, "Ron").line, cardMessage({ trigger: "quiet", avg_diff_kcal: null }, "R"), cardMessage({ trigger: "off", avg_diff_kcal: -400 }, "R")];
    for (const t of texts) expect(t).not.toMatch(/\b(AI|Spotter|automatic|app)\b/i);
    const card = read("components/athlete/food-checkin-card.tsx")
      .split("\n")
      .filter((l) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(l));
    expect(card.filter((l) => /\b(AI|Spotter|automatic)\b/.test(l))).toEqual([]);
    expect(read("components/athlete/food-checkin-card.tsx")).toContain("From {coachFirstName}");
    expect(read("components/athlete/food-checkin-card.tsx")).toContain("`Send to ${coachFirstName}`");
  });
  it("the coach's pill, the sent bell and the answered bell", () => {
    expect(triggerPill({ trigger: "quiet", avg_diff_kcal: null, days_logged: null })).toBe("No food logged · 3 days");
    expect(triggerPill({ trigger: "off", avg_diff_kcal: -410, days_logged: 5 })).toBe("Calories −400/day · 5 of 7 days logged");
    expect(sentNotice({ trigger: "quiet", avg_diff_kcal: null }, "Robyn Lee")).toBe("Sent Robyn Lee a food check-in: no food logged in 3 days");
    expect(answeredNotice({ reasons: ["long_cook", "rework_plan"], note: null }, "Robyn Lee")).toBe("Robyn Lee answered your food check-in: wants the plan reworked.");
    expect(answeredNotice({ reasons: ["long_cook", "disliked_food"], note: null }, "Robyn")).toBe("Robyn answered your food check-in: meals take too long to cook, there's food they don't like.");
    expect(answeredNotice({ reasons: [], note: "hi" }, null)).toBe("Your client answered your food check-in: wrote back.");
  });
});

describe("the answer", () => {
  it("only the five chips, each once, in order; the note to 500; nothing at all is refused", () => {
    expect(cleanCheckinAnswer({ reasons: ["rework_plan", "long_cook", "long_cook", "pizza"], note: "  Mostly the dinners, they take an hour.  " })).toEqual({
      reasons: ["long_cook", "rework_plan"],
      note: "Mostly the dinners, they take an hour.",
    });
    expect(cleanCheckinAnswer({ reasons: [], note: " " })).toBeNull();
    expect(cleanCheckinAnswer({ note: "x".repeat(600) })!.note).toHaveLength(500);
  });
  it("answering sends one coach bell and one push, once (a second answer changes nothing)", () => {
    const route = read("app/api/food-checkins/answer/route.ts");
    expect(route.match(/type: "food_checkin_answered"/g)).toHaveLength(1);
    expect(route.match(/sendCoachPush\(/g)).toHaveLength(1);
    expect(route).toContain('.eq("status", "sent")');
    expect(route).toContain("if (!changed || changed.length === 0) return NextResponse.json({ ok: true, already: true });");
    expect(route).toContain("row.athlete_id !== user.id");
  });
  it("'Rework the plan' fills the meal plan builder's requests with the answer", () => {
    expect(reworkRequests({ reasons: ["long_cook", "disliked_food", "rework_plan"], note: "Mostly the dinners, they take an hour." })).toBe(
      "quick meals with short cook times, leave out foods they don't like, Mostly the dinners, they take an hour."
    );
    expect(reworkRequests({ reasons: ["all_good"], note: null })).toBe("");
    const panel = read("components/coach/nutrition/food-checkin-panel.tsx");
    expect(panel).toContain("const requests = reworkRequests({ reasons: checkin.reasons, note: checkin.note });");
    expect(panel).toContain("window.dispatchEvent(new CustomEvent<RebuildWithRequests>(REBUILD_WITH_REQUESTS_EVENT, { detail }))");
  });
});
