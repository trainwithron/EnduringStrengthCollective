import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");

describe("joining an organization needs the person's OK", () => {
  it("the owner's right to insert any membership is removed in the database", () => {
    const sql = read("supabase/migrations/0352_organization_invites_accept_and_leave.sql");
    expect(sql).toContain('drop policy if exists "org_memberships_insert_owner" on public.organization_memberships;');
    expect(sql).toContain("invited_profile_id is distinct from auth.uid()");
  });
  it("an existing account gets an invitation, a new address is invited by email", () => {
    const route = read("app/api/coaches/invite/route.ts");
    expect(route).toContain('rpc("profile_id_for_email"');
    expect(route).toContain('.from("organization_invites")');
    expect(route.indexOf("profile_id_for_email")).toBeLessThan(route.indexOf("inviteUserByEmail"));
    expect(read("components/coach/desktop/invite-coach-form.tsx")).toContain("They already have an account");
  });
  it("the invited person accepts or declines through the database function, and can leave from settings", () => {
    expect(read("components/org/org-invite-answer.tsx")).toContain('rpc("answer_organization_invite"');
    expect(read("components/org/leave-organization-control.tsx")).toContain('rpc("leave_organization"');
    expect(read("app/(coach)/groups/[groupId]/settings/page.tsx")).toContain("<LeaveOrganizationControl");
  });
});
