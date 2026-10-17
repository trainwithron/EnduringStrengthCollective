import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..");
const src = (p: string) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");

describe("Release H: getting out", () => {
  it("the Team page calls every offboarding function, and none of them is open to a signed-out caller", () => {
    const panel = src("components/org/team-members-panel.tsx");
    for (const fn of ["set_org_member_role", "remove_org_member", "cancel_org_invite", "close_organization"]) expect(panel, fn).toContain(`"${fn}"`);
    const sql = src("supabase/migrations/0391_offboarding.sql");
    for (const fn of ["remove_org_member(uuid, uuid, uuid)", "leave_organization(uuid, uuid)", "set_org_member_role(uuid, uuid, text)", "cancel_org_invite(uuid)", "extend_org_invite(uuid)", "close_organization(uuid)"]) {
      expect(sql, fn).toContain(`revoke execute on function public.${fn} from public, anon;`);
    }
    // the internal helpers can be run by the server only
    for (const fn of ["_solo_org_for(uuid, uuid)", "_detach_coach_from_org(uuid, uuid, uuid, boolean)"]) {
      expect(sql, fn).toContain(`revoke execute on function public.${fn} from public, anon, authenticated;`);
    }
  });

  it("leaving asks who takes over when the coach alone coaches clients, and sends the choice", () => {
    const leave = src("components/org/leave-organization-control.tsx");
    expect(leave).toContain("p_hand_to");
    expect(leave).toContain("Who takes over?");
    expect(src("app/(coach)/groups/[groupId]/settings/page.tsx")).toContain("soleClients={leaveInfo.soleClients}");
  });

  it("the export is on the Team tab, runs as the signed-in coach and names a part it could not read", () => {
    expect(src("app/(coach)/groups/[groupId]/branding/page.tsx")).toContain("ExportBusinessButton");
    const route = src("app/api/coach/export/route.ts");
    expect(route).toContain("getCoachedGroups(");
    expect(route).toContain('rateLimitResponse("coach-export"');
    expect(src("lib/business-export.ts")).toContain("INCOMPLETE");
  });
});

describe("Release H: what a coach coaches", () => {
  it("signup asks it, saves it on its own after the organization exists, and settings can change it", () => {
    expect(src("app/signup/page.tsx")).toContain("What do you coach?");
    expect(src("app/signup/page.tsx")).toContain("coachType");
    const route = src("app/api/coaches/signup/route.ts");
    expect(route).toContain("isCoachType(body.coachType)");
    // a separate update, never part of the profile insert: a database without the column still signs people up
    expect(route).not.toMatch(/from\("profiles"\)\s*\.insert\([^)]*coach_type/);
    expect(src("components/coach/coach-type-setting.tsx")).toContain("coach_type");
    expect(src("app/(coach)/groups/[groupId]/settings/page.tsx")).toContain("CoachTypeSetting");
    expect(src("supabase/migrations/0392_coach_type.sql")).toContain("check (coach_type in ('personal', 'team', 'gym'))");
  });

  it("an owner or admin adding a one-on-one client can choose the coach, through the database function that checks they may", () => {
    const ui = src("components/coach/desktop/add-client-button.tsx");
    expect(ui).toContain('rpc("assign_group_coach"');
    expect(ui).toContain("Who coaches them");
    expect(src("supabase/migrations/0392_coach_type.sql")).toContain("revoke execute on function public.assign_group_coach(uuid, uuid, boolean) from public, anon;");
  });
});

describe("Release H: review fixes", () => {
  it("the one-paste bundle really holds all three steps, and steps.json lists them (it once held only the first)", () => {
    const bundle = src("supabase/apply/apply-release-h-importers-all.sql");
    expect(bundle).toContain("import_batch_id");
    expect(bundle).toContain("remove_org_member");
    expect(bundle).toContain("assign_group_coach");
    expect(bundle).toContain("coach_type");
    const steps = JSON.parse(src("supabase/apply/steps.json")) as { n: string }[];
    for (const n of ["142", "143", "144"]) expect(steps.some((s) => String(s.n) === n), n).toBe(true);
  });

  it("a private client's group can be handed on only by a coach who already holds it, and the person taking over can never be a client of that group", () => {
    const sql = src("supabase/migrations/0392_coach_type.sql");
    expect(sql).toContain("and not public.is_group_coach(p_group) then");
    expect(sql).not.toContain("p_coach <> me and exists (select 1 from public.group_memberships a where a.group_id = p_group and a.role = 'athlete' and a.private_from_org)");
    const off = src("supabase/migrations/0391_offboarding.sql");
    expect(off).toContain("The person chosen to take over is a client in");
    expect(off).toContain("Could not make the chosen person the coach of");
  });

  it("a coach who leaves into an organization of their own takes their shop, classes, session types and calendar with them", () => {
    const off = src("supabase/migrations/0391_offboarding.sql");
    for (const t of ["pro_shop_links", "referral_partners", "session_types", "challenges", "calendar_events", "discovery_bookings", "coach_briefings", "group_sessions"]) {
      expect(off, t).toContain(`update public.${t} set organization_id = v_solo`);
    }
  });

  it("a roster whose result could not be confirmed is never offered a blind retry", () => {
    const panel = src("components/coach/desktop/roster-import-panel.tsx");
    expect(panel).toContain('"uncertain"');
    expect(panel).toContain("could not confirm whether");
    expect(src("app/api/clients/import-roster/route.ts")).toContain('raw && typeof raw === "object"');
    expect(src("app/api/clients/import-roster/undo/route.ts")).toContain("UNDO_WINDOW_MS");
  });
});
