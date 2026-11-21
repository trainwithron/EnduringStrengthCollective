import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GOAL_REVIEW_DAYS, GOAL_REVIEW_HEADING, goalAnchor, goalReviewCutoffIso, goalReviewDue, goalReviewText } from "@/lib/goal-review";
import { loadNeedsYouItems } from "@/lib/needs-you-data";
import { KIND_ORDER, KIND_SLOT, pickNeedsYou, sentences } from "@/lib/needs-you";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
import { GoalReviewCard } from "@/components/athlete/goal-review-card";

const ROOT = join(__dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8").replace(/\r\n/g, "\n");
const NOW = new Date("2026-11-20T15:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

describe("the 90-day goal look (Ron, Nov 20: R5)", () => {
  it("is due 90 days after the goal was set or last confirmed, whichever is later", () => {
    expect(GOAL_REVIEW_DAYS).toBe(90);
    expect(goalReviewDue({ filled_at: daysAgo(90) }, NOW)).toBe(true);
    expect(goalReviewDue({ filled_at: daysAgo(89) }, NOW)).toBe(false);
    expect(goalReviewDue({ filled_at: daysAgo(200), reviewed_at: daysAgo(10) }, NOW)).toBe(false);
    expect(goalReviewDue({ filled_at: daysAgo(200), reviewed_at: daysAgo(95) }, NOW)).toBe(true);
    // a coach-sent sheet never answered is not a goal yet
    expect(goalReviewDue({ filled_at: null }, NOW)).toBe(false);
    expect(goalAnchor({ filled_at: daysAgo(5), reviewed_at: daysAgo(30) })).toBe(new Date(daysAgo(5)).getTime());
    expect(new Date(goalReviewCutoffIso(NOW)).getTime()).toBe(NOW.getTime() - 90 * 86_400_000);
  });
  it("shows the goal in the client's own words", () => {
    expect(goalReviewText({ filled_at: "x", success_90_days: " Deadlift 300 ", why_matters: "For my kids" })).toBe("Deadlift 300");
    expect(goalReviewText({ filled_at: "x", success_90_days: "  ", why_matters: "For my kids" })).toBe("For my kids");
    expect(goalReviewText({ filled_at: "x" })).toBeNull();
  });
  it("the client's card: the heading, their goal, Still my goal and Update my goal (the goal sheet)", () => {
    const html = renderToStaticMarkup(createElement(GoalReviewCard, { groupId: "g1", athleteId: "a1", goalText: "Deadlift 300" }));
    expect(GOAL_REVIEW_HEADING).toBe("It's been 90 days since you set your goal");
    expect(html).toContain("It&#x27;s been 90 days since you set your goal");
    expect(html).toContain("Deadlift 300");
    expect(html).toContain("Still my goal");
    expect(html).toContain('href="/groups/g1/goal#goal-sheet"');
    expect(html).toContain("Update my goal");
  });
  it("Still my goal is the client's own, through the server, and only on a sheet they filled in", () => {
    const route = read("app/api/goal-sheet/review/route.ts");
    expect(route).toContain('if (actor?.role !== "client")');
    expect(route).toContain(".update({ reviewed_at: new Date().toISOString() })");
    expect(route).toContain('.eq("athlete_id", user.id)');
    expect(route).toContain('.not("filled_at", "is", null)');
    expect(read("components/athlete/goal-review-card.tsx")).toContain('fetch("/api/goal-sheet/review"');
    expect(read("app/(coach)/groups/[groupId]/page.tsx")).toContain("{isToday && goalReview && <GoalReviewCard");
  });
});

// A stand-in database where every read returns the rows given for its table (and nothing otherwise).
function fakeDb(rows: Record<string, unknown[]>, failing: Record<string, { code?: string; message: string }> = {}) {
  const chain = (table: string) => {
    const self: any = new Proxy({}, {
      get(_t, prop) {
        if (prop === "then") return (resolve: (v: unknown) => void) => (failing[table] ? resolve({ data: null, error: failing[table] }) : resolve({ data: rows[table] ?? [], error: null }));
        if (prop === "maybeSingle") return () => Promise.resolve({ data: (rows[table] ?? [])[0] ?? null, error: null });
        return () => self;
      },
    });
    return self;
  };
  return { from: (t: string) => chain(t) } as never;
}
const base = {
  coachId: "coach",
  timezone: "America/Los_Angeles",
  now: NOW,
  groupIds: ["g1"],
  todayBookings: [],
  needsPayment: [],
  lowReadiness: [],
  quietTierByAthlete: new Map() as never,
  needsReplyThreads: [],
};

describe("the coach is told on Home's Needs you", () => {
  it("a check-in waiting for review is waiting on the coach; a goal due for its look is due", () => {
    expect(KIND_SLOT.checkin_review).toBe("waiting");
    expect(KIND_SLOT.goal_review).toBe("due");
    expect(KIND_ORDER.indexOf("checkin_review")).toBeGreaterThan(KIND_ORDER.indexOf("client_message"));
    expect(sentences.checkinReview()).toMatch(/^[a-z]/);
    expect(sentences.goalReview()).toMatch(/^[a-z]/);
  });
  it("turns them into items with the client's name, the button and their page", async () => {
    const { items, failed } = await loadNeedsYouItems(
      fakeDb({
        weekly_checkins: [{ id: "c1", athlete_id: "a1", group_id: "g1", submitted_at: daysAgo(1) }, { id: "c2", athlete_id: "coach", group_id: "g1", submitted_at: daysAgo(1) }],
        client_goal_sheets: [
          { athlete_id: "a2", group_id: "g1", filled_at: daysAgo(120), reviewed_at: null },
          { athlete_id: "a3", group_id: "g1", filled_at: daysAgo(120), reviewed_at: daysAgo(3) },
          { athlete_id: "a4", group_id: "g1", filled_at: daysAgo(300), reviewed_at: null },
        ],
        profiles: [{ id: "a1", full_name: "Ann", claimed_at: "x" }, { id: "a2", full_name: "Bo", claimed_at: "x" }],
        // Bo and Cy are clients there; Di's sheet stayed behind when she left
        group_memberships: [{ group_id: "g1", profile_id: "a1" }, { group_id: "g1", profile_id: "a2" }, { group_id: "g1", profile_id: "a3" }],
      }),
      base
    );
    expect(failed).toEqual([]);
    expect(items.find((i) => i.kind === "checkin_review")).toMatchObject({ name: "Ann", button: "Review", href: "/clients/check-ins?focus=c1", profileHref: "/groups/g1/athletes/a1", sentence: "sent their weekly check-in." });
    // the coach's own check-in in their personal space is not one to review
    expect(items.filter((i) => i.kind === "checkin_review").length).toBe(1);
    // only Bo's goal is due (Cy confirmed theirs three days ago)
    expect(items.filter((i) => i.kind === "goal_review").map((i) => i.name)).toEqual(["Bo"]);
    expect(pickNeedsYou(items).slots[0].item?.kind).toBe("checkin_review");
  });
  it("a database without step 215 is not a failure: the strip says nothing about them", async () => {
    const missing = { code: "42P01", message: "relation does not exist" };
    const out = await loadNeedsYouItems(fakeDb({}, { weekly_checkins: missing, client_goal_sheets: { code: "42703", message: "column does not exist" } }), base);
    expect(out).toEqual({ items: [], failed: [] });
  });
  it("a real failure is reported", async () => {
    const out = await loadNeedsYouItems(fakeDb({}, { weekly_checkins: { message: "boom" } }), base);
    expect(out.failed).toContain("check-ins");
  });
});
