import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Reads that asked the database for something it doesn't have; mocked tests could not see them (Nov 19 schema sweep).
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");

describe("Nov 19 schema sweep fixes", () => {
  it("bookings embed profiles through the athlete key (bookings has two keys to profiles, so a bare embed fails)", () => {
    for (const f of ["app/(coach)/groups/[groupId]/athletes/[athleteId]/calendar/[date]/page.tsx", "components/coach/desktop/day-schedule-panel.tsx"]) {
      const src = read(f);
      expect(src, f).toContain("profiles!bookings_athlete_id_fkey ( full_name )");
      expect(src, f).not.toMatch(/"[^"]*start_at[^"]*, profiles \( full_name \)"/);
    }
  });

  it("the team sheet's exercise read never filters on org_program (that table has no such column)", () => {
    const src = read("lib/team-sheet/load-sheet.ts");
    const exerciseRead = src.slice(src.indexOf('.from("group_workout_exercises")'), src.indexOf('.from("group_workout_exercises")') + 500);
    expect(exerciseRead).not.toContain('.eq("org_program"');
  });

  it("nothing reads or writes the removed group_memberships.kiosk_pin column", () => {
    for (const f of ["app/api/kiosk/checkin/route.ts", "lib/kiosk-pin-status.ts", "components/coach/desktop/kiosk-pin-manager.tsx"]) {
      // the column itself ("kiosk_pin", { kiosk_pin: }, .kiosk_pin), not the set_/verify_kiosk_pin functions, kiosk_pin_status or comments
      expect(read(f), f).not.toMatch(/"kiosk_pin"|[{,]\s*kiosk_pin:|\.kiosk_pin\b|"[^"\n]*\bkiosk_pin\b(?!_)[^"\n]*"/);
    }
  });
});

describe("kiosk PIN status that could not be read", () => {
  it("is null, never an empty map read as 'nobody has a PIN'", () => {
    expect(read("lib/kiosk-pin-status.ts")).toContain("if (error) return null;");
  });
  it("settings says the list failed; the kiosk lets them type the PIN and the server decides", () => {
    expect(read("app/(coach)/groups/[groupId]/kiosk/settings/page.tsx")).toContain("if (!pinStatus) rosterFailed = true;");
    expect(read("app/(coach)/groups/[groupId]/kiosk/page.tsx")).toContain("hasPin: pinStatus ? (pinStatus.get(m.profile_id as string) ?? false) : true,");
  });
});
