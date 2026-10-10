import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { panelProgramLabel } from "@/lib/program-panel";
import { programLabel } from "@/lib/assign-picker";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");

describe("a one-on-one space has no shared program (Release AJ)", () => {
  it("a no-client program in a client's own space is labelled 'Not assigned to anyone', never Shared and never 'group'", () => {
    expect(panelProgramLabel({ clientName: null, isActive: true, aiDraft: false, groupKind: "one_on_one" })).toBe("Not assigned to anyone");
    expect(panelProgramLabel({ clientName: null, isActive: false, aiDraft: false, groupKind: "one_on_one" })).toBe("Not assigned to anyone · not active");
    expect(programLabel({ aiDraft: false, clientName: null, uses: 0, groupKind: "one_on_one" })).toBe("Not assigned to anyone");
    // a team group is unchanged
    expect(panelProgramLabel({ clientName: null, isActive: true, aiDraft: false, groupKind: "team" })).toBe("Shared");
    expect(programLabel({ aiDraft: false, clientName: null, uses: 0, groupKind: "team" })).toBe("Shared");
  });
  it("the client's Programs tab does not show a no-client program as shared with the group in a one-on-one space", () => {
    const section = read("components/coach/desktop/client-programs-section.tsx");
    expect(section).toContain('=== "one_on_one"');
    expect(section).toContain("oneOnOne");
    expect(section).toMatch(/oneOnOne\s*\n?\s*\?\s*\{ data: null \}/);
  });
  it("every place that picks 'the program a client follows' ignores no-client programs in a one-on-one space", () => {
    expect(read("lib/active-programs.ts")).toContain(".filter((r) => !oneOnOne || r.athlete_id !== null)");
    expect(read("app/(coach)/groups/[groupId]/page.tsx")).toContain('group_kind?: string } | null)?.group_kind !== "one_on_one" || p.athlete_id !== null');
    expect(read("components/coach/calendar-page-body.tsx")).toContain('(kindRow as { group_kind?: string } | null)?.group_kind === "one_on_one" ? null : sharedProgramRaw');
    expect(read("app/(coach)/groups/[groupId]/athletes/[athleteId]/page.tsx")).toContain('group?.group_kind === "one_on_one" ? null : sharedProgramRaw');
    expect(read("lib/needs-attention-data.ts")).toContain('programQuery.not("athlete_id", "is", null)');
    expect(read("lib/dashboard-data.ts")).toContain("else if (!oneOnOneGroupIds.has(p.group_id))");
    expect(read("app/api/assistant/navigate/route.ts")).toContain("r.athlete_id !== null || !oneOnOneIds.has(r.group_id)");
  });
  it("the database rule (migration 0332) hides them from a client, for programs, workouts, exercises and sets, and leaves coaches and team groups alone", () => {
    const sql = read("supabase/migrations/0332_one_on_one_private_programs.sql");
    expect(sql).toContain("p.athlete_id is null and public.is_one_on_one_group(p.group_id)");
    expect(sql).toContain("athlete_id is not null or not public.is_one_on_one_group(group_id)");
    expect(sql).toContain("is_group_coach(group_id) or (not ai_draft and archived_at is null");
    expect(sql).not.toMatch(/delete from|update public\.programs/);
  });
});

describe("a one-on-one space stays a one-on-one space (Release AK)", () => {
  it("the database fills in or refuses a no-client program, refuses group-only features, and keeps the space's kind (migration 0333)", () => {
    const sql = read("supabase/migrations/0333_one_on_one_separation.sql");
    expect(sql).toContain("new.athlete_id := public.one_on_one_athlete(new.group_id)");
    expect(sql).toContain("before insert or update of group_id, athlete_id on public.programs");
    for (const table of ["group_invites", "team_games", "team_practice_schedules", "group_stat_fields"]) {
      expect(sql).toContain(`before insert on public.${table}`);
    }
    expect(sql).toContain("before insert on public.group_sessions");
    expect(sql).toContain("old.group_kind = 'one_on_one'");
    expect(sql).toContain("A one-on-one space holds one client, and this one already has theirs.");
    // existing no-client programs are never touched by the migration (move_client_to_group still moves a client's own programs with them)
    expect(sql).not.toMatch(/delete from public.programs|update public.programs set athlete_id/);
  });
  it("events and invite links are refused for a one-on-one space with plain messages", () => {
    const events = read("app/api/group-events/route.ts");
    expect(events).toContain('group_kind === "one_on_one"');
    expect(events).toContain("Events are for groups. Book a session with this client instead.");
    const invites = read("app/api/invites/group/route.ts");
    expect(invites).toContain('group_kind === "one_on_one"');
    expect(invites).toContain("This is one client's own space, so it has no invite link.");
  });
  it("a new program page fills in the space's one client, and the feed-sharing control is not shown in a one-on-one space", () => {
    const page = read("app/(coach)/groups/[groupId]/programs/new/page.tsx");
    expect(page).toContain('group_kind === "one_on_one"');
    expect(page).toContain("soleAthletes?.length === 1");
    const settings = read("app/(coach)/groups/[groupId]/settings/page.tsx");
    expect(settings).toContain('(group as { group_kind?: string } | null)?.group_kind !== "one_on_one" && (');
  });
  it("what a one-on-one client reads about their own program never says group", () => {
    for (const text of [
      panelProgramLabel({ clientName: null, isActive: true, aiDraft: false, groupKind: "one_on_one" }),
      panelProgramLabel({ clientName: null, isActive: false, aiDraft: false, groupKind: "one_on_one" }),
      programLabel({ aiDraft: false, clientName: null, uses: 0, groupKind: "one_on_one" }),
    ]) {
      expect(text.toLowerCase()).not.toContain("group");
    }
  });
});
