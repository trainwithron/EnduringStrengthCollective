import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isBrandNewProgram, isRemovableEmptyDay, isRemovableEmptyProgram, isRestDayTitle, type EmptyDayRow, type EmptyProgramRow } from "@/lib/empty-sweep";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const now = new Date("2026-10-20T12:00:00Z");
const day = (over: Partial<EmptyDayRow> = {}): EmptyDayRow => ({ id: "d", title: "Day 3", scheduledDate: null, createdAt: "2026-10-17T10:00:00Z", exercises: 0, notes: 0, sessions: 0, logs: 0, assignments: 0, ...over });
const program = (over: Partial<EmptyProgramRow> = {}): EmptyProgramRow => ({ id: "p", ownerId: "ron", updatedAt: "2026-10-18T10:00:00Z", workoutsWithExercises: 0, sessions: 0, copies: 0, ...over });

describe("an empty day is removed unless it is a rest day or something points at it", () => {
  it("removes a plain empty day", () => {
    expect(isRemovableEmptyDay(day())).toBe(true);
  });
  it("keeps a rest day, a day with exercises, and a day with a log, session, note or scheduled date", () => {
    expect(isRemovableEmptyDay(day({ title: "Rest day" }))).toBe(false);
    expect(isRemovableEmptyDay(day({ title: "rest" }))).toBe(false);
    expect(isRemovableEmptyDay(day({ exercises: 1 }))).toBe(false);
    expect(isRemovableEmptyDay(day({ logs: 1 }))).toBe(false);
    expect(isRemovableEmptyDay(day({ sessions: 2 }))).toBe(false);
    expect(isRemovableEmptyDay(day({ notes: 1 }))).toBe(false);
    expect(isRemovableEmptyDay(day({ assignments: 1 }))).toBe(false);
    expect(isRemovableEmptyDay(day({ scheduledDate: "2026-10-21" }))).toBe(false);
  });
  it("has no grace period: an empty day made a minute ago goes too (Ron: it is too easy to add one back)", () => {
    expect(isRemovableEmptyDay(day({ createdAt: "2026-10-20T11:59:00Z" }))).toBe(true);
    expect(isRemovableEmptyDay(day({ createdAt: "2026-10-19T11:00:00Z" }))).toBe(true);
  });
  it("a program made in the last 10 minutes is still being set up, so its first open sweeps nothing; an older one does", () => {
    expect(isBrandNewProgram("2026-10-20T11:55:00Z", now)).toBe(true);
    expect(isBrandNewProgram("2026-10-20T11:49:00Z", now)).toBe(false);
    expect(isBrandNewProgram(null, now)).toBe(false);
  });
  it("knows a rest day by its name", () => {
    expect(isRestDayTitle("Rest day")).toBe(true);
    expect(isRestDayTitle("  REST ")).toBe(true);
    expect(isRestDayTitle("Restorative mobility")).toBe(false);
    expect(isRestDayTitle("Day 2")).toBe(false);
  });
});

describe("an empty program is removed quietly, only his own, only when nothing is in it", () => {
  it("removes an idle, empty, uncopied program of the owner", () => {
    expect(isRemovableEmptyProgram(program(), "ron", now)).toBe(true);
  });
  it("keeps one that has exercises, sessions or copies, was touched in the last 24 hours, or is someone else's", () => {
    expect(isRemovableEmptyProgram(program({ workoutsWithExercises: 1 }), "ron", now)).toBe(false);
    expect(isRemovableEmptyProgram(program({ sessions: 1 }), "ron", now)).toBe(false);
    expect(isRemovableEmptyProgram(program({ copies: 1 }), "ron", now)).toBe(false);
    expect(isRemovableEmptyProgram(program({ updatedAt: "2026-10-20T01:00:00Z" }), "ron", now)).toBe(false);
    expect(isRemovableEmptyProgram(program({ ownerId: "someone" }), "ron", now)).toBe(false);
  });
});

describe("wiring", () => {
  it("the builder offers to remove empty days with a button (never behind the coach's back), and Programs sweeps the owner's empty programs", () => {
    expect(read("app/(coach)/groups/[groupId]/programs/[programId]/page.tsx")).not.toContain("sweepEmptyDays");
    const builder = read("components/coach/desktop/program-builder-desktop.tsx");
    expect(builder).toContain("/api/programs/sweep-empty-days");
    expect(builder).toContain("explicit: true");
    expect(builder).toContain("const emptyDayIds = days.filter((d) => d.items.length === 0 && !isRestDayTitle(d.title))");
    expect(builder).not.toContain("initialDays.filter((d) => d.items.length === 0");
    const api = read("app/api/programs/sweep-empty-days/route.ts");
    expect(api).toContain("isBrandNewProgram");
    expect(api).toContain("sweepEmptyDays(supabase, programId, dayIds)");
    expect(read("app/(coach)/programs/page.tsx")).toContain("await sweepEmptyPrograms(sweepClient, user.id, groupIds)");
    const sweep = read("lib/empty-sweep.ts");
    expect(sweep).toContain(".eq(\"created_by\", viewerId)");
    expect(sweep).toContain("workout_logs(count)");
  });
  it("a day named Rest day is shown plainly (there is no one-tap button: naming it by hand works)", () => {
    const card = read("components/coach/desktop/day-card.tsx");
    expect(card).not.toContain("Make this a rest day");
    expect(card).toContain("isRestDayTitle(day.title)");
    expect(card).toContain("Rest day");
  });
});
