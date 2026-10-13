import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isRemovableEmptyDay, isRemovableEmptyProgram, isRestDayTitle, type EmptyDayRow, type EmptyProgramRow } from "@/lib/empty-sweep";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const now = new Date("2026-10-20T12:00:00Z");
const day = (over: Partial<EmptyDayRow> = {}): EmptyDayRow => ({ id: "d", title: "Day 3", scheduledDate: null, createdAt: "2026-10-17T10:00:00Z", exercises: 0, notes: 0, sessions: 0, logs: 0, assignments: 0, ...over });
const program = (over: Partial<EmptyProgramRow> = {}): EmptyProgramRow => ({ id: "p", ownerId: "ron", updatedAt: "2026-10-18T10:00:00Z", workoutsWithExercises: 0, sessions: 0, copies: 0, ...over });

describe("an empty day is removed unless it is a rest day or something points at it", () => {
  it("removes a plain empty day", () => {
    expect(isRemovableEmptyDay(day(), now)).toBe(true);
  });
  it("keeps a rest day, a day with exercises, and a day with a log, session, note or scheduled date", () => {
    expect(isRemovableEmptyDay(day({ title: "Rest day" }), now)).toBe(false);
    expect(isRemovableEmptyDay(day({ title: "rest" }), now)).toBe(false);
    expect(isRemovableEmptyDay(day({ exercises: 1 }), now)).toBe(false);
    expect(isRemovableEmptyDay(day({ logs: 1 }), now)).toBe(false);
    expect(isRemovableEmptyDay(day({ sessions: 2 }), now)).toBe(false);
    expect(isRemovableEmptyDay(day({ notes: 1 }), now)).toBe(false);
    expect(isRemovableEmptyDay(day({ assignments: 1 }), now)).toBe(false);
    expect(isRemovableEmptyDay(day({ scheduledDate: "2026-10-21" }), now)).toBe(false);
  });
  it("never removes a day made in the last 24 hours (he may be setting it up to fill in later)", () => {
    expect(isRemovableEmptyDay(day({ createdAt: "2026-10-20T11:55:00Z" }), now)).toBe(false);
    expect(isRemovableEmptyDay(day({ createdAt: "2026-10-19T13:00:00Z" }), now)).toBe(false);
    expect(isRemovableEmptyDay(day({ createdAt: "2026-10-19T11:00:00Z" }), now)).toBe(true);
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
  it("the builder sweeps its own program's empty days when opened, and Programs sweeps the owner's empty programs", () => {
    expect(read("app/(coach)/groups/[groupId]/programs/[programId]/page.tsx")).toContain("await sweepEmptyDays(supabase, programId);");
    expect(read("app/(coach)/programs/page.tsx")).toContain("await sweepEmptyPrograms(supabase, user.id, groupIds);");
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
