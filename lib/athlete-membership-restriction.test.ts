import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

describe("Release X2: athletes stop reading other athletes' membership rows", () => {
  const sql = src("supabase/migrations/0406_group_memberships_athlete_narrow.sql");

  it("is one RESTRICTIVE read rule, so it can only take access away, and it leaves inserting, updating and deleting alone", () => {
    expect(sql).toContain("as restrictive for select to authenticated");
    expect(sql.match(/create policy/g)!.length).toBe(1);
    expect(sql).not.toMatch(/for (insert|update|delete|all)/);
  });

  it("keeps a row readable for the person it belongs to, a coach's own row, a coach of the group and an organization admin of the group", () => {
    expect(sql).toContain("profile_id = (select auth.uid())");
    expect(sql).toContain("or role = 'coach'");
    expect(sql).toContain("or public.is_group_coach(group_id)");
    expect(sql).toContain("or public.is_org_admin_of_group(group_id)");
  });

  it("the paste warns that it changes access and must come after step 156 and the X1 code, and refuses to run without step 156", () => {
    const build = src("scripts/build-paste-files.mjs");
    expect(build).toContain("Apply it ONLY AFTER step 156 is applied AND the Release X1 code is live");
    expect(build).toContain("to_regprocedure('public.group_member_names(uuid)') is not null and to_regprocedure('public.group_position_roster(uuid)') is not null");
  });

  it("the paste that Ron runs (the bundle, not just the build script) refuses to run without step 156", () => {
    const bundle = src("supabase/apply/apply-release-x2-athlete-narrow-memberships-all.sql");
    expect(bundle).toContain("to_regprocedure('public.group_member_names(uuid)') is not null and to_regprocedure('public.group_position_roster(uuid)') is not null");
    expect(bundle).toContain("RIGHT AFTER APPLYING, CHECK AS AN ATHLETE");
  });

  it("the group's 'N members' line is counted by the database, with the old count as the fallback", () => {
    expect(sql).toContain("create or replace function public.group_member_count(p_group uuid)");
    const page = src("app/(coach)/groups/[groupId]/page.tsx");
    expect(page).toContain("memberCount={memberCount}");
    expect(page).toContain("readGroupMemberCount(supabase, params.groupId, (memberships ?? []).length)");
    expect(page).not.toContain("memberCount={roster.length}");
    expect(src("lib/group-roster-reads.ts")).toContain("if (error || typeof data !== \"number\") return fallback;");
  });

  it("the athlete screens that list the group's people are already on the narrow reads (Release X1), not on the table", () => {
    // These are the athlete-facing places that read other athletes' membership rows; each now asks the narrow functions.
    for (const [file, call] of [
      ["lib/use-mention-autocomplete.ts", "readGroupMemberNames("],
      ["components/feed/inline-comment-section.tsx", "readGroupMemberNames("],
      ["lib/leaderboard-data.ts", "readPositionRoster("],
      ["app/(coach)/groups/[groupId]/team/calendar/games/[gameId]/page.tsx", "readPositionRoster("],
    ] as const) {
      expect(src(file), file).toContain(call);
    }
  });
});
