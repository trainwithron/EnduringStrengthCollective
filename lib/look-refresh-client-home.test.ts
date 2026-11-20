import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { homeProgramCards } from "@/lib/home-programs";
import { clientGreeting, coachFirstName } from "@/lib/client-home-greeting";
import { DayCard } from "@/components/athlete/day-card";

// Look Refresh, client step (Ron, Nov 20): the client's Home starts with today.
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

describe("client Home: today first", () => {
  it("the Today card comes first, then the three tiles, then the check-in, then the programs and the day's nutrition and weight", () => {
    const card = read("components/athlete/day-card.tsx");
    const order = ["<WorkoutSection", "{isToday && <TodayTiles />}", "{checkin}", "{afterWorkout}", "<TodayWidget", 'id="log-weight"', "<InbodyEntry athleteId={athleteId} groupId={groupId} />"];
    const at = order.map((s) => card.indexOf(s));
    for (const i of at) expect(i).toBeGreaterThan(-1);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(card).toContain("data-today-card");
    expect(card).toContain("{program.done} of {program.total} workouts done");
    expect(card).toContain("Week {program.week} of {program.weeks}");
  });
  it("on the page the Today card is the first card (a workout left open comes back above it), and the rest of Home follows it", () => {
    const page = read("app/(coach)/groups/[groupId]/page.tsx");
    const day = page.indexOf("<DayCard\n                groupId={params.groupId}");
    expect(page.indexOf("Finish your workout")).toBeLessThan(day);
    for (const later of ["<HomeThread lines={homeThreadLines} />", "<GoalSheetPromptCard", "<OtherProgramsCard", "<ReviewPromptSection", "<MyScheduleCard groupId", "Message your coach", "<FeaturedShopCards", '<AddToHomeScreenPrompt slot="home" />']) {
      expect(page.indexOf(later), later).toBeGreaterThan(day);
    }
  });
  it("the three tiles open what Home already had: the check-in, the weight log and the InBody scans", () => {
    const tiles = read("components/athlete/today-tiles.tsx");
    expect(tiles).toContain('data-tile="checkin"');
    expect(tiles).toContain('href="#log-weight"');
    expect(tiles).toContain("window.dispatchEvent(new Event(OPEN_INBODY_EVENT))");
    expect(read("components/athlete/wellness-checkin-popup.tsx")).toContain("window.addEventListener(OPEN_CHECKIN_EVENT, open);");
    expect(read("components/body/inbody-entry.tsx")).toContain("window.addEventListener(OPEN_INBODY_EVENT, openIt);");
  });
  it("Day, Week and Month are not on Home", () => {
    const page = read("app/(coach)/groups/[groupId]/page.tsx");
    expect(page).not.toContain("<DayWeekMonthSwitcher");
    expect(page).not.toContain("<ViewModeRedirector");
  });
  it("the add-to-home-screen banner sits below Home's content; the top copy steps aside while Home's is on the page", () => {
    const banner = read("components/add-to-home-screen-prompt.tsx");
    expect(banner).toContain("<div data-a2hs-home-slot>");
    expect(banner).toContain("if (!visible || !inApp || guideOn || homeSlotOn) return null;");
  });
});

describe("the wellness check-in, one question at a time", () => {
  it("shows a step count, the same three scales and the reflection on its days, and Save on the last", () => {
    const w = read("components/athlete/wellness-checkin-widget.tsx");
    expect(w).toContain("const totalSteps = FIELDS.length + (lifeImpactPrompt ? 1 : 0);");
    expect(w).toContain("{step + 1} of {totalSteps}");
    expect(w).toContain("data-checkin-one-at-a-time");
    expect(w).toContain("if (!lastStep) setStep((s) => Math.min(s + 1, totalSteps - 1));");
    // the save itself is untouched
    expect(w).toContain('.from("wellness_checkins")');
    expect(w).toContain('{ onConflict: "athlete_id,group_id,log_date" }');
  });
});

describe("the Today card's numbers come from Home's own program list", () => {
  const workouts = [
    { id: "w1", program_id: "p", week_number: 1, day_index: 1 },
    { id: "w2", program_id: "p", week_number: 1, day_index: 2 },
    { id: "w3", program_id: "p", week_number: 2, day_index: 1 },
    { id: "w4", program_id: "p", week_number: 3, day_index: 1 },
  ];
  it("week x of y and how many are done", () => {
    const [card] = homeProgramCards([{ id: "p", name: "Strength" }], workouts, new Map([["w1", "2026-11-01"], ["w2", "2026-11-03"]]));
    expect(card).toMatchObject({ week: 2, weeks: 3, done: 2, total: 4 });
    const [done] = homeProgramCards([{ id: "p", name: "Strength" }], workouts, new Map(workouts.map((w) => [w.id, "2026-11-01"])));
    expect(done).toMatchObject({ week: 3, weeks: 3 });
    expect(homeProgramCards([{ id: "p", name: "Empty" }], [], new Map())[0]).toMatchObject({ week: null, weeks: 0 });
  });
  it("renders on the card with a full-width Start workout", () => {
    const [program] = homeProgramCards([{ id: "p", name: "Strength" }], workouts, new Map([["w1", "x"]]));
    const html = renderToStaticMarkup(
      createElement(DayCard, {
        groupId: "g",
        athleteId: "a",
        dateKey: "2026-11-20",
        dateLabel: "Today",
        isToday: true,
        workout: { status: "planned", workoutId: "w2", title: "Day 2" },
        sessions: [{ status: "planned", workoutId: "w2", title: "Day 2", programId: "p", heading: "Strength" }],
        macros: null,
        habits: [],
        weightLogs: [],
        canBook: false,
        programs: [program],
      })
    );
    expect(html).toContain("Week 1 of 3");
    expect(html).toContain("1 of 4 workouts done");
    expect(html).toContain("Start workout");
    expect(html.indexOf("data-today-card")).toBeLessThan(html.indexOf("data-today-tiles"));
  });
});

describe("the greeting", () => {
  it("Hey {first name}, and the date with the coach's name", () => {
    const g = clientGreeting({ clientName: "Sawyer Steele", coachName: "Ron Arnold", now: new Date("2026-11-20T18:00:00Z"), timeZone: "America/Chicago" });
    expect(g).toEqual({ title: "Hey Sawyer", line: "Friday, November 20 · with Coach Ron" });
    expect(coachFirstName("Coach Ron")).toBe("Ron");
    expect(clientGreeting({ clientName: null, coachName: null, now: new Date("2026-11-20T18:00:00Z"), timeZone: "UTC" }).title).toBe("Hey there");
    expect(read("components/group/group-hub-header.tsx")).toContain("data-client-greeting");
  });
});
