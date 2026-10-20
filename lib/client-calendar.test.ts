import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildCalendarDays, undatedProgramCards } from "./client-calendar";
import type { ProgramDayContext } from "./program-day-contexts";
import type { ActiveProgram } from "./active-programs";
import { defaultWeek } from "./program-plain-view";
import { pickUpWhereLeftOff, weekOf } from "./program-pickup";

vi.mock("@/lib/supabase/client", () => ({ createBrowserClient: () => ({ storage: { from: () => ({ createSignedUrl: async () => ({ data: null }) }) } }) }));
const { UndatedProgramCards } = await import("@/components/athlete/undated-program-cards");

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const body = read("components/coach/calendar-page-body.tsx");
const clientBranch = body.slice(body.indexOf("  if (showMobileView) {\n    // The client's ONE Calendar"), body.indexOf("  // The group and the coach's time zone do not depend on each other"));

const program = (id: string, name: string, dated: boolean): ActiveProgram => ({
  id,
  name,
  label: null,
  sortOrder: null,
  createdAt: "2026-09-01T00:00:00Z",
  athleteId: "c1",
  startDate: dated ? "2026-10-05" : null,
  trainingDays: dated ? [1, 3, 5] : null,
  visibilityWindow: "full",
} as ActiveProgram);
const day = (d: number) => new Date(2026, 9, d);
const ctx = (p: ActiveProgram, scheduled: { workoutId: string; title: string; date: Date }[], all: { id: string; title: string }[] = []): ProgramDayContext => ({
  program: p,
  heading: p.name,
  unscheduled: !p.startDate || !p.trainingDays?.length,
  scheduled,
  all,
});

// Johann's shape: A on dates (Mon/Wed/Fri), B with no dates; a second dated program C (mobility, Tuesdays).
const A = ctx(program("A", "3x weekly", true), [
  { workoutId: "a1", title: "A Day 1", date: day(19) },
  { workoutId: "a2", title: "A Day 2", date: day(21) },
]);
const C = ctx(program("C", "Mobility", true), [{ workoutId: "c1", title: "Mobility flow", date: day(20) }]);
const B = ctx(program("B", "Dont mess with the Johann", false), [], [{ id: "b1", title: "Day 1" }]);
const TODAY = day(19);
const dates = [day(19), day(20), day(21), day(22)];

describe("the client's Calendar is one calendar, never a program's", () => {
  it("never redirects the Calendar tab to a program calendar (0, 1 or 2 dated programs alike)", () => {
    expect(clientBranch.length).toBeGreaterThan(1000);
    expect(clientBranch).not.toContain("redirect(");
    expect(clientBranch).not.toContain("/programs/");
  });
  it("the header is just 'Calendar': no program text, no program title, chips or Back to program", () => {
    const header = clientBranch.slice(clientBranch.indexOf("<header"), clientBranch.indexOf("</header>"));
    expect(header).toContain(">Calendar</h1>");
    expect(header).not.toContain("No program assigned yet");
    expect(header).not.toContain("doesn't have a start date");
    expect(clientBranch).not.toContain("ProgramChips");
    expect(clientBranch).not.toContain("Back to program");
  });
  it("the Schedule card stays on top, then the cards for programs with no dates, then the calendar", () => {
    const card = clientBranch.indexOf("<ScheduleCard");
    const undated = clientBranch.indexOf("<UndatedProgramCards");
    const grid = clientBranch.indexOf("WEEKDAY_LABELS.map");
    expect(card).toBeGreaterThan(clientBranch.indexOf("</header>"));
    expect(card).toBeLessThan(undated);
    expect(undated).toBeLessThan(grid);
  });
  it("a day with something on it opens the day page even when the coach has no open hours", () => {
    expect(clientBranch).toContain("if (hasAvailability || lines.length > 0) {");
    expect(clientBranch).toContain("if (hasAvailability || has) {");
    expect(clientBranch).toContain("const dayHref = (d: Date) => `${basePath}/${dateKey(d)}");
  });
});

describe("each day: sessions, what they logged, and every dated program's workouts", () => {
  const days = buildCalendarDays(
    {
      dated: [A, C],
      loggedIds: new Set(["a1"]),
      assigned: new Map(),
      logged: [
        { workoutId: "a1", title: "A Day 1", dateKey: "2026-10-19" },
        { workoutId: "b1", title: "Day 1", dateKey: "2026-10-22" },
      ],
      bookings: [{ id: "bk1", dateKey: "2026-10-21", time: "4:00 PM" }],
    },
    dates,
    TODAY
  );
  it("both dated programs are on the grid (not just the first)", () => {
    expect(days.get("2026-10-19")!.workouts.map((w) => [w.title, w.status])).toEqual([["A Day 1", "done"]]);
    expect(days.get("2026-10-20")!.workouts.map((w) => w.title)).toEqual(["Mobility flow"]);
    expect(days.get("2026-10-21")!.workouts.map((w) => w.title)).toEqual(["A Day 2"]);
  });
  it("a booked session shows on its day; a workout logged that day shows once (not twice when it is also the day's program workout)", () => {
    expect(days.get("2026-10-21")!.sessions).toEqual([{ id: "bk1", time: "4:00 PM" }]);
    expect(days.get("2026-10-19")!.workouts).toHaveLength(1);
    expect(days.get("2026-10-22")!.workouts.map((w) => [w.title, w.status, w.heading])).toEqual([["Day 1", "done", "Logged"]]);
  });
  it("a program with no dates is never placed on a day (only what was logged from it shows)", () => {
    const only = buildCalendarDays({ dated: [], loggedIds: new Set(), assigned: new Map(), logged: [], bookings: [] }, dates, TODAY);
    expect([...only.values()].every((d) => d.workouts.length === 0 && d.sessions.length === 0)).toBe(true);
    expect(read("lib/client-calendar.ts")).toContain("const dated = contexts.filter((c) => !c.unscheduled);");
  });
  it("Johann's case (one program on dates, one without): a normal calendar with his sessions and A's days, and a card for B", () => {
    expect(days.get("2026-10-21")!.sessions).toHaveLength(1);
    const cards = undatedProgramCards([B], [{ id: "b1", program_id: "B", title: "Day 1", week_number: 1, day_index: 1 }], new Map(), new Map([["B", null]]));
    expect(cards).toEqual([{ id: "B", name: "Dont mess with the Johann", coverImagePath: null, workoutCount: 1, upNext: "Up next: Week 1, Day 1" }]);
  });
});

describe("cards for programs with no dates", () => {
  const weeks15 = Array.from({ length: 45 }, (_, i) => ({ id: `w${i + 1}`, program_id: "B", title: null, week_number: Math.floor(i / 3) + 1, day_index: (i % 3) + 1 }));
  const throughWeek13 = new Map(weeks15.slice(0, 39).map((w, i) => [w.id, `2026-0${1 + Math.floor(i / 10)}-1${i % 10}T10:00:00Z`]));
  it("cover and where they pick up: logs through week 13 -> Up next: Week 14, Day 1", () => {
    const [card] = undatedProgramCards([B], weeks15, throughWeek13, new Map([["B", "covers/b.jpg"]]));
    expect(card.coverImagePath).toBe("covers/b.jpg");
    expect(card.upNext).toBe("Up next: Week 14, Day 1");
  });
  it("tapping a card opens the whole program (not straight into a workout); one card fills the width", () => {
    const html = renderToStaticMarkup(createElement(UndatedProgramCards, { groupId: "g", programs: [{ id: "B", name: "Johann", coverImagePath: null, workoutCount: 4, upNext: "Up next: Week 1, Day 4" }], visuals: {} }));
    expect(html).toContain('href="/groups/g/programs/B"');
    expect(html).not.toContain("/workouts/");
    expect(html).toContain("Up next: Week 1, Day 4");
    expect(html).toContain("w-full");
  });
  it("several scroll sideways; none renders nothing", () => {
    const two = renderToStaticMarkup(createElement(UndatedProgramCards, { groupId: "g", programs: [1, 2].map((n) => ({ id: `p${n}`, name: `P${n}`, coverImagePath: null, workoutCount: 1, upNext: "Up next: Week 1, Day 1" })), visuals: {} }));
    expect(two).toContain("overflow-x-auto");
    expect(renderToStaticMarkup(createElement(UndatedProgramCards, { groupId: "g", programs: [], visuals: {} }))).toBe("");
  });
});

describe("the program view opens where they left off", () => {
  it("a program with logs through week 13 opens on week 14, and that chip is scrolled into view", () => {
    const rows = Array.from({ length: 45 }, (_, i) => ({ id: `w${i + 1}`, week_number: Math.floor(i / 3) + 1, day_index: (i % 3) + 1 }));
    const doneAt = new Map(rows.slice(0, 39).map((w, i) => [w.id, new Date(Date.UTC(2026, 0, 1 + i)).toISOString()]));
    const pick = pickUpWhereLeftOff(rows, doneAt);
    const current = pick.kind === "next" ? weekOf(pick.workout) : null;
    expect(current).toBe(14);
    const weeks = Array.from({ length: 15 }, (_, i) => ({ weekNumber: i + 1, days: [] }));
    expect(defaultWeek(weeks as never, current)).toBe(14);
    const picker = read("components/shared/program-day-picker.tsx");
    expect(picker).toContain("ref={w.weekNumber === defaultWeek(weeks, currentWeek) ? openedWeekChip : undefined}");
    expect(picker).toContain('openedWeekChip.current?.scrollIntoView({ block: "nearest", inline: "center" });');
  });
  it("the client's program list on a computer has Continue on top and scrolls to that week", () => {
    const page = read("app/(coach)/groups/[groupId]/programs/[programId]/page.tsx");
    expect(page).toContain("Continue: {weekDayLabel(upNext)} &rarr;");
    expect(page).toContain("<ScrollToOnLoad targetId={`week-${weekOf(upNext)}`} />");
    expect(page).toContain("id={`week-${weekNum}`}");
  });
});

describe("the day page lists that day's workouts", () => {
  it("every dated program's workout, the coach's one-day workout and what was logged, each opening the workout", () => {
    const page = read("app/(coach)/groups/[groupId]/calendar/[date]/page.tsx");
    expect(page).toContain("await loadClientCalendar(supabase, { groupId: params.groupId, athleteId, timezone: dayTz, dates: [date]");
    expect(page).toContain("href={`/groups/${params.groupId}/workouts/${w.workoutId}`}");
    expect(page).toContain('w.status === "locked" ? (');
  });
});
