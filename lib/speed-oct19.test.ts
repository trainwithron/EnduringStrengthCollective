import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// SPEED (Ron, Oct 19: "the app's been loading a little slow"). Measured live: /programs 4.5-5.0 s, /dashboard 2.6-3.0 s, /my-space?view=client 3.2 s. These pin the code fixes (no database change).
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

describe("1-3 /programs", () => {
  const page = read("app/(coach)/programs/page.tsx");
  it("reads the list, the removed programs, the slots, the copies and the phone check in ONE batch", () => {
    expect(page).toContain("const [{ data: programsUnsorted, error: programsError }, { data: hiddenRows }, { data: slotRows }, { data: copyRows }, onPhone] = await Promise.all([");
    // nothing reads one thing after another before the batch
    const before = page.slice(page.indexOf("const groupIds = inOrg.map"), page.indexOf("] = await Promise.all(["));
    // (the sweep's client is made from the request's cookies there: no database read)
    const waits = before.split(String.fromCharCode(10)).filter((l) => /= await /.test(l) && !l.includes("createSnapshotServerClient()") && !l.includes("const removed = await sweepEmptyPrograms"));
    expect(waits).toEqual([]);
  });
  it("counts copies by group (no list of program ids in the address)", () => {
    expect(page).toContain('supabase.from("programs").select("id, source_program_id").in("group_id", g)');
    expect(page).not.toContain("countAssignedTo(");
  });
  it("the empty-program sweep (it deletes) runs after the page is sent", () => {
    expect(page).toContain("const removed = await sweepEmptyPrograms(sweepClient, user.id, groupIds);");
    expect(page).toContain("const sweepClient = await createSnapshotServerClient();");
    expect(page).toContain("after(async () => {");
    expect(page).not.toContain("await sweepEmptyPrograms(supabase");
  });
  it("the page finishes with the list; the browser asks for the charts after it has shown (measured live: streaming them kept the tab loading 5 more seconds)", () => {
    expect(page).not.toContain("<Suspense");
    expect(page).not.toContain("computeProgramCardVisuals");
    expect(page).toContain("chartProgramIds={uncoveredProgramIds}");
    const route = read("app/api/coach/program-charts/route.ts");
    expect(route).toContain("const MAX_CHART_PROGRAMS = 12;");
    expect(route).toContain(".filter((id) => UUID.test(id))");
    expect(route).toContain('if (!user) return NextResponse.json({ error: "Sign in again." }, { status: 401 });');
    expect(route).toContain("computeProgramCardVisuals(supabase, ids, user.id)");
    const hook = read("components/coach/desktop/program-charts-loader.tsx");
    expect(hook).toContain("fetch(`/api/coach/program-charts?ids=${encodeURIComponent(key)}`");
    expect(read("components/coach/desktop/program-card-grid.tsx")).toContain("const fetchedVisuals = useProgramCharts(chartProgramIds);");
  });
  it("the charts read every row (a bare in() stopped at 1,000 rows without a word)", () => {
    const data = read("lib/program-card-data.ts");
    for (const table of ["workouts", "group_workout_exercises", "workout_logs", "exercise_library", "group_workout_exercise_sets", "set_logs"]) {
      expect(data, table).toMatch(new RegExp(`readRowsByIds\\([^]*?from\\("${table}"\\)`));
    }
    expect(data.match(/\.order\("id"\)\.range\(from, to\)|\.order\("id"\)\n\s+\.range\(from, to\)/g)?.length).toBeGreaterThanOrEqual(6);
  });
});

describe("4 /dashboard", () => {
  const page = read("app/(coach)/dashboard/page.tsx");
  it("reads the coach's seats once (the cached read round 1 uses)", () => {
    expect(page).not.toContain("coachedGroupRows");
    expect(page).toContain("const coachedTop = await getCoachedGroups(supabase, user.id);");
  });
  it("one profile read and one coach-profile read, each with a fallback", () => {
    // the coach's own profile row: the one read and its fallback (the other profile read is clients' names)
    expect(page.match(/from\("profiles"\)\.select\([^)]*\)\.eq\("id", user!\.id\)/g)?.length).toBe(2);
    expect(page.match(/from\("coach_profiles"\)/g)?.length).toBe(2);
    expect(page).toContain("const isTeamCoach = coachType === \"team\";");
  });
  it("the departures join round 1 and the team tiles' modes join round 2", () => {
    const round1 = page.slice(page.indexOf("// Round 1:"), page.indexOf("// Round 2:"));
    expect(round1).toContain("loadMyDepartures(supabase, user.id),");
    const round2 = page.slice(page.indexOf("// Round 2:"), page.indexOf("// Round 3:"));
    expect(round2).toContain('supabase.from("groups").select("id, team_mode").in("id", tileCandidates.map((g) => g.id).slice(0, 100))');
    expect(page).not.toContain("const departures = await loadMyDepartures");
  });
  it("the session cards and the next-client button stream in on their own; the comment read covers the last 30 days", () => {
    expect(page).toContain("<Suspense fallback={null}>\n        <SessionCheckSection");
    expect(page).toContain("<Suspense fallback={null}>\n        <NextClientWorkoutSection");
    expect(page).toContain('.gte("created_at", new Date(Date.now() - 30 * 86400000).toISOString())');
  });
});

describe("5 root layout", () => {
  it("the remembered group is read once for the colors and the team words, and the theme is cached per request", () => {
    expect(read("lib/workspace-group-row.ts")).toContain("export const getWorkspaceGroupRow = cache(");
    expect(read("lib/org-theme-server.ts")).toContain("export const getViewerOrgTheme = cache(readViewerOrgTheme);");
    expect(read("lib/org-theme-server.ts")).toContain("getWorkspaceGroupRow()");
    expect(read("lib/team-words-server.ts")).toContain("getWorkspaceGroupRow()");
    expect(read("lib/team-words-server.ts")).not.toContain('.select("organization_id, team_mode")');
  });
});

describe("6 /my-space?view=client", () => {
  it("goes straight to the client app with the same cookies (one hop, not three)", () => {
    const route = read("app/my-space/route.ts");
    expect(route).not.toContain("/my-training/open?group=");
    // the one-hop open lives in lib/open-own-space.ts (phone speed B7)
    expect(read("lib/open-own-space.ts")).toContain("setMyTrainingCookies(");
    expect(route).toContain("openOwnSpaceRedirect(");
    expect(read("app/my-training/open/route.ts")).toContain("setMyTrainingCookies(");
  });
});

describe("the Programs charts finish quickly (measured live: charts for every card kept the page loading 10 to 12 seconds)", () => {
  it("only the first 12 cards without a cover get a chart; the rest show the plain card", () => {
    const page = read("app/(coach)/programs/page.tsx");
    expect(page).toContain("const CHARTED_CARDS = 12;");
    expect(page).toContain("const uncoveredProgramIds = cards.filter((c) => !c.coverImagePath).slice(0, CHARTED_CARDS).map((c) => c.id);");
  });
});
