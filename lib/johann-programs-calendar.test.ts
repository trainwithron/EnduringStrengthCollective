import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { homeProgramCards } from "@/lib/home-programs";
import { computeScheduledDates, effectiveTrainingDays } from "@/lib/program-schedule";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { MyProgramsBlock } from "@/components/athlete/my-programs-block";
import { ProgramChips } from "@/components/athlete/program-chips";
import { BookingModeLine } from "@/components/athlete/booking-mode-line";

const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

// Johann's real shape (a client with TWO active programs): A = 3x_weekly (start 2026-09-21, Mon/Wed/Fri, 30 workouts, only Day 1 logged), B = "Dont mess with the Johann" (start 2026-09-29, NO training days, 4 workouts in week 1, Days 1-3 logged).
const A = { id: "A", name: "3x_weekly_johann_program", created_at: "2026-09-16T16:42:49Z" };
const B = { id: "B", name: "Dont mess with the Johann", created_at: "2026-09-28T20:49:20Z" };
const aWorkouts = Array.from({ length: 30 }, (_, i) => ({ id: `a${i + 1}`, program_id: "A", week_number: Math.floor(i / 3) + 1, day_index: (i % 3) + 1 }));
const bWorkouts = [1, 2, 3, 4].map((d) => ({ id: `b${d}`, program_id: "B", week_number: 1, day_index: d }));

describe("Johann: both programs show on Home", () => {
  const cards = homeProgramCards([B, A], [...bWorkouts, ...aWorkouts], new Set(["a1", "b1", "b2", "b3"]));
  it("lists BOTH, oldest first, each with where he is up to and how many are done", () => {
    expect(cards.map((c) => c.name)).toEqual(["3x_weekly_johann_program", "Dont mess with the Johann"]);
    expect(cards[0]).toMatchObject({ total: 30, done: 1, upNext: "Week 1, Day 2" });
    expect(cards[1]).toMatchObject({ total: 4, done: 3, upNext: "Week 1, Day 4" });
  });
  it("works for a program with no dates (by order only), a finished one and an empty one", () => {
    expect(homeProgramCards([B], bWorkouts, new Set(["b1", "b2", "b3", "b4"]))[0].upNext).toBe("All done");
    expect(homeProgramCards([B], [], new Set())[0]).toMatchObject({ total: 0, done: 0, upNext: "Nothing in it yet" });
    // a week with a missing number counts as week 1; weeks are walked in order, not in the order the rows came
    const odd = homeProgramCards([A], [{ id: "x", program_id: "A", week_number: 3, day_index: 1 }, { id: "y", program_id: "A", week_number: 2, day_index: 2 }], new Set());
    expect(odd[0].upNext).toBe("Week 2, Day 2");
  });
  it("the block renders each program as a link to its full view", () => {
    const html = renderToStaticMarkup(createElement(MyProgramsBlock, { groupId: "g1", programs: cards }));
    expect(html).toContain("Your programs");
    expect(html).toContain('href="/groups/g1/programs/A"');
    expect(html).toContain('href="/groups/g1/programs/B"');
    expect(html).toContain("Week 1, Day 4");
    expect(html).toContain("3 of 4 done");
    expect(renderToStaticMarkup(createElement(MyProgramsBlock, { groupId: "g1", programs: [] }))).toContain("Your coach is setting up your program");
  });
  it("Home puts the block right under the workout card(s), above nutrition and weight, and the old bottom list only stays for other views", () => {
    const home = read("app/(coach)/groups/[groupId]/page.tsx");
    expect(home).toContain("afterWorkout={isToday && !programsError");
    expect(home).toContain("<MyProgramsBlock groupId={params.groupId} programs={homePrograms} />");
    expect(home).toContain('view === "day" && isToday && !programsError');
    const card = read("components/athlete/day-card.tsx");
    expect(card.indexOf("<WorkoutSection")).toBeLessThan(card.indexOf("{afterWorkout}"));
    expect(card.indexOf("{afterWorkout}")).toBeLessThan(card.indexOf("<TodayWidget"));
  });
});

describe("Johann: the Calendar shows the 4-day program too", () => {
  it("a program with a start date and no training days is spread evenly by its busiest week (read-time only)", () => {
    expect(effectiveTrainingDays(null, bWorkouts)).toEqual({ days: [1, 2, 4, 5], guessed: true });
    expect(effectiveTrainingDays([], bWorkouts)).toEqual({ days: [1, 2, 4, 5], guessed: true });
    expect(effectiveTrainingDays([1, 3, 5], aWorkouts)).toEqual({ days: [1, 3, 5], guessed: false });
    expect(effectiveTrainingDays(null, [])).toEqual({ days: null, guessed: false });
    expect(effectiveTrainingDays(null, Array.from({ length: 9 }, (_, i) => ({ week_number: 1 + 0 * i })))).toEqual({ days: [0, 1, 2, 3, 4, 5, 6], guessed: true });
  });
  it("B lands on real dates from its start date: Tue 9/29, Thu 10/1, Fri 10/2, Mon 10/5", () => {
    const days = effectiveTrainingDays(null, bWorkouts).days!;
    const dates = computeScheduledDates("2026-09-29", days, bWorkouts.map((w) => ({ id: w.id })));
    expect([...dates.values()].map((d) => `${d.getMonth() + 1}/${d.getDate()}`)).toEqual(["9/29", "10/1", "10/2", "10/5"]);
  });
  it("the program calendar and its day page both use the same spread, say so, and offer a chip for each active program", () => {
    const cal = read("app/(coach)/groups/[groupId]/programs/[programId]/calendar/page.tsx");
    expect(cal).toContain("effectiveTrainingDays(program.training_days, workouts ?? [])");
    expect(cal).toContain("<ProgramChips");
    expect(cal).toContain("Days are not set for this program, so its workouts are spread evenly");
    expect(read("app/(coach)/groups/[groupId]/programs/[programId]/calendar/[date]/page.tsx")).toContain("effectiveTrainingDays(program.training_days, workouts ?? [])");
  });
  it("the Calendar tab opens a dated program even when it has no training days, after any program that does", () => {
    const body = read("components/coach/calendar-page-body.tsx");
    expect(body).toContain("const datedPrograms = activePrograms.filter((p) => p.startDate && !p.trainingDays?.length);");
    expect(body.indexOf("scheduledPrograms[0]")).toBeLessThan(body.indexOf("datedPrograms[0]"));
  });
  it("chips: one per program, the one on screen marked, nothing for a single program", () => {
    const html = renderToStaticMarkup(createElement(ProgramChips, { groupId: "g1", programs: [{ id: "A", name: "3x" }, { id: "B", name: "Dont" }], currentId: "B" }));
    expect(html).toContain('href="/groups/g1/programs/A/calendar"');
    expect(html).toContain('aria-current="page"');
    expect(renderToStaticMarkup(createElement(ProgramChips, { groupId: "g1", programs: [{ id: "A", name: "3x" }], currentId: "A" }))).toBe("");
  });
});

describe("Johann: how to set up a session with the coach", () => {
  it("when the coach schedules everyone, the client's Calendar says so and offers a Message button (the mode is not changed)", () => {
    const html = renderToStaticMarkup(createElement(BookingModeLine, { groupId: "g1" }));
    expect(html).toContain("Your coach schedules your sessions with you. Message them to set one up.");
    expect(html).toContain('href="/groups/g1/messages"');
    const cal = read("app/(coach)/groups/[groupId]/programs/[programId]/calendar/page.tsx");
    expect(cal).toContain('bookingMode === "coach_schedules" && <BookingModeLine');
    expect(read("components/coach/calendar-page-body.tsx")).toContain('bookingMode === "coach_schedules" && <BookingModeLine');
    for (const f of [cal, read("components/coach/calendar-page-body.tsx"), read("components/athlete/booking-mode-line.tsx")]) expect(f).not.toMatch(/booking_mode: |upsert\(/);
  });
});
