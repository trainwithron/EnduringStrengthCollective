import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { activityPeriod, estimateCents, loadCoachActivity } from "./coach-activity";
import { loadYourCoaches } from "./your-coaches";

const root = join(__dirname, "..");
const src = (p: string) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");

// A fake database: tables of rows; select/in/eq/gte/lt/lte/order/range behave like PostgREST for the shapes used.
function fakeDb(tables: Record<string, any[]>, rpc: Record<string, any[]> = {}) {
  return {
    rpc: (name: string) => ({ range: (from: number, to: number) => Promise.resolve({ data: (rpc[name] ?? []).slice(from, to + 1), error: null }) }),
    from(table: string) {
      let rows = tables[table] ?? [];
      const q: any = {
        select: () => q,
        in: (col: string, ids: string[]) => ((rows = rows.filter((r) => ids.includes(r[col]))), q),
        eq: (col: string, v: unknown) => ((rows = rows.filter((r) => r[col] === v)), q),
        gte: (col: string, v: string) => ((rows = rows.filter((r) => r[col] >= v)), q),
        lt: (col: string, v: string) => ((rows = rows.filter((r) => r[col] < v)), q),
        lte: (col: string, v: number) => ((rows = rows.filter((r) => r[col] <= v)), q),
        order: () => q,
        range: (from: number, to: number) => Promise.resolve({ data: rows.slice(from, to + 1), error: null }),
        then: (resolve: (v: unknown) => unknown) => resolve({ data: rows, error: null }),
      };
      return q;
    },
  };
}

const NOW = new Date("2026-10-17T12:00:00Z");

describe("coach activity", () => {
  const tables = {
    organization_memberships: [
      { organization_id: "o1", profile_id: "c1", role: "coach", profiles: { full_name: "Ann Coach" } },
      { organization_id: "o1", profile_id: "c2", role: "admin", profiles: { full_name: "Bo Admin" } },
    ],
    groups: [{ id: "g1", organization_id: "o1" }, { id: "g2", organization_id: "o1" }],
    group_memberships: [
      { id: "m1", group_id: "g1", profile_id: "c1", role: "coach" },
      { id: "m2", group_id: "g2", profile_id: "c2", role: "coach" },
      { id: "m3", group_id: "g1", profile_id: "k1", role: "athlete", profiles: { full_name: "Kim" } },
      { id: "m4", group_id: "g1", profile_id: "k2", role: "athlete", profiles: { full_name: "Kai" } },
      { id: "m5", group_id: "g2", profile_id: "k3", role: "athlete", profiles: { full_name: "Kit" } },
    ],
    bookings: [
      { id: "b1", coach_id: "c1", athlete_id: "k1", group_id: "g1", start_at: "2026-10-05T10:00:00Z", status: "confirmed", no_show: false, late_cancel: false, session_type: "PT" },
      { id: "b2", coach_id: "c1", athlete_id: "k1", group_id: "g1", start_at: "2026-10-06T10:00:00Z", status: "confirmed", no_show: true, late_cancel: false },
      { id: "b3", coach_id: "c1", athlete_id: "k2", group_id: "g1", start_at: "2026-10-07T10:00:00Z", status: "cancelled", no_show: false, late_cancel: true },
      { id: "b4", coach_id: "c1", athlete_id: "k2", group_id: "g1", start_at: "2026-10-30T10:00:00Z", status: "confirmed", no_show: false, late_cancel: false }, // not yet happened
      { id: "b5", coach_id: "c2", athlete_id: "k3", group_id: "g2", start_at: "2026-10-08T10:00:00Z", status: "cancelled", no_show: false, late_cancel: false },
    ],
    credit_purchases: [{ id: "p1", group_id: "g1", credits_purchased: 10, created_at: "2026-10-03T00:00:00Z" }],
    session_credits: [{ athlete_id: "k2", group_id: "g1", balance: 1 }],
  };
  const rpc = { business_last_active: [{ athlete_id: "k1", last_at: "2026-10-15T00:00:00Z" }, { athlete_id: "k3", last_at: "2026-08-01T00:00:00Z" }] };

  it("counts a session only when it was confirmed, has passed and was not a no-show; and traces every total to its sessions", async () => {
    const p = activityPeriod("2026-10-01", "2026-10-31", NOW);
    const a = await loadCoachActivity(fakeDb(tables, rpc), { orgId: "o1", fromIso: p.fromIso, toIso: p.toIso, now: NOW });
    expect(a.failed).toBe(false);
    const ann = a.rows.find((r) => r.coachId === "c1")!;
    expect(ann).toMatchObject({ clients: 2, sessionsDelivered: 1, noShows: 1, lateCancels: 1 });
    expect(a.sessionLines).toEqual([expect.objectContaining({ bookingId: "b1", coachName: "Ann Coach", clientName: "Kim", sessionType: "PT" })]);
    expect(a.creditsSold).toBe(10);
  });

  it("finds quiet clients (no workout in 14 days, or never) and clients low on sessions, per coach", async () => {
    const p = activityPeriod("2026-10-01", "2026-10-31", NOW);
    const a = await loadCoachActivity(fakeDb(tables, rpc), { orgId: "o1", fromIso: p.fromIso, toIso: p.toIso, now: NOW });
    const ann = a.rows.find((r) => r.coachId === "c1")!;
    const bo = a.rows.find((r) => r.coachId === "c2")!;
    expect(ann.quietClients).toBe(1); // Kai never worked out; Kim did, two days ago
    expect(ann.lowBalanceClients).toBe(1);
    expect(bo.quietClients).toBe(1); // Kit's last workout was in August
  });

  it("a failed read is reported, never read as nothing", async () => {
    const bad = { ...fakeDb(tables, rpc), from: (t: string) => (t === "bookings" ? { select: () => ({ in: () => ({ gte: () => ({ lt: () => ({ order: () => ({ range: () => Promise.resolve({ data: null, error: { message: "x" } }) }) }) }) }) }) } : fakeDb(tables, rpc).from(t)) };
    const p = activityPeriod("2026-10-01", "2026-10-31", NOW);
    const a = await loadCoachActivity(bad, { orgId: "o1", fromIso: p.fromIso, toIso: p.toIso, now: NOW });
    expect(a.failed).toBe(true);
  });

  it("the period is the dates asked for, the end day included, and a bad one falls back to this month so far", () => {
    expect(activityPeriod("2026-10-01", "2026-10-31", NOW)).toMatchObject({ fromIso: "2026-10-01T00:00:00.000Z", toIso: "2026-11-01T00:00:00.000Z" });
    expect(activityPeriod("nonsense", undefined, NOW)).toMatchObject({ fromDay: "2026-10-01", toDay: "2026-10-17" });
    expect(activityPeriod("2026-10-20", "2026-10-02", NOW)).toMatchObject({ fromDay: "2026-10-01", toDay: "2026-10-17" });
  });

  it("the estimate is sessions times the typed rate, and a bad rate is zero", () => {
    expect(estimateCents(12, 4500)).toBe(54000);
    expect(estimateCents(12, -5)).toBe(0);
    expect(estimateCents(12, Number.NaN)).toBe(0);
  });
});

describe("your coaches", () => {
  it("lists every space the person trains in with who coaches it, sorted by organization", async () => {
    const db = fakeDb({
      group_memberships: [
        { id: "a", group_id: "g1", profile_id: "me", role: "athlete", groups: { id: "g1", name: "Zed space", group_kind: "one_on_one", organizations: { name: "Zed Gym" } } },
        { id: "b", group_id: "g2", profile_id: "me", role: "athlete", groups: { id: "g2", name: "Morning team", group_kind: "team", organizations: { name: "Alpha Club" } } },
        { id: "c", group_id: "g1", profile_id: "z", role: "coach", profiles: { full_name: "Zed Coach" } },
        { id: "d", group_id: "g2", profile_id: "a", role: "coach", profiles: { full_name: "Alpha Coach" } },
      ],
    });
    const { spaces, failed } = await loadYourCoaches(db, "me");
    expect(failed).toBe(false);
    expect(spaces.map((s) => [s.organizationName, s.coachNames[0], s.oneOnOne])).toEqual([["Alpha Club", "Alpha Coach", false], ["Zed Gym", "Zed Coach", true]]);
  });
});

describe("Release I: wiring", () => {
  it("an existing account is invited (not refused) for a one-on-one space, and the empty space is kept while the invitation is open", () => {
    const route = src("app/api/clients/invite/route.ts");
    expect(route).toContain('from("space_invites")');
    expect(route).toContain("invitedExisting");
    expect(route).toContain('type: "space_invite"');
    expect(src("components/coach/desktop/add-client-button.tsx")).toContain("!added && !invitedExisting");
    expect(src("app/space-invite/[inviteId]/page.tsx")).toContain("SpaceInviteAnswer");
  });

  it("invite notices are written through one function that reports a refused notification, and every type it writes is in the database's list", () => {
    const notify = src("lib/invite-notify.ts");
    expect(notify).toContain("[invite-notify] notification");
    const sql = src("supabase/migrations/0393_space_invites.sql");
    for (const t of ["organization_invite", "space_invite", "org_announcement"]) expect(sql, t).toContain(`'${t}'`);
    expect(src("app/api/coaches/invite/route.ts")).toContain("notifyAndEmail(");
    expect(src("app/api/coaches/invite/route.ts")).not.toContain('from("notifications").insert');
  });

  it("owner pages: activity and payroll estimate are owner/admin only, the rate is never saved, and the announcement reaches coaches only", () => {
    const page = src("app/(coach)/groups/[groupId]/team-activity/page.tsx");
    expect(page).toContain('orgMembership?.role !== "owner" && orgMembership?.role !== "admin"');
    const csv = src("app/api/coach/activity-csv/route.ts");
    expect(csv).toContain('orgRow?.role !== "owner" && orgRow?.role !== "admin"');
    expect(csv).toContain("INCOMPLETE");
    expect(src("components/org/coach-activity-table.tsx")).toContain("not saved");
    const announce = src("app/api/org/announce/route.ts");
    expect(announce).toContain('mine?.role !== "owner" && mine?.role !== "admin"');
    expect(announce).toContain('from("organization_memberships")');
    expect(announce).not.toContain("group_memberships");
  });

  it("Team: invitations can be sent again, which also tells the person again", () => {
    expect(src("components/org/team-members-panel.tsx")).toContain("/api/org-invites/resend");
    expect(src("app/api/org-invites/resend/route.ts")).toContain('rpc("extend_org_invite"');
  });

  it("a client with more than one coach gets a link to a list of them", () => {
    expect(src("app/(coach)/groups/[groupId]/settings/page.tsx")).toContain('href="/your-coaches"');
    expect(src("app/your-coaches/page.tsx")).toContain("loadYourCoaches(");
  });
});
