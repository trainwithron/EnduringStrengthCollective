import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..");
const src = (p: string) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");

describe("Release H: getting out", () => {
  it("the Team page calls every offboarding function, and none of them is open to a signed-out caller", () => {
    const panel = src("components/org/team-members-panel.tsx");
    for (const fn of ["set_org_member_role", "remove_org_member", "extend_org_invite", "cancel_org_invite", "close_organization"]) expect(panel, fn).toContain(`"${fn}"`);
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
