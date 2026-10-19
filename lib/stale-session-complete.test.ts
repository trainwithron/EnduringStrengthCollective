import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { pickSessionsToComplete, savedDurationSeconds, type OpenSession } from "@/lib/stale-session-complete";

const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const NOW = new Date("2026-10-19T08:00:00Z");
const open = (id: string, startedAt: string, resumedAt: string | null = null): OpenSession => ({ id, athlete_id: `a-${id}`, group_id: "g", started_at: startedAt, resumed_at: resumedAt });

// Oct 19 audit: 4 abandoned sessions held 15, 8, 3 and 3 completed sets and the coach saw nothing.
describe("which left-open workouts are saved as finished", () => {
  const sessions = [
    open("with-sets", "2026-10-13T16:00:00Z"),
    open("no-sets", "2026-10-13T16:00:00Z"),
    open("recent", "2026-10-18T16:00:00Z"),
    open("resumed-yesterday", "2026-10-10T16:00:00Z", "2026-10-18T10:00:00Z"),
    open("sets-yesterday", "2026-10-13T16:00:00Z"),
  ];
  const sets = [
    { session_id: "with-sets", at: "2026-10-13T16:10:00Z" },
    { session_id: "with-sets", at: "2026-10-13T16:40:00Z" },
    { session_id: "with-sets", at: "2026-10-13T16:25:00Z" },
    { session_id: "recent", at: "2026-10-18T16:10:00Z" },
    { session_id: "resumed-yesterday", at: "2026-10-10T16:10:00Z" },
    { session_id: "sets-yesterday", at: "2026-10-18T20:00:00Z" },
  ];
  const picked = pickSessionsToComplete(sessions, sets, NOW, 3);
  it("a stale session with at least one completed set is saved, with its set count and the time of its last set", () => {
    expect(picked).toHaveLength(1);
    expect(picked[0]).toMatchObject({ id: "with-sets", sets: 3, lastSetAt: "2026-10-13T16:40:00Z", groupId: "g", athleteId: "a-with-sets" });
  });
  it("one with no completed set is not saved (it is only paused, as before)", () => {
    expect(picked.map((p) => p.id)).not.toContain("no-sets");
  });
  it("one started, resumed or logged within the last 3 days is left alone", () => {
    for (const id of ["recent", "resumed-yesterday", "sets-yesterday"]) expect(picked.map((p) => p.id), id).not.toContain(id);
  });
  it("work left open for more than 30 days is not saved by the job: it stays paused for a person to look at", () => {
    const old = [open("sept", "2026-09-12T16:00:00Z")];
    expect(pickSessionsToComplete(old, [{ session_id: "sept", at: "2026-09-12T16:20:00Z" }], NOW, 3)).toEqual([]);
    expect(pickSessionsToComplete(old, [{ session_id: "sept", at: "2026-09-12T16:20:00Z" }], new Date("2026-10-05T08:00:00Z"), 3)).toHaveLength(1);
  });
  it("the duration is start to last set, never negative and never more than 12 hours", () => {
    expect(savedDurationSeconds("2026-10-13T16:00:00Z", "2026-10-13T16:40:00Z")).toBe(2400);
    expect(savedDurationSeconds("2026-10-13T16:00:00Z", "2026-10-13T15:00:00Z")).toBe(0);
    expect(savedDurationSeconds("2026-10-13T16:00:00Z", "2026-10-15T16:00:00Z")).toBe(12 * 3600);
  });
});

describe("the nightly job", () => {
  const route = read("app/api/cron/close-stale-sessions/route.ts");
  it("saves the ones with sets through the same function the Complete button uses, before pausing the rest", () => {
    expect(route).toContain('db.rpc("complete_workout_session", { p_session_id: s.id })');
    expect(route.indexOf("saveStaleWorkoutsWithSets(supabase)")).toBeLessThan(route.indexOf('supabase.rpc("close_stale_sessions"'));
    expect(route).toContain('rpc("close_stale_sessions"');
  });
  it("never touches a workout a coach logged for a client (finishing one can settle a booking's session), and only open or paused ones", () => {
    expect(route).toContain('.eq("logged_by_coach", false)');
    expect(route).toContain('.in("status", ["in_progress", "abandoned"])');
  });
  it("?dryRun=1 only reports who would be saved and changes nothing; a deleted client's session is never a candidate", () => {
    expect(route).toContain('searchParams.get("dryRun") === "1"');
    expect(route.indexOf("if (dryRun) return")).toBeLessThan(route.indexOf('db.rpc("complete_workout_session"'));
    expect(route.indexOf('searchParams.get("dryRun") === "1"')).toBeLessThan(route.indexOf('supabase.rpc("close_stale_sessions"'));
    expect(route).toContain('.not("athlete_id", "is", null)');
  });
  it("dates the history by the last set, tells the coach in the daytime, and one failure never stops the rest", () => {
    expect(route).toContain("created_at: s.lastSetAt");
    expect(route).toContain('"client_activity"');
    expect(route).toContain("daytimeOnly: true");
    expect(route).toContain("failed += 1;\n      continue;");
  });
});

describe("the client's Home says there is a workout to finish", () => {
  const page = read("app/(coach)/groups/[groupId]/page.tsx");
  it("a line above today's card, for the client's own open or paused workout from the last 36 hours, linking into it", () => {
    expect(page).toContain("Finish your workout");
    expect(page).toContain('.in("status", ["in_progress", "abandoned"])');
    expect(page).toContain('.eq("logged_by_coach", false)');
    expect(page).toContain("?resume=1");
    expect(page.indexOf("Finish your workout")).toBeLessThan(page.indexOf("<DayCard\n                groupId={params.groupId}"));
  });
});
