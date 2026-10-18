import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

// Every way a person becomes a client, and what sends them to the health form and waiver (profiles.intake_required, read by the sign-in gate) and to the birthday step (the date-of-birth gate, which covers every
// client-only account whatever the flag says).
describe("every door a client can come through", () => {
  it("a coach adding a client, importing a roster, and the public booking page make a NEW account that is flagged at creation", () => {
    expect(src("lib/create-unclaimed-client.ts")).toContain("intake_required: true");
    expect(src("app/api/clients/import-roster/route.ts")).toContain("createUnclaimedClient(");
    expect(src("app/api/clients/invite/route.ts")).toContain("createUnclaimedClient(");
    expect(src("lib/public-booking-store.ts")).toContain("intake_required: true");
  });

  it("an invite link for someone with no account flags the new profile; the claim link opens an account that was flagged when the coach made it", () => {
    expect(src("components/invite/invite-join-flow.tsx").match(/intake_required: true/g)!.length).toBeGreaterThanOrEqual(2);
    expect(src("lib/create-unclaimed-client.ts")).toContain("claimed_at: null");
  });

  it("someone who ALREADY had an account (an invite link, or a coach's invitation they accept) is flagged by the database when the membership is made, whatever code made it", () => {
    const sql = src("supabase/migrations/0403_intake_for_every_client.sql");
    expect(sql).toContain("after insert on public.group_memberships");
    expect(sql).toContain("new.role is distinct from 'athlete' or new.membership_type is distinct from 'training'");
    expect(sql).toContain("c.role = 'coach'");
    expect(sql).toContain("i.completed_at is not null");
    expect(sql).toContain("set intake_required = true");
    // only a genuinely NEW client: not someone already in a group (a new season copies the same people), not staff of an organization, not the front desk
    expect(sql).toContain("m.id <> new.id and m.role = 'athlete' and m.membership_type = 'training'");
    expect(sql).toContain("from public.organization_memberships o where o.profile_id = new.profile_id");
    expect(sql).toContain("public.org_front_desk");
    // and a problem inside it can never cost a client their membership
    expect(sql).toContain("exception when others then");
    expect(sql).toContain("raise warning 'require_intake_for_new_client: %', sqlerrm;");
    // both existing-account doors end in a membership insert: the link's function and the invitation's answer
    expect(src("components/invite/invite-join-flow.tsx")).toContain('rpc("join_group_with_invite"');
    expect(src("components/org/space-invite-answer.tsx")).toContain('rpc("answer_space_invite"');
  });

  it("the birthday step covers every client-only account on every door, and the health form is closed behind the flag", () => {
    const mw = src("lib/supabase/middleware.ts");
    expect(mw).toContain("loadDobGate(supabase, user.id)");
    expect(mw).toContain("profile?.intake_required");
    expect(src("lib/dob-gate.ts")).toContain("hasAthleteSeat && !hasCoachSeat && !isStaff");
  });
});
