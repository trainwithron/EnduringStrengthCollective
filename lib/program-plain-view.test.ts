import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { agoLabel, currentWeekFor, dayCardTitle, defaultWeek, exerciseCountLabel, exerciseLine, previewLine, programStats, weekIsComplete, type PlainDay, type PlainWeek } from "@/lib/program-plain-view";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const day = (id: string, dayIndex: number, over: Partial<PlainDay> = {}): PlainDay => ({ id, dayIndex, title: `Day ${dayIndex}`, dateLabel: null, isToday: false, lockedLabel: null, completedAt: null, exerciseCount: 0, exercises: [], totalSets: 0, ...over });

describe("plain program view helpers", () => {
  it("writes sets and reps, and seconds for timed work", () => {
    expect(exerciseLine([{ target_reps: "5", target_time_seconds: null }, { target_reps: "5", target_time_seconds: null }, { target_reps: "5", target_time_seconds: null }])).toBe("3 × 5");
    expect(exerciseLine([{ target_reps: null, target_time_seconds: 60 }])).toBe("1 × 60");
    expect(exerciseLine([])).toBe("");
  });
  it("opens on the week the start date puts today in, else Week 1, and any week is open", () => {
    const today = new Date("2026-10-20T12:00:00");
    expect(currentWeekFor({ startDate: "2026-08-17", weekNumbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], todayWeekFromSchedule: null, today })).toBe(10);
    expect(currentWeekFor({ startDate: "2026-08-17", weekNumbers: [1, 2, 3], todayWeekFromSchedule: null, today })).toBe(3);
    expect(currentWeekFor({ startDate: "2026-08-17", weekNumbers: [1, 2, 3], todayWeekFromSchedule: 2, today })).toBe(2);
    expect(currentWeekFor({ startDate: null, weekNumbers: [1, 2, 3], todayWeekFromSchedule: null, today })).toBeNull();
    const weeks: PlainWeek[] = [{ weekNumber: 1, days: [] }, { weekNumber: 2, days: [] }];
    expect(defaultWeek(weeks, null)).toBe(1);
    expect(defaultWeek(weeks, 2)).toBe(2);
  });
  it("names a day by its own name, or Week N Day M", () => {
    expect(dayCardTitle(1, day("a", 4))).toBe("Week 1 Day 4");
    expect(dayCardTitle(2, day("a", 3, { title: "Mobility" }))).toBe("Mobility");
  });
  it("previews the first exercises and counts them", () => {
    expect(previewLine([{ name: "Seated Hip CAR" }, { name: "Bodyweight Squat Holds" }, { name: "Back Squat" }, { name: "Dip" }])).toBe("Seated Hip CAR, Bodyweight Squat Holds, Back Squat");
    expect(exerciseCountLabel(1)).toBe("1 exercise");
    expect(exerciseCountLabel(8)).toBe("8 exercises");
  });
  it("stats: weeks, workouts, complete, percent; a week is complete when every day is", () => {
    const weeks: PlainWeek[] = [
      { weekNumber: 1, days: [day("a", 1, { completedAt: "2026-09-01T10:00:00Z" }), day("b", 2, { completedAt: "2026-09-02T10:00:00Z" })] },
      { weekNumber: 2, days: [day("c", 1, { completedAt: "2026-09-08T10:00:00Z" }), day("d", 2)] },
    ];
    expect(programStats(weeks)).toEqual({ weeks: 2, workouts: 4, complete: 3, percent: 75 });
    expect(weekIsComplete(weeks[0])).toBe(true);
    expect(weekIsComplete(weeks[1])).toBe(false);
  });
  it("says how long ago a day was done", () => {
    const now = new Date("2026-10-20T12:00:00Z");
    expect(agoLabel("2026-10-20T11:59:00Z", now)).toBe("just now");
    expect(agoLabel("2026-10-20T09:00:00Z", now)).toBe("about 3 hours ago");
    expect(agoLabel("2026-10-17T12:00:00Z", now)).toBe("3 days ago");
    expect(agoLabel("2026-09-15T12:00:00Z", now)).toBe("about 1 month ago");
  });
});

describe("a locked day", () => {
  it("sends no exercises to the browser, only how many there are and when it unlocks", () => {
    const server = read("components/shared/program-plain-view-server.tsx");
    expect(server).toContain("exercises: locked ? [] : exercises");
    expect(server).toContain("exerciseCount: exercises.length");
    expect(server).toContain("totalSets: locked ? 0 : totalSets");
    const picker = read("components/shared/program-day-picker.tsx");
    expect(picker).toContain("d.lockedLabel ??");
    expect(picker).toContain("{open.day.lockedLabel ? null :");
    expect(picker).toContain("{!open.day.lockedLabel && (");
  });
});

describe("the page", () => {
  const page = read("app/(coach)/groups/[groupId]/programs/[programId]/page.tsx");
  const picker = read("components/shared/program-day-picker.tsx");
  const creator = read("components/coach/create-and-open-program.tsx");
  it("opens the plain view on a phone and the builder with ?edit=1, never for desktop", () => {
    expect(page).toContain("!searchParams.edit && (await prefersAthleteStyleView())");
    expect(page).toContain("<ProgramPlainView");
  });
  it("Build / New program still open the builder", () => {
    expect(creator).toContain("?edit=1");
  });
  it("has the FitPros shape and the Edit program button for the coach only", () => {
    expect(picker).toContain("Weeks");
    expect(picker).toContain("Workouts");
    expect(picker).toContain("Complete");
    expect(picker).toContain("Total sets");
    expect(picker).toContain("Start Workout");
    expect(picker).toContain("Open this workout");
    expect(picker).toContain("Edit program");
    expect(picker).toContain("canEdit && editHref");
    expect(picker).toContain("This week");
  });
});
