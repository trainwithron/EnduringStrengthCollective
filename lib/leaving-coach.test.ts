import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadMyDepartures } from "./leaving-coach";

const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

const fakeDb = (result: { data?: unknown; error?: unknown } | "throw") => ({
  from: () => ({
    select: () => ({
      eq: () => ({
        not: async () => {
          if (result === "throw") throw new Error("boom");
          return { data: result.data ?? null, error: result.error ?? null };
        },
      }),
    }),
  }),
});

describe("a leaving coach (migration 0396)", () => {
  it("reads the organizations the coach is leaving, by the organization's display name when it has one", async () => {
    const rows = [
      { organization_id: "o1", departing_since: "2026-10-17T00:00:00Z", organizations: { name: "Iron Works", display_name: "Iron Works Gym" } },
      { organization_id: "o2", departing_since: "2026-10-18T00:00:00Z", organizations: { name: "Peak", display_name: null } },
    ];
    expect(await loadMyDepartures(fakeDb({ data: rows }), "u1")).toEqual([
      { organizationId: "o1", organizationName: "Iron Works Gym", since: "2026-10-17T00:00:00Z" },
      { organizationId: "o2", organizationName: "Peak", since: "2026-10-18T00:00:00Z" },
    ]);
  });

  it("a database without the column yet, or a failed read, shows nothing instead of breaking Home", async () => {
    expect(await loadMyDepartures(fakeDb({ error: { message: "column does not exist" } }), "u1")).toEqual([]);
    expect(await loadMyDepartures(fakeDb("throw"), "u1")).toEqual([]);
    expect(await loadMyDepartures(fakeDb({ data: null }), "u1")).toEqual([]);
  });

  it("the banner offers exactly the two choices: start my own account (coming soon, email us) and export everything", () => {
    const banner = src("components/coach/leaving-coach-banner.tsx");
    expect(banner).toContain("Keep my clients and everything: start my own account");
    expect(banner).toContain("Coming soon:");
    expect(banner).toContain("email us");
    expect(banner).toContain("Export everything I have");
    expect(banner).toContain("<ExportBusinessButton");
    // nothing is bought or created from here
    expect(banner).not.toMatch(/stripe|checkout|price/i);
  });

  it("Home shows the banner, the Team page marks the member and takes away Remove, and leaving yourself lands on Home", () => {
    const home = src("app/(coach)/dashboard/page.tsx");
    expect(home).toContain("loadMyDepartures(supabase, user.id)");
    expect(home).toContain("<LeavingCoachBanner");
    const panel = src("components/org/team-members-panel.tsx");
    expect(panel).toContain("m.leaving");
    expect(panel).toContain("&& !m.leaving;");
    expect(panel).toContain(">Leaving<");
    expect(src("components/org/leave-organization-control.tsx")).toContain('?.leaving ? "/dashboard"');
  });

  it("the Team page reads who is leaving in its own read, so a database without the column yet only hides the mark", () => {
    const page = src("app/(coach)/groups/[groupId]/branding/page.tsx");
    expect(page).toContain('.not("departing_since", "is", null)');
    expect(page).toContain("leaving: leavingIds.has(m.profile_id)");
  });

  it("a leaving coach is not a member for anything organization-wide, and the lists that offer people skip them", () => {
    const sql = src("supabase/migrations/0396_leaving_coach_choice.sql");
    expect(sql).toContain("profile_id = auth.uid() and departing_since is null");
    expect(sql).toContain("org_memberships_select_self");
    expect(sql).toContain("om_caller.departing_since is null");
    // only the groups kept when they were marked leaving ever move, and the owner cannot be finished this way
    expect(sql).toContain("g.id = any (v_kept)");
    expect(sql).toContain("for update");
    // the ownership transfer keeps the live service-role branch; the group-coach picker refuses a leaving member
    expect(sql).toContain("if auth.role() = 'service_role' then");
    expect(sql).toContain("profile_id = p_coach and departing_since is null");
    expect(sql).toContain("The owner of an organization cannot leave it this way.");
    for (const f of ["lib/trainer-dispatch-gather.ts", "app/api/org/announce/route.ts", "lib/calendar-spotter-phase2-gather.ts"]) expect(src(f), f).toContain('.is("departing_since", null)');
    // a leaving coach still has sessions and clients in the organization: they stay in the activity list, named and marked
    expect(src("lib/coach-activity.ts")).toContain('" (leaving)"');
    expect(src("components/org/team-members-panel.tsx")).toContain("x.profileId !== m.profileId && !x.leaving");
    expect(src("app/(coach)/groups/[groupId]/branding/page.tsx")).toContain("m.profileId !== user.id && !m.leaving");
    expect(src("app/(coach)/groups/[groupId]/settings/page.tsx")).toContain('.is("departing_since", null)');
  });

  it("each organization being left gets its own section, exporting that organization from the coach's own coached groups", () => {
    const home = src("app/(coach)/dashboard/page.tsx");
    expect(home).toContain("departuresWithExport");
    expect(home).toContain("g.organization_id === d.organizationId");
    expect(src("components/coach/leaving-coach-banner.tsx")).toContain("departures.map((d) => (");
  });
});
