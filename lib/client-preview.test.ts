import { describe, it, expect } from "vitest";
import { dayStatus, programProgress, progressLine, type ProgramDay } from "@/lib/client-preview-program";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");
const PAGE = "app/(coach)/groups/[groupId]/athletes/[athleteId]/view/page.tsx";

describe("View as client (desktop preview) is read only", () => {
  it("has no write code at all: no insert, update, upsert, delete or rpc in the data file or the page", () => {
    for (const rel of ["lib/client-preview-data.ts", "lib/client-preview-program.ts", PAGE, "components/coach/desktop/view-as-client-label.tsx"]) {
      const src = read(rel);
      expect(src, rel).not.toMatch(/\.(insert|update|upsert|delete|rpc)\(/);
      expect(src, rel).not.toMatch(/method:\s*["'](POST|PUT|PATCH|DELETE)["']/i);
      expect(src, rel).not.toContain("<form");
      expect(src, rel).not.toContain("createBrowserClient");
    }
  });
  it("never uses the act-as cookie, and the preview page is a server page with no client JS of its own", () => {
    const page = read(PAGE);
    expect(page).not.toContain("acting_as");
    expect(page).not.toContain("act-as");
    expect(page).not.toContain("getEffectiveAthlete");
    expect(page).not.toContain('"use client"');
    expect(read("lib/client-preview-data.ts")).not.toContain("cookies(");
  });
  it("checks that the viewer coaches this group and that the client is an athlete in it, before showing anything", () => {
    const page = read(PAGE);
    expect(page).toContain('viewer?.role !== "coach" || client?.role !== "athlete"');
    expect(page.indexOf('viewer?.role !== "coach"')).toBeLessThan(page.indexOf("loadHome("));
    expect(page).toContain("You can only view a client you coach.");
  });
  it("Change lists only clients in groups this coach coaches", () => {
    const page = read(PAGE);
    expect(page).toContain('.eq("profile_id", user.id).eq("role", "coach")');
    expect(page).toContain('.in("group_id", coachedIds).eq("role", "athlete")');
  });
  it("has the four screens, the slim bar with Change and Exit, and Open full profile (no logging on desktop)", () => {
    const page = read(PAGE);
    // the tabs mirror the client's own bar (Home, Calendar, Nutrition) plus History; there is no Programs tab
    for (const label of ["Home", "Calendar", "Nutrition", "History"]) expect(page).toContain(`label: "${label}"`);
    expect(page).not.toContain('label: "Programs"');
    expect(page).toContain("Viewing as");
    expect(page).toContain("Change");
    expect(page).toContain("Exit");
    expect(page).not.toContain("Log their workout");
    expect(page).toContain("Open full profile");
  });
  it("the entry points are on the client's profile and the client list, desktop only, and use the coach's own word for a client", () => {
    const profile = read("app/(coach)/groups/[groupId]/athletes/[athleteId]/page.tsx");
    expect(profile).toContain("<ViewAsClientLink href={`/groups/${params.groupId}/athletes/${params.athleteId}/view`} />");
    expect(profile).toContain("hidden lg:inline-flex");
    const list = read("components/coach/desktop/client-card-grid.tsx");
    expect(list).toContain("/view`}");
    expect(list).toContain("hidden lg:inline");
    expect(read("components/coach/desktop/view-as-client-label.tsx")).toContain('View as {term("client")}');
  });
  it("History marks coach-logged sessions", () => {
    expect(read(PAGE)).toContain('l.loggedByCoach ? " · Coach logged" : ""');
  });
});

const day = (id: string, week: number, done: boolean, date: Date | null = null): ProgramDay => ({ id, title: "Day " + id, weekNumber: week, date, done });

describe("the Home program card: where the client is in the program", () => {
  it("says the week and day of the next workout still to do", () => {
    const days = [day("1", 1, true), day("2", 1, true), day("3", 1, true), day("4", 2, true), day("5", 2, false), day("6", 2, false), day("7", 3, false)];
    const p = programProgress(days);
    expect(p.totalWeeks).toBe(3);
    expect(p.doneDays).toBe(4);
    expect(p.next).toMatchObject({ title: "Day 5", weekNumber: 2, dayInWeek: 2 });
    expect(progressLine(p)).toBe("Week 2 of 3 · Day 2");
  });
  it("a finished program, an empty program and a program not started", () => {
    expect(progressLine(programProgress([day("1", 1, true), day("2", 1, true)]))).toBe("Finished");
    expect(progressLine(programProgress([]))).toBe("No workouts yet");
    expect(progressLine(programProgress([day("1", 1, false), day("2", 1, false)]))).toBe("Week 1 of 1 · Day 1");
  });
  it("a day is done, available now, or locked until its date (by the program's unlock window)", () => {
    const today = new Date("2026-10-11T12:00:00");
    expect(dayStatus(day("1", 1, true), today, "day")).toBe("done");
    expect(dayStatus(day("2", 1, false), today, "day")).toBe("available");
    expect(dayStatus(day("3", 1, false, new Date("2026-10-11T00:00:00")), today, "day")).toBe("available");
    expect(dayStatus(day("4", 1, false, new Date("2026-10-15T00:00:00")), today, "day")).toBe("locked");
    expect(dayStatus(day("5", 1, false, new Date("2026-10-15T00:00:00")), today, "week")).toBe("available");
  });
});

describe("the preview's new tabs and empty states", () => {
  const page = read(PAGE);
  it("Home has a Your program card that opens the whole program, read only, replacing the Programs tab", () => {
    expect(page).toContain("Your program");
    expect(page).toContain("See the whole program");
    expect(page).toContain("Back to Home");
    expect(page).toContain('"Back to Home"'.replace(/"/g, "") === "Back to Home" ? "Back to Home" : "Back to Home");
  });
  it("every tab shows a plain line when there is nothing, and when a read fails", () => {
    for (const line of ["Nothing assigned yet", "No workouts yet", "Nothing scheduled", "No nutrition set up yet", "Couldn't load this right now"]) expect(page).toContain(line);
    expect(page).toContain("safely(");
  });
  it("Nutrition is read only: targets and what was logged, no AI call, no food rules or allergy data, no meal text", () => {
    const data = read("lib/client-preview-data.ts");
    const nutrition = data.slice(data.indexOf("export async function loadNutrition"));
    expect(nutrition).not.toMatch(/anthropic|ai-|generate|client_nutrition_preferences|allerg|recipe/i);
    expect(nutrition).toContain("resolveDayMacros(");
    expect(nutrition).toContain("fetchFoodLogDay(");
    expect(page).not.toContain("meals");
  });
});
