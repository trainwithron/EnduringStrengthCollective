import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { daysLeftToChoose, departurePlan, exportLinkStillWorks, retentionDays, windowEndsAt, WINDOW_DAYS, type DepartureRow } from "./leaving-coach-policy";

const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const T0 = "2026-10-17T12:00:00Z";
const at = (days: number) => new Date(new Date(T0).getTime() + days * 86_400_000);
const row = (over: Partial<DepartureRow> = {}): DepartureRow => ({ departingSince: T0, firedAt: null, accessEndedAt: null, departureNotifiedAt: null, reminded3dAt: null, reminded1dAt: null, closureNotifiedAt: null, clientsNotifiedAt: null, ...over });

describe("a coach who is leaving: the seven days", () => {
  it("day 0: told they are leaving, nothing else", () => {
    expect(departurePlan(row(), at(0))).toEqual({ tellThemTheyAreLeaving: true, remind3: false, remind1: false, endAccess: false, closure: false });
  });
  it("reminders with three days and with one day left, each once", () => {
    const told = row({ departureNotifiedAt: T0 });
    expect(departurePlan(told, at(3.9)).remind3).toBe(false);
    expect(departurePlan(told, at(4)).remind3).toBe(true);
    expect(departurePlan({ ...told, reminded3dAt: "x" }, at(4.5)).remind3).toBe(false);
    expect(departurePlan(told, at(6)).remind1).toBe(true);
    expect(departurePlan({ ...told, reminded1dAt: "x" }, at(6.5)).remind1).toBe(false);
  });
  it("at day seven access ends and the export goes out; after that nothing repeats", () => {
    const p = departurePlan(row({ departureNotifiedAt: T0, reminded3dAt: T0, reminded1dAt: T0 }), at(7));
    expect(p.endAccess).toBe(true);
    expect(p.closure).toBe(true);
    expect(p.remind3 || p.remind1 || p.tellThemTheyAreLeaving).toBe(false);
    const done = departurePlan(row({ departureNotifiedAt: T0, accessEndedAt: at(7).toISOString(), closureNotifiedAt: at(7).toISOString(), clientsNotifiedAt: at(7).toISOString() }), at(8));
    expect(done).toEqual({ tellThemTheyAreLeaving: false, remind3: false, remind1: false, endAccess: false, closure: false });
  });
  it("a job that ran late sends one message, the latest that applies, never two contradictory ones", () => {
    const fresh = row();
    // first seen with 12 hours left: only the one-day reminder, not the "you are leaving" notice or the three-day one
    expect(departurePlan(fresh, at(6.5))).toEqual({ tellThemTheyAreLeaving: false, remind3: false, remind1: true, endAccess: false, closure: false });
    // first seen after the seven days: access ends and the closing steps follow; no reminders and no "you have seven days"
    expect(departurePlan(fresh, at(8))).toEqual({ tellThemTheyAreLeaving: false, remind3: false, remind1: false, endAccess: true, closure: true });
    // closing is not done until the coach AND every client have been told
    const half = row({ accessEndedAt: at(7).toISOString(), closureNotifiedAt: at(7).toISOString() });
    expect(departurePlan(half, at(8)).closure).toBe(true);
  });
  it("a coach who was let go is never told they have days; they get only the closing step", () => {
    const p = departurePlan(row({ firedAt: T0, accessEndedAt: T0 }), at(0));
    expect(p).toEqual({ tellThemTheyAreLeaving: false, remind3: false, remind1: false, endAccess: false, closure: true });
  });
  it("the window is seven days, the same as the database's", () => {
    expect(WINDOW_DAYS).toBe(7);
    expect(windowEndsAt(T0).toISOString()).toBe("2026-10-24T12:00:00.000Z");
    expect(src("supabase/migrations/0396_leaving_coach_choice.sql")).toContain("departing_since <= now() - interval '7 days'");
    expect(daysLeftToChoose(T0, at(0))).toBe(7);
    expect(daysLeftToChoose(T0, at(6.2))).toBe(1);
    expect(daysLeftToChoose(T0, at(9))).toBe(0);
  });
  it("the export link needs the 30 days to have not passed", () => {
    expect(exportLinkStillWorks(T0, at(29))).toBe(true);
    expect(exportLinkStillWorks(T0, at(31))).toBe(false);
    expect(exportLinkStillWorks(null, at(1))).toBe(false);
  });
  it("retention is 365 days unless RETENTION_DAYS says otherwise (and never under 30)", () => {
    expect(retentionDays(undefined)).toBe(365);
    expect(retentionDays("730")).toBe(730);
    expect(retentionDays("3")).toBe(365);
    expect(retentionDays("abc")).toBe(365);
  });
});

describe("wiring of the seven days", () => {
  it("the job is scheduled, watched, and claims each step before sending it", () => {
    expect(src("vercel.json")).toContain('"/api/cron/departing-coaches"');
    expect(src("lib/cron-jobs.ts")).toContain('job: "departing-coaches"');
    const job = src("app/api/cron/departing-coaches/route.ts");
    expect(job).toContain('withCronRun("departing-coaches"');
    for (const col of ["departure_notified_at", "reminded_3d_at", "reminded_1d_at", "closure_notified_at"]) expect(job, col).toContain(col);
    expect(job).toContain('rpc("end_departure_access"');
    expect(job).toContain("giveBack(");
  });
  it("the export is made once when access ends and stored privately, and the route only hands out that file", () => {
    const job = src("app/api/cron/departing-coaches/route.ts");
    expect(job).toContain("storeExitExport(");
    expect(job).toContain("clients_notified_at");
    expect(job).toContain('.eq("membership_type", "training")');
    expect(job).toContain("emailToo: adult");
    const route = src("app/api/coach/exit-export/route.ts");
    expect(route).toContain("createSignedUrl(row.export_path");
    expect(route).toContain('.eq("organization_id", row.organization_id)');
    const sql = src("supabase/migrations/0396_leaving_coach_choice.sql");
    expect(sql).toContain("insert into storage.buckets");
    expect(sql).toContain("coach-exit-exports");
  });
  it("the undo puts back only the seats of coaches who were NOT let go, and clears the stored exports", () => {
    const undo = src("supabase/apply/undo-step148-0396.sql");
    expect(undo).toContain("where om.access_ended_at is not null and om.fired_at is null");
    expect(undo).toContain("delete from storage.objects where bucket_id = 'coach-exit-exports'");
    expect(src("app/api/cron/departing-coaches/route.ts")).toContain(".remove([s.export_path])");
    expect(src("lib/leaving-coach.ts")).toContain("departing_org_name");
  });
  it("an ended coach sees why and the way to their export instead of a dead end", () => {
    const home = src("app/(coach)/dashboard/page.tsx");
    expect(home.indexOf("filter((d) => d.endedAt)")).toBeGreaterThan(-1);
    expect(home.indexOf("filter((d) => d.endedAt)")).toBeLessThan(home.indexOf("Only coaches have a home dashboard."));
  });
  it("the export is the coach's own, from the groups they kept, only while the link works", () => {
    const route = src("app/api/coach/exit-export/route.ts");
    expect(route).toContain(".eq(\"profile_id\", user.id)");
    expect(route).toContain("exportLinkStillWorks(");
    expect(route).toContain("departing_group_ids");
  });
  it("starting an account takes the coach from the session and leaves the refusals to the database", () => {
    const route = src("app/api/coach/start-own-account/route.ts");
    expect(route).toContain('rpc("complete_departure", { p_org: organizationId, p_coach: user.id })');
    expect(route).not.toMatch(/body\??\.coach/);
  });
  it("the owner is asked why a coach is going, and it is sent with the removal", () => {
    expect(src("components/org/team-members-panel.tsx")).toContain("They are being let go");
  });
});
