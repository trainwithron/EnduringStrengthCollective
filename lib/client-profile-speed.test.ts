import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");
const page = read("app/(coach)/groups/[groupId]/athletes/[athleteId]/page.tsx");

// The part of the page that fetches data, before the screen is built.
const dataPart = page.slice(0, page.indexOf("return (\n    <CoachDesktopShell"));

describe("the client profile loads its data in three waves, not one query after another", () => {
  it("every top-level wait that is left is a batch (Promise.all), the auth/params, or a retry after an error", () => {
    const lines = dataPart.split("\n").filter((l) => /^  (const|let) .*= await |^  await /.test(l) || /^  \] = await Promise\.all/.test(l));
    const serial = lines.filter((l) => !/Promise\.all/.test(l));
    // params, searchParams, server client, auth user - and nothing else at the top level.
    expect(serial.map((l) => l.trim())).toEqual([
      "const params = await props.params;",
      "const searchParamsResolved = await props.searchParams;",
      "const supabase = await createServerClient();",
    ]);
    expect((dataPart.match(/\] = await Promise\.all\(/g) ?? []).length).toBe(3);
  });
  it("the ledger, schedules, time zones, messages and movement patterns are in the first batch", () => {
    const wave1 = dataPart.slice(0, dataPart.indexOf("const profile = athleteMembership.profiles"));
    for (const needle of ["session_credit_ledger", "fetchBookingCounts(", "recurring_booking_series", "getGroupCoachTimezone(", "getViewerDisplayTimezone(", "direct_messages", "movement_patterns", "client_invites"]) {
      expect(wave1).toContain(needle);
    }
  });
  it("the retries only happen when the first select errored", () => {
    expect(dataPart).toContain("if (latestInviteResult.error)");
    expect(dataPart).toContain("if (seriesResult.error)");
  });
  it("a booking and a frozen-until read run together", () => {
    expect(dataPart).toContain("const [{ data: upcomingRows }, { data: frozenRows }] = await Promise.all([");
  });
  it("the slow parts stream in behind a Suspense so the rest of the profile shows first", () => {
    for (const name of ["ClientProgramsSection", "ClientNutrition", "ExerciseProgressionLoader", "ClientCalendarSection", "ClientMessagesSection"]) {
      const at = page.lastIndexOf(`<${name}`);
      expect(at).toBeGreaterThan(0);
      expect(page.slice(Math.max(0, at - 400), at)).toContain("<Suspense");
    }
  });
  it("the slow set_logs trend query is no longer part of the page's own waiting", () => {
    expect(page).not.toContain('.from("set_logs")');
    expect(read("components/coach/desktop/exercise-progression-loader.tsx")).toContain('.from("set_logs")');
  });
});
