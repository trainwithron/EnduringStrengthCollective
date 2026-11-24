import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/supabase/client", () => ({ createBrowserClient: () => ({}) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {} }) }));

import { buildHomeThread } from "@/lib/home-thread";
import { messageCoachLabel } from "@/lib/client-home-greeting";
import { buildMoreSections } from "@/lib/more-links";
import { canDrawTrend } from "@/lib/nutrition-tracking";
import { goalStatusWords } from "@/lib/goal-types";
import { rescheduleLine } from "@/lib/reschedule-line";
import { isPhoneOrInstalled } from "@/components/coach/desktop/download-app-button";
import { TodayWidget, shownNumber } from "@/components/athlete/today-widget";
import { DayCard } from "@/components/athlete/day-card";

// The clutter and flow batch, part A (Ron, Nov 21: "fix all clutter and flow that arent my call"): the client app, Settings, Nutrition and the notification toggle.
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const HOME = "app/(coach)/groups/[groupId]/page.tsx";
const SETTINGS = "app/(coach)/groups/[groupId]/settings/page.tsx";
const NUTRITION = "app/(coach)/groups/[groupId]/nutrition/page.tsx";
const day = { groupId: "g", athleteId: "a", dateKey: "2026-11-21", dateLabel: "Today", isToday: true, macros: null, habits: [], weightLogs: [], canBook: false };

describe("Home", () => {
  it("CL1: one way to log weight; InBody is on My progress (CL10: not on Home); the How I Feel tile steps aside while the check-in card shows", () => {
    expect(read("components/athlete/weight-log-widget.tsx")).toContain("{!opensFromTile && (");
    expect(read("components/athlete/day-card.tsx")).not.toContain("<InbodyEntry");
    expect(read("app/(coach)/groups/[groupId]/progress/page.tsx")).toContain("<InbodyEntry athleteId={athleteId} groupId={params.groupId} />");
    expect(read("components/athlete/today-tiles.tsx")).toContain("const showCheckin = allowCheckin && !cardShown;");
    expect(read("components/athlete/wellness-checkin-popup.tsx")).toContain("setWellnessCardShown(cardInPage);");
  });
  it("CL5: the progress line no longer repeats the program; 'Your program' only with two or more; one program's name opens it", () => {
    const lines = buildHomeThread({ goal: null, program: { name: "Main", unscheduled: true, startDate: null, scheduledDates: [], totalWorkouts: 10, doneWorkouts: 3, pickup: null }, logDates: [], today: new Date("2026-11-21T12:00:00Z") });
    expect(lines.some((l) => l.startsWith("Main"))).toBe(false);
    // with one, only on a day the Today card does not link it (part A review, Nov 21)
    expect(read(HOME)).toContain("showProgramsBlock(homePrograms.length, dayWorkout, daySessions, isToday) ? <MyProgramsBlock");
    const program = { id: "p1", name: "Strength", week: 2, weeks: 8, done: 5, total: 24 };
    const html = renderToStaticMarkup(createElement(DayCard, { ...day, workout: { status: "planned", workoutId: "w1", title: "Day 3" }, sessions: [{ status: "planned", workoutId: "w1", title: "Day 3", programId: "p1", heading: "Strength" }], programs: [program] } as never));
    expect(html).toContain('href="/groups/g/programs/p1"');
  });
  it("CL6: the goal and streak line sits above the Today card", () => {
    const page = read(HOME);
    expect(page.indexOf("<HomeThread lines={homeThreadLines} />")).toBeLessThan(page.indexOf("<DayCard\n"));
  });
  it("CL7: an open workout that is today's own: the button says Resume workout and no second card", () => {
    const html = renderToStaticMarkup(createElement(DayCard, { ...day, workout: { status: "planned", workoutId: "w1", title: "Day 3" }, resume: { sessionId: "s1", workoutId: "w1" } } as never));
    expect(html).toContain("Resume workout");
    expect(html).toContain('href="/sessions/s1?resume=1"');
    expect(html).not.toContain("Start workout");
    expect(read(HOME)).toContain("{openOwnSession && !openIsTodays && (");
  });
  it("CL8: the weekly check-in and the goal look sit right under the workout and the tiles", () => {
    const card = read("components/athlete/day-card.tsx");
    expect(card.indexOf("{asks}")).toBeLessThan(card.indexOf("<TodayWidget"));
    expect(read(HOME)).toContain("asks={");
  });
  it("CL11: one row opens Messages, under today; the coaching staff list is gone for clients", () => {
    expect(messageCoachLabel("Ron Arnold")).toBe("Message Ron");
    expect(messageCoachLabel(null)).toBe("Message your coach");
    const page = read(HOME);
    expect(page).toContain("data-message-coach");
    expect(page).toContain("{renderAsCoach && (\n        <RosterList");
  });
  it("CL12: no notifications chip after the guide is dismissed", () => {
    expect(read(HOME)).not.toContain('<PushNotificationToggle variant="chip"');
  });
  it("CL22: the Nutrition card shows eaten of target and opens Nutrition", () => {
    const html = renderToStaticMarkup(createElement(TodayWidget, { todayDate: "2026-11-21", macros: { calories: 2200, proteinG: 180, carbsG: 220, fatG: 70 }, habits: [], mealHref: "/groups/g/nutrition", eaten: { calories: 1240.4, proteinG: 96, carbsG: 120, fatG: 40 } }));
    expect(html).toContain("Eaten today");
    expect(html).toContain("1,240");
    expect(html).toContain("of 2,200");
    expect(html).toContain('href="/groups/g/nutrition"');
    expect(shownNumber(null)).toBe("--");
  });
});

describe("Settings", () => {
  const s = read(SETTINGS);
  it("CL2: More sits right under the name (and not at the bottom); not on a coach's own settings (DK16)", () => {
    expect(s.indexOf("data-settings-more")).toBeLessThan(s.indexOf('<SettingsGroup label="Profile">'));
    expect(s).toContain("const showMore = !isCoach || effective.isActingAsOther;");
    expect(s).not.toContain('<SettingsGroup label="More">');
  });
  it("CL21: no '← Home' on Settings, Nutrition or Feed (they are tabs)", () => {
    for (const f of [SETTINGS, NUTRITION, "app/(coach)/groups/[groupId]/feed/page.tsx"]) expect(read(f), f).not.toContain("&larr; Home");
  });
  it("CL23: Text messages and Devices are their own groups, and Workout logging reads plainly", () => {
    expect(s).toContain('<SettingsGroup label="Text messages">');
    expect(s).toContain('<SettingsGroup label="Devices">');
    expect(s).toContain('<SettingsGroup label="Workout logging">');
    expect(s).not.toContain("Text messages & devices");
  });
  it("DK14 / DK15: one link each, to Organization > Labels and > Team", () => {
    expect(s).toContain("branding?tab=labels");
    expect(s).toContain("branding?tab=team");
    expect(s).not.toContain("See your coaches and invite one");
  });
  it("DK16: the group switches name the group they change", () => {
    expect(s).toContain("data-group-switches");
    expect(s).toContain('For {(group as { name?: string } | null)?.name ?? "this group"} only');
  });
  it("PH16: an Admin fold for the platform admin only, with Support inbox, Organizations and Recipe ingredients", () => {
    expect(s).toContain("{isPlatformAdmin && !effective.isActingAsOther && (");
    for (const href of ["/admin/support", "/admin/organizations", "/admin/nutrition-ingredients"]) expect(s).toContain(`"${href}"`);
  });
  it("PH23: the get-the-app button is not shown on a phone or in the installed app", () => {
    const mm = (hits: string[]) => ({ matchMedia: (q: string) => ({ matches: hits.includes(q) }) }) as unknown as Window;
    expect(isPhoneOrInstalled(mm(["(display-mode: standalone)"]))).toBe(true);
    expect(isPhoneOrInstalled(mm(["(max-width: 767px)"]))).toBe(true);
    // a tablet (wider than a phone, not the installed app) still shows it
    expect(isPhoneOrInstalled(mm(["(pointer: coarse)"]))).toBe(false);
    expect(isPhoneOrInstalled(mm([]))).toBe(false);
  });
});

describe("Nutrition", () => {
  const n = read(NUTRITION);
  it("CL3: the reasoning card, the charts and the meal-plan placeholder show only with something in them", () => {
    expect(n).toContain("{macrosEnabled && latestCheckin && (");
    expect(canDrawTrend([])).toBe(false);
    expect(canDrawTrend([{}, {}])).toBe(true);
    expect(n.match(/canDrawTrend\(/g)?.length).toBe(3);
    expect(read("components/athlete/meal-checkoff-list.tsx")).toContain("if (meals.length === 0) return null;");
  });
  it("CL4: no second grid of the same targets (youth mode keeps its protein-first view)", () => {
    expect(n).not.toContain('<p className="font-body text-xs text-steel mt-1">Kcal</p>');
    expect(n).toContain("{macrosEnabled && (setMyTargets || (youthMode && todayMacros?.proteinG != null)) && (");
  });
  it("DK7: the youth switch only for a team or social group, and it names the group", () => {
    expect(n).toContain('group_kind === "team" || (group as { group_kind?: string | null } | null)?.group_kind === "social"');
    expect(read("components/coach/desktop/nutrition-youth-mode-toggle.tsx")).toContain('{groupName ? ` for ${groupName}` : ""}');
  });
});

describe("Elsewhere in the client app", () => {
  it("CL15: one Book per open time, every week inside its confirm step", () => {
    for (const f of ["app/(coach)/groups/[groupId]/calendar/[date]/page.tsx", "app/(coach)/groups/[groupId]/programs/[programId]/calendar/[date]/page.tsx"]) {
      expect(read(f), f).not.toContain("<RecurringBookingButton");
      expect(read(f), f).toContain("weekly={{ durationMinutes }}");
    }
    expect(read("components/athlete/book-slot-button.tsx")).toContain("Make it every week →");
  });
  it("CL16: one line while moving a session, and the coach decides a late one", () => {
    const d = new Date("2026-11-25T15:00:00Z");
    expect(rescheduleLine(d, true)).toMatch(/^Pick a new time for your .* session\. Your coach confirms it\.$/);
    expect(rescheduleLine(d, false)).toContain("your coach decides whether it counts as a session");
  });
  it("CL18: Swap, Remove and Change what I log behind one '⋯' on the exercise", () => {
    const c = read("components/logging/exercise-card.tsx");
    expect(c).toContain('aria-label="More for this exercise"');
    expect(c).toContain("Change what I log");
    expect(c).not.toMatch(/>\s*Edit metrics\s*</);
  });
  it("CL19 (since goals, all in one, Nov 23): the goal page is one form, and words the history", () => {
    const g = read("app/(coach)/groups/[groupId]/goal/page.tsx");
    expect(g).toContain("<GoalsForm");
    expect(g).not.toContain("data-goal-propose");
    expect(g).toContain("Earlier goals");
    expect(goalStatusWords("proposed")).toBe("Waiting on your coach");
    expect(goalStatusWords("declined")).toBe("Not approved");
    expect(goalStatusWords("confirmed")).toBe("Confirmed");
  });
  it("CL20: one photos entry, no Macro calculator when the coach sets targets, no Hall of fame one-on-one", () => {
    const links = (o: Partial<Parameters<typeof buildMoreSections>[0]>) => buildMoreSections({ groupId: "g", athleteId: "a", isCoach: false, historyImportEnabled: false, ...o }).flatMap((s) => s.links.map((l) => l.label));
    expect(links({})).not.toContain("My progress photos");
    expect(links({ coachSetsTargets: true })).not.toContain("Macro calculator");
    expect(links({ coachSetsTargets: false })).toContain("Macro calculator");
    expect(links({ oneOnOne: true })).not.toContain("Hall of fame");
    expect(buildMoreSections({ groupId: "g", athleteId: "a", isCoach: false, historyImportEnabled: false, coachSetsTargets: true }).every((s) => s.links.length > 0)).toBe(true);
  });
  it("CL24: plain words on My exercise history", () => {
    expect(read("app/(coach)/groups/[groupId]/my-history/page.tsx")).toContain("helps your coach build your program from where you are now.");
  });
  it("PH13: the Spotlight notifications tile is not shown when the phone blocks them", () => {
    expect(read("components/athlete/push-notification-toggle.tsx")).toContain('state === "unsupported" || state === "denied") return null;');
  });
});
