import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { homeProgramCards, programPickups } from "@/lib/home-programs";
import { pickUpWhereLeftOff, pickupLabel, weekDayLabel } from "@/lib/program-pickup";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { MyProgramsBlock } from "@/components/athlete/my-programs-block";
import { ProgramChips } from "@/components/athlete/program-chips";
import { BookingModeLine } from "@/components/athlete/booking-mode-line";
import { ProgramDayPicker } from "@/components/shared/program-day-picker";
import { resolveSessionsForDate, type ProgramDayContext } from "@/lib/program-day-contexts";
import { computeScheduledDates } from "@/lib/program-schedule";
import type { ActiveProgram } from "@/lib/active-programs";

const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

// Johann's real shape (a client with TWO active programs): A = 3x_weekly (start 2026-09-21, Mon/Wed/Fri, 30 workouts, only Day 1 done), B = "Dont mess with the Johann" (start 2026-09-29, NO training days, 4 workouts in week 1, Days 1-3 done).
const A = { id: "A", name: "3x_weekly_johann_program", created_at: "2026-09-16T16:42:49Z" };
const B = { id: "B", name: "Dont mess with the Johann", created_at: "2026-09-28T20:49:20Z" };
const aWorkouts = Array.from({ length: 30 }, (_, i) => ({ id: `a${i + 1}`, program_id: "A", week_number: Math.floor(i / 3) + 1, day_index: (i % 3) + 1 }));
const bWorkouts = [1, 2, 3, 4].map((d) => ({ id: `b${d}`, program_id: "B", week_number: 1, day_index: d }));
const done = (entries: Record<string, string>) => new Map(Object.entries(entries));

describe("pick up where you left off: the default workout is the one right AFTER the one done last", () => {
  const johann = done({ a1: "2026-09-17T14:55:24Z", b1: "2026-09-28T22:01:43Z", b2: "2026-10-06T16:18:17Z", b3: "2026-10-07T15:46:26Z" });
  it("Johann's A (only Day 1 done) picks up at Day 2, and B (Days 1-3 done) at Day 4", () => {
    const a = pickUpWhereLeftOff(aWorkouts, johann);
    const b = pickUpWhereLeftOff(bWorkouts, johann);
    expect(a.kind === "next" && weekDayLabel(a.workout)).toBe("Week 1, Day 2");
    expect(b.kind === "next" && weekDayLabel(b.workout)).toBe("Week 1, Day 4");
  });
  it("a skipped day does not pull it back: Day 4 done and Day 2 never done -> Day 5", () => {
    const p = pickUpWhereLeftOff(aWorkouts.slice(0, 9), done({ a1: "2026-01-01", a4: "2026-01-02" }));
    expect(p.kind === "next" && weekDayLabel(p.workout)).toBe("Week 2, Day 2");
    const w = Array.from({ length: 6 }, (_, i) => ({ id: `d${i + 1}`, week_number: 1, day_index: i + 1 }));
    const q = pickUpWhereLeftOff(w, done({ d1: "2026-01-01", d3: "2026-01-02", d4: "2026-01-03" }));
    expect(q.kind === "next" && weekDayLabel(q.workout)).toBe("Week 1, Day 5");
  });
  it("it goes across weeks: Week 3's last day done -> Week 4, Day 1", () => {
    const p = pickUpWhereLeftOff(aWorkouts, done({ a7: "2026-01-01", a8: "2026-01-02", a9: "2026-01-03" }));
    expect(p.kind === "next" && weekDayLabel(p.workout)).toBe("Week 4, Day 1");
  });
  it("it is the one done MOST RECENTLY, not the furthest along: going back and redoing Week 1 Day 1 picks up at Day 2", () => {
    const p = pickUpWhereLeftOff(aWorkouts, done({ a1: "2026-03-01", a9: "2026-02-01" }));
    expect(p.kind === "next" && weekDayLabel(p.workout)).toBe("Week 1, Day 2");
  });
  it("nothing done -> Week 1, Day 1; after the very last workout the program is complete; an empty program says so", () => {
    const first = pickUpWhereLeftOff(aWorkouts, done({}));
    expect(first.kind === "next" && weekDayLabel(first.workout)).toBe("Week 1, Day 1");
    const end = pickUpWhereLeftOff(bWorkouts, done({ b4: "2026-01-01" }));
    expect(end.kind).toBe("complete");
    expect(pickupLabel(end)).toBe("Program complete");
    expect(pickupLabel(pickUpWhereLeftOff([], done({})))).toBe("Nothing in it yet");
  });
  it("it ignores dates and training days entirely; workouts with no week or day numbers still walk in order", () => {
    const loose = [{ id: "x", week_number: null, day_index: null }, { id: "y", week_number: null, day_index: 2 }, { id: "z", week_number: 2, day_index: 1 }];
    const p = pickUpWhereLeftOff(loose, done({ x: "2026-01-01" }));
    expect(p.kind === "next" && p.workout.id).toBe("y");
  });
  it("a completion with no time (an old record) still counts as done", () => {
    const p = pickUpWhereLeftOff(bWorkouts, done({ b2: "0000-00-00" }));
    expect(p.kind === "next" && weekDayLabel(p.workout)).toBe("Week 1, Day 3");
  });
});

describe("Johann: both programs show on Home", () => {
  const doneAt = done({ a1: "2026-09-17T14:55:24Z", b1: "2026-09-28T22:01:43Z", b2: "2026-10-06T16:18:17Z", b3: "2026-10-07T15:46:26Z" });
  const cards = homeProgramCards([B, A], [...bWorkouts, ...aWorkouts], doneAt);
  it("lists BOTH, oldest first, each with where he picks up and how many are done", () => {
    expect(cards.map((c) => c.name)).toEqual(["3x_weekly_johann_program", "Dont mess with the Johann"]);
    expect(cards[0]).toMatchObject({ total: 30, done: 1, upNext: "Week 1, Day 2" });
    expect(cards[1]).toMatchObject({ total: 4, done: 3, upNext: "Week 1, Day 4" });
    expect(programPickups([A, B], [...aWorkouts, ...bWorkouts], doneAt).get("B")?.kind).toBe("next");
  });
  it("a finished program and an empty one read plainly", () => {
    expect(homeProgramCards([B], bWorkouts, done({ b1: "1", b2: "2", b3: "3", b4: "4" }))[0].upNext).toBe("Program complete");
    expect(homeProgramCards([B], [], done({}))[0]).toMatchObject({ total: 0, done: 0, upNext: "Nothing in it yet" });
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
  it("Today's card for each program follows the same rule (Home and the Today/log pages)", () => {
    expect(read("app/(coach)/groups/[groupId]/page.tsx")).toContain("{ byProgram: homePickups,");
    const day = read("lib/program-day-contexts.ts");
    expect(day).toContain("const pick = isToday ? pickups?.byProgram.get(c.program.id) : undefined;");
    const today = read("lib/todays-workout.ts");
    expect(today).toContain("pickUpWhereLeftOff(workouts, doneAt)");
    // WHETHER there is something today is still the calendar's old answer (so the coach's due lists do not change); the pick only swaps WHICH workout is offered
    expect(today).toContain("resolveProgramByCalendar(supabase, program, athleteId, timezone)");
    expect(today).toContain("if (!offersAWorkout) return result;");
  });
});

describe("Home Today: on the calendar keeps its rest days; off the calendar offers where he picks up", () => {
  const prog = (over: Partial<ActiveProgram>): ActiveProgram => ({ id: "A", name: "A", label: null, sortOrder: null, createdAt: "2026-09-16", athleteId: "me", startDate: "2026-09-21", trainingDays: [1, 3, 5], visibilityWindow: "week", ...over });
  const dates = computeScheduledDates("2026-09-21", [1, 3, 5], aWorkouts.map((w) => ({ id: w.id })));
  const scheduledCtx: ProgramDayContext = {
    program: prog({}),
    heading: "A",
    unscheduled: false,
    scheduled: aWorkouts.map((w) => ({ workoutId: w.id, title: w.id, date: dates.get(w.id)! })),
    all: [],
  };
  const unscheduledCtx: ProgramDayContext = { program: prog({ id: "B", startDate: "2026-09-29", trainingDays: null }), heading: "B", unscheduled: true, scheduled: [], all: bWorkouts.map((w) => ({ id: w.id, title: w.id })) };
  const doneAt = done({ a1: "2026-09-17T14:55:24Z", b1: "2026-09-28T22:01:43Z", b2: "2026-10-06T16:18:17Z", b3: "2026-10-07T15:46:26Z" });
  const pickups = { byProgram: programPickups([A, B], [...aWorkouts, ...bWorkouts], doneAt), doneToday: () => false };
  const logged = new Set(["a1", "b1", "b2", "b3"]);

  it("a rest day on the calendar is still a rest day (nothing offered); a playlist program still offers where he picks up", () => {
    const sunday = new Date("2026-10-18T00:00:00");
    const out = resolveSessionsForDate([scheduledCtx, unscheduledCtx], logged, sunday, sunday, true, undefined, pickups);
    expect(out.map((s) => s.programId)).toEqual(["B"]);
    expect(out[0]).toMatchObject({ status: "planned", workoutId: "b4" });
  });
  it("on a training day the card is a workout, and the pickup rule decides WHICH one (Day 2, not the one the date gives)", () => {
    // 2026-09-23 is the date the calendar gives Day 2 of A; pick a later training day where the calendar would give another workout
    const dayOf = (id: string) => dates.get(id)!;
    const wed = new Date(dayOf("a5"));
    const out = resolveSessionsForDate([scheduledCtx], logged, wed, wed, true, undefined, pickups);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ status: "planned", workoutId: "a2" });
    // without the pickup the calendar's own answer is unchanged
    const plain = resolveSessionsForDate([scheduledCtx], logged, wed, wed, true);
    expect(plain[0]).toMatchObject({ workoutId: "a5" });
  });
  it("other dates (Week and Month views) follow the calendar, never the pickup", () => {
    const wed = new Date(dates.get("a5")!);
    const later = new Date(wed);
    later.setDate(later.getDate() + 7);
    const out = resolveSessionsForDate([scheduledCtx], logged, wed, later, false, undefined, pickups);
    expect(out[0].workoutId).toBe("a5");
  });
});

describe("the program view opens where he left off", () => {
  const src = read("components/shared/program-plain-view-server.tsx");
  it("the default week and the highlighted day come from the same rule, not from dates", () => {
    expect(src).toContain("pickUpWhereLeftOff(rows, doneAt)");
    expect(src).toContain("upNextDayId={upNextDayId}");
    expect(src).not.toContain("currentWeekFor(");
  });
  it("the picker marks the week and day 'Up next' and has one Continue button for it", () => {
    const week = (n: number, days: { id: string; dayIndex: number }[]) => ({
      weekNumber: n,
      days: days.map((d) => ({ id: d.id, dayIndex: d.dayIndex, title: "", dateLabel: null, isToday: false, lockedLabel: null, completedAt: null, exerciseCount: 1, exercises: [], totalSets: 1 })),
    });
    const html = renderToStaticMarkup(
      createElement(ProgramDayPicker, {
        title: "P",
        weeks: [week(1, [{ id: "w1", dayIndex: 1 }]), week(3, [{ id: "w31", dayIndex: 4 }, { id: "w32", dayIndex: 5 }])],
        currentWeek: 3,
        upNextDayId: "w32",
        backHref: "/",
        editHref: null,
        workoutHrefBase: "/groups/g/workouts",
        canEdit: false,
        isCoachViewing: false,
        nowIso: "2026-10-18T12:00:00Z",
      })
    );
    expect(html).toContain("Up next");
    expect(html).toContain('href="/groups/g/workouts/w32"');
    expect(html).toContain("Continue: Week 3 Day 5");
    expect(html).toContain("Week 3 Day 5");
  });
});

describe("Johann: the Calendar does not place a program the coach has not scheduled", () => {
  it("a program with no training days is NOT laid out on the calendar: no spread, no automatic placement", () => {
    expect(read("lib/program-schedule.ts")).not.toContain("effectiveTrainingDays");
    for (const f of ["app/(coach)/groups/[groupId]/programs/[programId]/calendar/page.tsx", "app/(coach)/groups/[groupId]/programs/[programId]/calendar/[date]/page.tsx", "components/coach/calendar-page-body.tsx"]) {
      const s = read(f);
      expect(s, f).not.toContain("effectiveTrainingDays");
      expect(s, f).not.toContain("spread evenly");
    }
    expect(read("components/coach/calendar-page-body.tsx")).not.toContain("datedPrograms");
  });
  it("it says so plainly, links to the program, and still offers the chip row", () => {
    const cal = read("app/(coach)/groups/[groupId]/programs/[programId]/calendar/page.tsx");
    expect(cal).toContain("No days set. Your coach hasn&apos;t put this program on the calendar yet. Open it from Home.".replace("&apos;", "'"));
    expect(cal).toContain("Open this program");
    expect(cal.indexOf("<ProgramChips")).toBeLessThan(cal.indexOf("No days set."));
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
