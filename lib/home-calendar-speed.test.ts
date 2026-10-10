import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");

// Top-level waits (two-space indent) in the data-gathering part of a page: batches count as one.
function topLevelWaits(src: string): string[] {
  return src.split("\n").filter((l) => /^  (const|let) .*= await |^  await |^  \] = await /.test(l)).map((l) => l.trim());
}

describe("Home loads in rounds, not one read after another", () => {
  const page = read("app/(coach)/dashboard/page.tsx");
  const data = page.slice(0, page.indexOf("const yourDaySchedule"));
  it("the only waits left at the top level are the gates, the three batches, and the one that needs the organizations", () => {
    const waits = topLevelWaits(data);
    const isBatch = (w: string) => w.endsWith("= await Promise.all([");
    const batches = waits.filter(isBatch);
    expect(batches.length).toBe(3);
    const singles = waits.filter((w) => !isBatch(w));
    expect(singles.map((w) => w.split(/\s+/).join(" "))).toEqual([
      "const supabase = await createServerClient();",
      "const { data: coachedGroupRows } = await supabase",
      "const stuckInDesktopModeOnRealPhone = await isMobileUserAgent();",
    ]);
    // The cookie read is not a database wait, and the per-organization client counts are the one read that needs the coached groups from round 1.
    expect(data).toContain("await clientCountsByOrg(supabase, coachedForOrg)");
  });
  it("the last round holds every chain that only needs the group list", () => {
    const at = data.indexOf("const [dashboardData, unseenByGroup, memberCountByGroup, needsReplyThreads, soloRows, todaysClasses, lowReadiness] = await Promise.all([");
    expect(at).toBeGreaterThan(0);
    const round = data.slice(at);
    for (const needle of ["getCoachDashboardData(", "loadUnseenByGroup()", "loadMemberCounts()", "loadNeedsReplyThreads()", "loadSoloClientRows()", "loadTodaysClasses()", "loadLowReadiness()"]) {
      expect(round).toContain(needle);
    }
  });
  it("the Needs you strip loads behind a Suspense in its own component", () => {
    expect(page).toContain("<Suspense fallback={<NeedsYouLoading />}>");
    expect(page).toContain("<NeedsYouLoader input={needsYouInput} />");
    expect(page).not.toContain("await loadNeedsYouItems(");
    expect(read("components/coach/desktop/needs-you-loader.tsx")).toContain("await loadNeedsYouItems(supabase, input)");
  });
  it("the dashboard data reads inactive clients, owed sessions and habit check-offs in its first batch, and takes the coach's time zone from the page", () => {
    const d = read("lib/dashboard-data.ts");
    const batch = d.slice(d.indexOf("] = await Promise.all(["), d.indexOf("// Most recent completed-workout date per athlete"));
    for (const needle of ["fetchInactiveKeys(supabase, allGroupIds)", 'from("session_credits")', 'from("habit_logs")']) expect(batch).toContain(needle);
    expect(d).not.toContain("await fetchInactiveKeys(");
    expect(d).toContain("params.coachProfileTimezone !== undefined");
  });
});

describe("the coach calendar loads in four rounds", () => {
  const body = read("components/coach/calendar-page-body.tsx");
  const coachPart = body.slice(body.indexOf("// The group and the coach's time zone do not depend on each other: one round."));
  it("the group and the time zone are read together, then the main batch, then two more batches", () => {
    expect((coachPart.match(/\] = await Promise\.all\(/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(coachPart).toContain("const [{ data: group }, { data: earlyTzRow }] = await Promise.all([");
  });
  it("the client list, spotters, session types, ledger of attended sessions and program workouts are no longer waited for one by one", () => {
    for (const gone of [
      "const coachClients = await getCoachClients(",
      "const bookingCounts = await fetchBookingCounts(",
      "const calendarSpotterFindings = await gatherCalendarSpotterFindings(",
      "const schedulingSpotterFlags = await gatherSchedulingSpotterFlags(",
      "const sessionIndex = await fetchSessionMinutes(",
      "const typedBookings = await pageAll(",
      "const attendedSessions = await pageAll(",
      "const setAsideKeySet = await fetchInactiveKeys(",
      "const { data: typeRows } = await supabase",
    ]) {
      expect(coachPart).not.toContain(gone);
    }
  });
  it("what depends on the client list (balances, who is set aside, memberships) is one batch", () => {
    expect(coachPart).toContain("const [creditBatches, setAsideKeySet, membershipBatches] = await Promise.all([");
  });
});
