import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { suggestSeasonName } from "./season-name";
import { dayKeysBetween, loadAttendance } from "./attendance";
import { activityPeriod } from "./coach-activity";

const root = join(__dirname, "..");
const src = (p: string) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");

describe("season names", () => {
  it("a name that ends in a year moves on a year; any other gets next year added", () => {
    const now = new Date("2026-10-17T12:00:00Z");
    expect(suggestSeasonName("Varsity 2026", now)).toBe("Varsity 2027");
    expect(suggestSeasonName("Fall 2026", now)).toBe("Fall 2027");
    expect(suggestSeasonName("Varsity", now)).toBe("Varsity 2027");
    expect(suggestSeasonName("  ", now)).toBe("2027");
    expect(suggestSeasonName("Class of 1850", now)).toBe("Class of 1850 2027"); // not a plausible season year
  });
});

function fakeDb(tables: Record<string, any[]>) {
  return {
    from(table: string) {
      let rows = tables[table] ?? [];
      const q: any = {
        select: () => q,
        eq: (c: string, v: unknown) => ((rows = rows.filter((r) => r[c] === v)), q),
        gte: (c: string, v: string) => ((rows = rows.filter((r) => r[c] >= v)), q),
        lt: (c: string, v: string) => ((rows = rows.filter((r) => r[c] < v)), q),
        not: (c: string, _op: string, _v: unknown) => ((rows = rows.filter((r) => r[c] != null)), q),
        order: () => q,
        range: (from: number, to: number) => Promise.resolve({ data: rows.slice(from, to + 1), error: null }),
      };
      return q;
    },
  };
}

describe("attendance", () => {
  const tables = {
    group_memberships: [
      { id: "m1", group_id: "g", role: "athlete", profile_id: "a1", profiles: { full_name: "Ann" }, group_positions: { name: "QB" } },
      { id: "m2", group_id: "g", role: "athlete", profile_id: "a2", profiles: { full_name: "Bo" }, group_positions: null },
      { id: "m3", group_id: "g", role: "coach", profile_id: "c", profiles: { full_name: "Coach" } },
    ],
    kiosk_checkins: [
      { id: "k1", group_id: "g", athlete_id: "a1", checked_in_at: "2026-10-05T14:00:00Z" },
      { id: "k2", group_id: "g", athlete_id: "a1", checked_in_at: "2026-10-05T18:00:00Z" }, // same day, counted once
    ],
    athlete_sessions: [
      { id: "s1", group_id: "g", athlete_id: "a1", status: "completed", is_historical: false, completed_at: "2026-10-05T20:00:00Z" },
      { id: "s2", group_id: "g", athlete_id: "a2", status: "completed", is_historical: false, completed_at: "2026-11-01T01:00:00Z" }, // 6pm Oct 31 Pacific
      { id: "s3", group_id: "g", athlete_id: "a2", status: "completed", is_historical: true, completed_at: "2026-10-06T12:00:00Z" }, // imported history is not attendance
      { id: "s4", group_id: "g", athlete_id: "a2", status: "in_progress", is_historical: false, completed_at: "2026-10-07T12:00:00Z" },
    ],
    group_session_attendees: [{ id: "x1", group_id: "g", athlete_id: "a2", attended_at: "2026-10-12T16:00:00Z" }],
  };

  it("counts a day once however many ways the person was there, and says how", async () => {
    const p = activityPeriod("2026-10-01", "2026-10-31", "America/Los_Angeles", new Date("2026-11-05T00:00:00Z"));
    const a = await loadAttendance(fakeDb(tables), { groupId: "g", fromIso: p.fromIso, toIso: p.toIso, fromDay: p.fromDay, toDay: p.toDay, timeZone: "America/Los_Angeles" });
    expect(a.failed).toBe(false);
    const ann = a.athletes.find((x) => x.athleteId === "a1")!;
    expect(ann.daysPresent).toBe(1);
    expect(ann.days["2026-10-05"].sort()).toEqual(["kiosk", "workout"]);
    expect(ann.positionName).toBe("QB");
  });

  it("uses the coach's calendar day: a 6pm Pacific workout on Oct 31 is Oct 31; imported history and an unfinished workout are not attendance", async () => {
    const p = activityPeriod("2026-10-01", "2026-10-31", "America/Los_Angeles", new Date("2026-11-05T00:00:00Z"));
    const a = await loadAttendance(fakeDb(tables), { groupId: "g", fromIso: p.fromIso, toIso: p.toIso, fromDay: p.fromDay, toDay: p.toDay, timeZone: "America/Los_Angeles" });
    const bo = a.athletes.find((x) => x.athleteId === "a2")!;
    expect(Object.keys(bo.days).sort()).toEqual(["2026-10-12", "2026-10-31"]);
    expect(bo.days["2026-10-12"]).toEqual(["session"]);
  });

  it("lists every day of the period, in order, and stops at a sane length", () => {
    expect(dayKeysBetween("2026-10-30", "2026-11-02")).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
    expect(dayKeysBetween("2020-01-01", "2026-01-01", 400)).toHaveLength(400);
  });
});

describe("Release J: wiring", () => {
  it("a retired season is left out of the coach's lists, where people land, and the switcher, and a database without the column reads as before", () => {
    const groups = src("lib/coach-groups.ts");
    expect(groups).toContain("g.archived_at");
    expect(groups).toContain('readWith("id, name, group_kind, organization_id")');
    const start = src("lib/start-group.ts");
    expect(start).toContain('read("group_kind, archived_at")');
    expect(start).toContain('read("group_kind")');
    expect(src("components/coach/desktop/group-switcher.tsx")).toContain("!g.archived_at");
    expect(src("lib/your-coaches.ts")).toContain("!g.archived_at");
  });

  it("starting a season asks first, says nothing is copied from the old one, and the database function does the work in one step", () => {
    const panel = src("components/coach/desktop/new-season-panel.tsx");
    expect(panel).toContain("confirmDialog(");
    expect(panel).toContain('rpc("start_next_season"');
    expect(panel).toContain("nothing from it is copied into the new season");
    const sql = src("supabase/migrations/0394_team_seasons.sql");
    expect(sql).toContain("revoke execute on function public.start_new_season(uuid, text, uuid[]) from public, anon;");
    expect(sql).toContain("update public.groups set archived_at = now(), next_season_id = v_new where id = p_group;");
    expect(sql).toContain("was already started from this one, so it stays retired");
  });

  it("the roster behind the attendance grid names which position link it means (a membership has two), and the leaderboard does the same", () => {
    expect(src("lib/attendance.ts")).toContain("group_positions!group_memberships_position_id_fkey ( name )");
    // the leaderboard's roster now comes through the narrow read, which keeps the same named link
    expect(src("lib/group-roster-reads.ts")).toContain("group_positions!group_memberships_position_id_fkey ( name, sort_order )");
  });

  it("a season's athletes keep their membership type and history-import setting into the next season", () => {
    const sql = src("supabase/migrations/0394_team_seasons.sql");
    expect(sql).toContain("membership_type, history_import_enabled)");
    expect(sql).toContain("m.membership_type, m.history_import_enabled");
  });

  it("Coach home goes to the coaching Home, not the group the coach is standing in", () => {
    expect(src("components/athlete/acting-as-banner.tsx")).toContain('router.push(phone ? COACH_PHONE_LANDING : "/dashboard");');
  });

  it("readers of history include retired seasons; lists do not; a page opened on a retired season keeps its organization", () => {
    expect(src("lib/business-scope.ts")).toContain("getCoachedGroups(supabase, userId, true)");
    expect(src("app/api/coach/export/route.ts")).toContain("getCoachedGroups(supabase, user.id, true)");
    expect(src("lib/coach-groups.ts")).toContain("export async function groupsInOrgOfOpened");
    expect(src("components/coach/calendar-page-body.tsx")).toContain("groupsInOrgOfOpened(supabase, user.id, params.groupId)");
  });

  it("a failed roster read stops Start next season instead of offering it with nobody on it", () => {
    const page = src("app/(coach)/groups/[groupId]/team/page.tsx");
    expect(page).toContain("rosterFailed");
    expect(src("components/coach/desktop/new-season-panel.tsx")).toContain("Tick at least one athlete");
  });

  it("the attendance page and spreadsheet are for a coach of the group, use the coach's time zone, and the spreadsheet says when a read failed", () => {
    expect(src("app/(coach)/groups/[groupId]/attendance/page.tsx")).toContain('membership?.role !== "coach"');
    const csv = src("app/api/coach/attendance-csv/route.ts");
    expect(csv).toContain('coachRow?.role !== "coach"');
    expect(csv).toContain("INCOMPLETE");
    expect(csv).toContain("timeZone");
  });
});
