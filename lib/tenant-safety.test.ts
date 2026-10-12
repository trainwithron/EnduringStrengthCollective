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

describe("private lookups and forged post links", () => {
  it("a post can only show a workout log of its own author, in its own group", () => {
    const src = read("lib/shared-workout-source.ts");
    expect(src).toContain("linked.athlete_id === (post as any).author_id && linked.group_id === (post as any).group_id");
    expect(src).toContain("workout_logs ( athlete_id, group_id,");
  });
  it("the lookup functions answer only for the people concerned, and the two coach-count functions are closed", () => {
    const sql = read("supabase/migrations/0342_close_lookup_oracles.sql");
    expect(sql).toContain("coalesce(auth.role(), '') <> 'authenticated' or auth.uid() = a or auth.uid() = b");
    expect(sql).toContain("revoke execute on function public.coach_ai_multiplier(uuid) from public, anon, authenticated;");
    expect(sql).toContain("revoke execute on function public.coach_client_steps(uuid) from public, anon, authenticated;");
  });
});

describe("a page that shows one program for a client resolves it for the CLIENT", () => {
  it("the client's Calendar tab reads all their active programs, so two active programs no longer blank it", () => {
    const body = read("components/coach/calendar-page-body.tsx");
    expect(body).toContain("await getActivePrograms(supabase, params.groupId, athleteId)");
    expect(body).toContain("scheduledPrograms.find((p) => p.athleteId === athleteId) ?? scheduledPrograms[0]");
  });
  it("the coach pages for one client use that client's program, never the newest of the group", () => {
    for (const f of [
      "app/(coach)/groups/[groupId]/athletes/[athleteId]/log/page.tsx",
      "components/coach/desktop/client-calendar-section.tsx",
      "app/(coach)/groups/[groupId]/athletes/[athleteId]/calendar/[date]/page.tsx",
      "lib/nutrition-block-adjustment-gather.ts",
    ]) {
      expect(read(f)).toContain("getAthleteCurrentProgram(");
    }
  });
  it("a workout made for one client is not opened for another", () => {
    expect(read("lib/workout-overview-data.ts")).toContain("if (workout.athlete_id && workout.athlete_id !== athleteId) return null;");
  });
});

describe("recap and notes", () => {
  it("a coach's private note is never pre-filled into the note the athlete sees; it is shown as read-only help with an explicit button", () => {
    const row = read("components/coach/desktop/next-workout-exercise-row.tsx");
    expect(row).toContain('useState(exercise.notes ?? "")');
    expect(row).not.toContain("exercise.notes ?? carriedForwardNote?.body");
    expect(row).toContain("if (override === undefined && !noteTouched) return;");
    expect(row).toContain("Note for this exercise (the athlete sees it)");
    expect(row).toContain("Your private note from");
    expect(row).toContain("Use it as the note the athlete sees");
  });
  it("Up next follows the finished session's own program, and a group-shared program is read-only there", () => {
    const page = read("app/sessions/[sessionId]/recap/page.tsx");
    expect(page).toContain("const program = sessionProgram ?? personalProgram ?? sharedProgram;");
    expect(page).toContain("programIsShared={programIsShared}");
    const view = read("components/coach/desktop/recap-and-up-next.tsx");
    expect(view).toContain("readOnly={programIsShared}");
    expect(view).toContain("so it can't be changed here for just");
  });
  it("assigning from the builder of an AI draft signs it off first, like the program cards", () => {
    expect(read("components/coach/desktop/program-builder-desktop.tsx")).toContain("aiDraft={aiDraft}");
    expect(read("app/(coach)/groups/[groupId]/programs/[programId]/page.tsx")).toContain("aiDraft={isAiDraft}");
  });
});

describe("calendars use the business time zone for today and for the reschedule day", () => {
  it("the phone and client calendars no longer read the server's UTC clock", () => {
    const body = read("components/coach/calendar-page-body.tsx");
    expect(body).toContain("const generalToday = dateFromKey(dateKeyInZone(coachTz));");
    expect(body).toContain("const today = dateFromKey(dateKeyInZone(displayTz));");
    expect(body).toContain("${basePath}/${dateKeyInZone(displayTz, start)}?reschedule=${b.id}");
    expect(read("app/(coach)/groups/[groupId]/programs/[programId]/calendar/page.tsx")).toContain("dateKeyInZone(timezone, start)");
  });
});
