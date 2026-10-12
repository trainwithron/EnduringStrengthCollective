import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");

describe("tenant safety (migration 0340 and the pages that take a client id from the address)", () => {
  const sql = read("supabase/migrations/0340_tenant_athlete_in_group.sql");
  it("one rule covers the tables where a coach files a row about a person, and checks only a signed-in user's request", () => {
    expect((sql.match(/create trigger [a-z_]+_enforce_athlete_in_group/g) ?? []).length).toBe(28);
    for (const t of ["minor_consent", "daily_macros", "meal_plans", "athlete_injury_status", "athlete_sessions", "bookings", "programs", "workout_assignments", "coach_video_checkins"]) {
      expect(sql).toContain(`create trigger ${t}_enforce_athlete_in_group`);
    }
    expect(sql).toContain("if coalesce(auth.role(), '') <> 'authenticated' then");
    expect(sql).toContain("That person is not a member of this group.");
    // an edit that doesn't change who or where the row is filed is not re-checked
    expect(sql).toContain("and v_group is not distinct from nullif(to_jsonb(old)->>'group_id', '')::uuid then");
  });
  it("moving a client needs the same organization and a real client; a direct membership edit can't cross organizations", () => {
    expect(sql).toContain("A client can only be moved between groups of the same organization.");
    expect(sql).toContain("That person is not a client in the source group.");
    expect(sql).toContain("create trigger group_memberships_guard_org_move");
  });
  it("an org admin cannot join a one-on-one space or a group with a private client; a comment stays in its post's group", () => {
    expect(sql).toContain("and not public.group_closed_to_org_admin_join(group_id)");
    expect(sql).toContain("g.group_kind = 'one_on_one'");
    expect(sql).toContain("gm.private_from_org = true");
    expect(sql).toContain("p.id = comments.post_id and p.group_id = comments.group_id");
  });
  it("the three coach pages and the package route check the client belongs to the group first", () => {
    for (const f of [
      "app/(coach)/groups/[groupId]/athletes/[athleteId]/log/page.tsx",
      "app/(coach)/groups/[groupId]/athletes/[athleteId]/log/[workoutId]/page.tsx",
      "app/(coach)/groups/[groupId]/athletes/[athleteId]/history/page.tsx",
    ]) {
      expect(read(f)).toContain("isMemberOfGroup(supabase, params.groupId, params.athleteId)");
    }
    expect(read("app/api/coach/package-assignments/route.ts")).toContain("isMemberOfGroup(supabase, pkg.group_id, athleteId)");
  });
  it("the invite route refuses one-on-one spaces and groups with a private client", () => {
    const route = read("app/api/coaches/invite/route.ts");
    expect(route).toContain('group.group_kind === "one_on_one"');
    expect(route).toContain('.eq("private_from_org", true)');
  });
  it("Session Pattern Spotter writes the coach's note, notification and push with the server's rights", () => {
    const route = read("app/api/session-pattern-check/route.ts");
    expect(route).toContain("const admin = createServiceRoleClient();");
    expect(route).toContain('await admin.from("notifications").insert(');
    expect(route).toContain("sendPushToProfile(admin, coachId");
    expect(route).not.toContain('supabase.from("session_pattern_checks")');
  });
});
