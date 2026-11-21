import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { showProgramsBlock, todayCardLinksProgram } from "@/lib/today-card-program-link";
import { MOVE_POLICY_LINE } from "@/lib/reschedule-line";
import * as tracking from "@/lib/nutrition-tracking";

// The independent review of clutter part A (881f1c4d, Nov 21): one MEDIUM and the LOW findings, fixed in one commit.
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const HOME = "app/(coach)/groups/[groupId]/page.tsx";
const SETTINGS = "app/(coach)/groups/[groupId]/settings/page.tsx";
const CARD = "components/logging/exercise-card.tsx";

describe("clutter part A review fixes", () => {
  it("1: with the coach's food tracking off, Home's Nutrition card shows the targets only (no 'Eaten today 0 of ...')", () => {
    const home = read(HOME);
    expect(home).toContain('.select("food_tracking_enabled")');
    expect(home).toContain("food_tracking_enabled !== false");
    expect(home).toContain("if (foodTrackingOn) dayEaten = sumLoggedFood(");
    // the read comes before the food log is summed
    expect(home.indexOf('.select("food_tracking_enabled")')).toBeLessThan(home.indexOf("if (foodTrackingOn) dayEaten"));
  });

  it("2: 'For <group> only' sits over just the three group switches, after Google Calendar, the calendar feed and Read during rest", () => {
    const s = read(SETTINGS);
    const label = s.indexOf("data-group-switches");
    for (const coachWide of ["<GoogleCalendarConnection", "<CalendarFeedLink />", "<ReadDuringRestSettings"]) expect(s.indexOf(coachWide)).toBeLessThan(label);
    for (const groupOnly of ["<TeamSportToggle", "<PostWorkoutCardsToggle", "<GamificationToggle"]) expect(s.indexOf(groupOnly)).toBeGreaterThan(label);
    expect(s.indexOf("<GamificationToggle")).toBeLessThan(s.indexOf("</SettingsGroup>", label));
  });

  describe("3: a one-program client always has a way into the program", () => {
    const planned = { status: "planned" as const, workoutId: "w1" };
    it("the Today card links it on a planned day, so no second card", () => {
      expect(todayCardLinksProgram(planned, [], true)).toBe(true);
      expect(showProgramsBlock(1, planned, [], true)).toBe(false);
      expect(showProgramsBlock(1, planned, [planned], true)).toBe(false);
    });
    it("a rest day, a done day, an unscheduled day: the 'Your program' card shows", () => {
      expect(showProgramsBlock(1, { status: "rest", workoutId: null }, [], true)).toBe(true);
      expect(showProgramsBlock(1, { status: "unscheduled", workoutId: null }, [], true)).toBe(true);
      expect(showProgramsBlock(1, { status: "done", workoutId: "w1" }, [], true)).toBe(true);
      expect(showProgramsBlock(1, planned, [{ status: "done", workoutId: "w1" }], true)).toBe(true);
    });
    it("two or more programs: always; none: never", () => {
      expect(showProgramsBlock(2, planned, [], true)).toBe(true);
      expect(showProgramsBlock(0, { status: "rest", workoutId: null }, [], true)).toBe(false);
    });
    it("Home uses it", () => {
      expect(read(HOME)).toContain("afterWorkout={programsBlockReady && showProgramsBlock(homePrograms.length, dayWorkout, daySessions, isToday) ? <MyProgramsBlock");
    });
  });

  it("4 and 5: the logger's ⋯ is a plain disclosure (no menu roles), Escape gives focus back to it, and Change what I log brings the fields into view with the first chip focused", () => {
    const c = read(CARD);
    expect(c).not.toContain('role="menu"');
    expect(c).not.toContain('role="menuitem"');
    expect(c).not.toContain('aria-haspopup="menu"');
    expect(c).toContain("aria-expanded={menuOpen}");
    expect(c).toContain("ref={menuButtonRef}");
    expect(c).toContain("menuButtonRef.current?.focus();");
    expect(c).toContain("ref={fieldsRef}");
    expect(c).toContain('el.scrollIntoView({ block: "nearest" });');
    expect(c).toContain('el.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });');
  });

  it("6: the coach named on a client's Home is never one still to accept", () => {
    const home = read(HOME);
    expect(home).toContain("!pendingCoaches.has(m.profileId))?.fullName ?? null;");
    expect(home).toContain("coachName={clientsCoachName}");
    expect(home).toContain("messageCoachLabel(clientsCoachName)");
    expect(home).not.toContain('roster.find((m) => m.role === "coach" && m.profileId !== athleteId)?.fullName');
  });

  it("7: Download App hides on phones and in the installed app, not on tablets", () => {
    const d = read("components/coach/desktop/download-app-button.tsx");
    expect(d).toContain('w.matchMedia("(max-width: 767px)").matches');
    expect(d).not.toContain("max-width: 1024px");
  });

  it("8: the late-move policy is said in the step that moves a session", () => {
    expect(MOVE_POLICY_LINE).toContain("cancellation window");
    expect(MOVE_POLICY_LINE).toContain("they decide whether it counts as a session");
    const r = read("components/athlete/reschedule-slot-button.tsx");
    expect(r).toContain("Move your session to this time? ${MOVE_POLICY_LINE}");
    // the confirm comes before the move is made
    expect(r.indexOf("MOVE_POLICY_LINE}`")).toBeLessThan(r.indexOf('supabase.rpc("reschedule_booking"'));
  });

  it("9: the leftovers are gone", () => {
    expect(read("app/(coach)/groups/[groupId]/feed/page.tsx")).not.toContain('import Link from "next/link";');
    expect(read("components/athlete/meal-checkoff-list.tsx")).not.toContain("selfCoached");
    expect("SELF_NO_MEAL_PLAN_LINE" in tracking).toBe(false);
    expect("SELF_NO_CHECKIN_LINE" in tracking).toBe(false);
    const r = read("components/athlete/recurring-booking-button.tsx");
    expect(r).not.toContain("Book weekly");
    expect(r).not.toContain("startOpen");
  });
});
