import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

describe("AF3: coaches may void or resend a guardian's permission only for a live training seat", () => {
  it("both routes ask for the groups where the client TRAINS in a live group, not any seat", () => {
    for (const f of ["app/api/guardian-consent/void/route.ts", "app/api/guardian-consent/resend/route.ts"]) {
      const s = src(f);
      expect(s, f).toContain('import { liveTrainingGroupIds } from "@/lib/guardian-consent-server";');
      expect(s, f).toContain("const groupIds = await liveTrainingGroupIds(supabase, athleteId);");
      expect(s, f).not.toContain('select("group_id").eq("profile_id", athleteId).eq("role", "athlete")');
    }
    const lib = src("lib/guardian-consent-server.ts");
    expect(lib).toContain('.eq("membership_type", "training")');
    expect(lib).toContain('.is("archived_at", null)');
  });

  it("the database answer for a coach has the same two conditions", () => {
    const m = src("supabase/migrations/0418_af3_database_policies.sql");
    const fn = m.slice(m.indexOf("create or replace function public.guardian_consent_state"));
    expect(fn).toContain("a.membership_type = 'training'");
    expect(fn).toContain("g.archived_at is null");
    expect(fn).toContain("public.is_group_coach(a.group_id)");
  });
});

describe("AF3: deleting an account", () => {
  it("the two links that blocked it are erased with the person, in the app list and in the database list", () => {
    const ts = src("lib/account-deletion.ts");
    expect(ts).toContain('["client_assessments", "created_by"],');
    expect(ts).toContain('["client_sub_goals", "proposed_by"],');
    const m = src("supabase/migrations/0418_af3_database_policies.sql");
    expect(m).toContain("('client_assessments', 'created_by', 'delete'),");
    expect(m).toContain("('client_sub_goals', 'proposed_by', 'delete'),");
  });
});

describe("AF3: private from the organization", () => {
  it("posts and tag assignments hide a private client from an organization owner or admin; the group's coach is unchanged", () => {
    const m = src("supabase/migrations/0418_af3_database_policies.sql");
    expect(m).toContain("public.is_org_admin_of_group(group_id) and not public.is_group_private_from_org(group_id) and not public.is_client_private_from_org(group_id, author_id)");
    expect(m).toContain("public.is_org_owner_or_admin(t.organization_id) and not public.athlete_private_from_org(client_tag_assignments.athlete_id, t.organization_id)");
    // the coach branch of the tag policy has no privacy condition
    expect(m).toContain("where c.profile_id = (select auth.uid()) and c.role = 'coach' and a.profile_id = client_tag_assignments.athlete_id");
  });
});

describe("AF3 (e): the write guard", () => {
  const rest = src("supabase/migrations/0417_minor_write_guard_rest.sql");
  const doc = src("docs/AF3E_MINOR_WRITE_DESIGN.md");
  const guarded = ["comments", "reactions", "direct_messages", "exercise_video_comments", "training_partner_profiles", "training_partner_requests", "challenge_participants", "progress_photos", "session_exercise_videos", "body_weight_logs", "body_scans", "transformation_cards", "transformation_milestones"];

  it("the rest-of-the-tables paste lists exactly the approved tables, and posts has its own paste", () => {
    const listed = Array.from(rest.matchAll(/'([a-z_]+)'/g)).map((m) => m[1]).filter((n) => n !== "authenticated");
    expect(new Set(listed)).toEqual(new Set(guarded));
    expect(src("supabase/migrations/0416_minor_write_guard_posts.sql")).toContain("on public.posts as restrictive for insert");
  });

  it("wellness check-ins, nutrition, training logs and safety actions are not guarded (Ron's and Commander's decisions)", () => {
    for (const n of ["wellness_checkins", "food_log_entries", "daily_macros", "meal_plans", "athlete_sessions", "set_logs", "support_messages", "user_blocks", "client_intake"]) {
      expect(rest, n).not.toContain(`'${n}'`);
    }
  });

  it("the design note names the same tables as the migrations", () => {
    for (const n of [...guarded, "posts"]) expect(doc, n).toContain("`" + n + "`");
  });

  it("only the insert and update are guarded, to signed-in people, restrictively; delete is left alone", () => {
    expect(rest).toContain("as restrictive for insert to authenticated");
    expect(rest).toContain("as restrictive for update to authenticated");
    expect(rest).not.toMatch(/for delete|for all/);
  });

  it("the function mirrors the page gate: unknown age is not an adult, a signed guardian is what lets a teen through", () => {
    const fn = src("supabase/migrations/0415_minor_may_write.sql");
    expect(fn).toContain("if v_intake_dob is null then\n    return false;");
    expect(fn).toContain("public.age_threshold_date(v_intake_dob, 13)");
    expect(fn).toContain("status = 'signed'");
    expect(fn).toContain("if v_has_coach or not v_has_athlete then\n    return true;");
  });
});
