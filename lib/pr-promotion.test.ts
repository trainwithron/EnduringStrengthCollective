import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { coachControlFor, promotionSentence, REASK_AFTER_DAYS } from "@/lib/pr-promotion";
import { feedChannel, shouldPostToFeed } from "@/lib/announce-workout-log";
import { hindsightPrs, type RollupRow } from "@/lib/imported-prs";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

describe("the words", () => {
  it("the sentence the client reads, with the month and year the workout was done", () => {
    expect(promotionSentence(900, "Deadlift", "2025-03-10T12:00:17Z")).toBe("Your coach wants to count your 900 lb Deadlift from March 2025 as a PR.");
    expect(promotionSentence(102.5, "Bench Press", "2024-12-31T23:00:00Z")).toBe("Your coach wants to count your 102.5 lb Bench Press from December 2024 as a PR.");
    expect(promotionSentence(300, "Squat", null)).toBe("Your coach wants to count your 300 lb Squat as a PR.");
  });
  it("the page and the notification say the same thing", () => {
    expect(read("supabase/migrations/0374_promote_imported_pr.sql")).toContain("'Your coach wants to count your '");
  });
});

describe("what the coach sees on an imported record", () => {
  const now = new Date("2026-10-14T12:00:00Z");
  it("not asked yet: the button", () => expect(coachControlFor(undefined, now)).toEqual({ kind: "ask" }));
  it("asked, waiting", () => expect(coachControlFor({ status: "asked", answeredAt: null }, now)).toEqual({ kind: "waiting" }));
  it("agreed: nothing to do", () => expect(coachControlFor({ status: "agreed", answeredAt: "2026-10-01T00:00:00Z" }, now)).toEqual({ kind: "counts" }));
  it("not now: no button until 30 days have passed, then Ask again", () => {
    expect(REASK_AFTER_DAYS).toBe(30);
    expect(coachControlFor({ status: "declined", answeredAt: "2026-10-01T12:00:00Z" }, now)).toEqual({ kind: "declined", askAgainOn: "2026-10-31" });
    expect(coachControlFor({ status: "declined", answeredAt: "2026-09-14T12:00:00Z" }, now)).toEqual({ kind: "ask_again" });
    expect(coachControlFor({ status: "declined", answeredAt: "2026-09-13T12:00:00Z" }, now)).toEqual({ kind: "ask_again" });
    expect(coachControlFor({ status: "declined", answeredAt: null }, now)).toEqual({ kind: "ask_again" });
  });
});

describe("the feed card and share card are decided in one place", () => {
  it("a private client posts nothing; a records-only client posts only a record; check-in only never goes to the PR board", () => {
    expect(shouldPostToFeed("private", true)).toBe(false);
    expect(shouldPostToFeed("prs_only", false)).toBe(false);
    expect(shouldPostToFeed("prs_only", true)).toBe(true);
    expect(shouldPostToFeed("full", false)).toBe(true);
    expect(shouldPostToFeed("full", true, true)).toBe(false);
    expect(feedChannel("full", true)).toBe("pr_board");
    expect(feedChannel("full", false)).toBe("general");
    expect(feedChannel("checkin_only", true)).toBe("general");
  });
  it("finishing a workout and counting an imported record both use it", () => {
    expect(read("components/session/complete-workout-button.tsx")).toContain("announceWorkoutLog(supabase, {");
    expect(read("components/pr-promotion/answer-card.tsx")).toContain("announceWorkoutLog(supabase, {");
  });
});

describe("the profile", () => {
  const page = read("app/(coach)/groups/[groupId]/athletes/[athleteId]/page.tsx");
  it("the coach's control is on imported records only, and not on the coach's own profile", () => {
    expect(page).toContain("{pr.sessionId && !selfView ? (");
    expect(page).toContain("<MakePrCountButton");
  });
  it("a workout that was promoted is listed once, as its log", () => {
    expect(page).toContain("const loggedSessionIds = new Set((allLogs ?? []).map((l: any) => l.session_id as string));");
    expect(page).toContain(".filter((x: any) => !loggedSessionIds.has(x.id as string))");
  });
  it("a record in a promoted workout is no longer found in hindsight (the log's own record list counts it)", () => {
    const row = (hasLog: boolean): RollupRow => ({ sessionId: hasLog ? "p" : "q", at: "2025-03-10T12:00:17Z", exerciseName: "Deadlift", bestWeight: 900, bestE1rm: null, volume: 900, sets: 1, imported: true, hasLog });
    const earlier: RollupRow = { ...row(false), sessionId: "e", at: "2025-01-10T12:00:17Z", bestWeight: 800 };
    expect(hindsightPrs([earlier, row(false)]).map((p) => p.sessionId)).toEqual(["q"]);
    expect(hindsightPrs([earlier, row(true)])).toEqual([]);
  });
});

describe("the answer page", () => {
  it("only the client it is about can see it, and a yes goes through the database function", () => {
    const page = read("app/pr-promotion/[id]/page.tsx");
    expect(page).toContain('.eq("athlete_id", user.id)');
    expect(page).toContain('promo.status === "asked"');
    expect(read("components/pr-promotion/answer-card.tsx")).toContain('rpc("answer_pr_promotion"');
  });
});
