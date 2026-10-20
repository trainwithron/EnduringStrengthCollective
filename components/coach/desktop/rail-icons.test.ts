import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const shell = readFileSync(join(__dirname, "..", "coach-desktop-shell.tsx"), "utf8").replace(/\r\n/g, "\n");

// FIX 6: the rail is the six homes; each has its own icon, and the look-alikes stay apart.
describe("the rail icons", () => {
  it("one icon per home: Home, a single person for Clients (a group of people for a team-sport group's Athletes), a calendar, a dumbbell for Programs, mail, a gear", () => {
    expect(shell).toContain("const HOME_ICON: Record<HomeKey, RailIcon[\"icon\"]> = { home: Home, clients: teamSport ? Users2 : UserRound, calendar: CalendarDays, programs: Dumbbell, messages: Mail, settings: Settings };");
  });
  it("the dumbbell is only Programs, and the grid icon is gone", () => {
    expect(shell.match(/\bDumbbell\b/g)?.length).toBe(2); // the import and the Programs icon
    expect(shell).not.toMatch(/\bLayoutGrid\b/);
  });
  it("the hover labels stay", () => {
    expect(readFileSync(join(__dirname, "shell-rail.tsx"), "utf8")).toContain("aria-label={item.label}");
  });
});
