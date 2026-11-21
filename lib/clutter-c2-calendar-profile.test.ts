import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {} }) }));

import { ScheduleClientPicker, pickerNumber } from "@/components/coach/schedule-client-picker";
import { AddDayEventForm } from "@/components/coach/desktop/add-day-event-form";
import { calendarViewAction, readCalendarView, writeCalendarView } from "@/lib/calendar-view-memory";
import { canGoBackInApp } from "@/components/coach/back-link";

// Clutter and flow pass, Nov 21 (Ron: "fix all clutter and flow that arent my call"), part C2: the calendar, the day page and the client profile.
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const phone = read("components/coach/mobile/coach-phone-schedule.tsx");
const body = read("components/coach/calendar-page-body.tsx");
const day = read("app/(coach)/groups/[groupId]/calendar/[date]/page.tsx");
const menu = read("components/coach/session-menu.tsx");

describe("coach phone Calendar (PH4, PH5, PH26)", () => {
  it("a Today list comes first: time and name, each opening today's day page; a canceled one stays, struck through", () => {
    const schedule = phone.slice(phone.indexOf("<div data-coach-phone-schedule>"));
    expect(schedule.indexOf("data-phone-today")).toBeLessThan(schedule.indexOf("<SessionCountLine"));
    expect(schedule.indexOf("data-phone-today")).toBeLessThan(schedule.indexOf("WEEKDAY_LABELS.map"));
    expect(phone).toContain("const todayHref = `/groups/${anchorGroupId}/calendar/${todayKeyZone}`;");
    expect(phone).toContain("readCanceledSessions(supabase, userId, orgGroupIds, todayFrom, todayTo)");
    expect(schedule).toContain('"data-canceled-session": ""');
    expect(schedule).toContain("No sessions today.");
  });
  it("the client picker sits under the month, before Upcoming", () => {
    const schedule = phone.slice(phone.indexOf("<div data-coach-phone-schedule>"));
    const grid = schedule.indexOf("WEEKDAY_LABELS.map");
    const picker = schedule.indexOf("<ScheduleClientPicker");
    expect(picker).toBeGreaterThan(grid);
    expect(picker).toBeLessThan(schedule.indexOf(">Upcoming</h2>"));
  });
  it("Upcoming is one list in time order; their own workouts carry a time to sort by and open the workout", () => {
    expect(phone).toContain("upcoming: { id: string; name: string; when: string; at: string; href: string }[];");
    expect(phone).toContain("upcomingRows.sort((a, b) => a.at.localeCompare(b.at));");
    const own = body.slice(body.indexOf("const upcomingMine ="), body.indexOf("const uncoveredMine"));
    expect(own).toContain('at: zonedTimeToUtc(dateKey(d), "00:00", tz).toISOString(),');
    expect(own).toContain("href: `/groups/${params.groupId}/workouts/${w.workoutId}`,");
  });
  it("their own programs with no dates come after the schedule", () => {
    const branch = body.slice(body.indexOf("const visualsMine"), body.indexOf("if (showMobileView) {"));
    expect(branch.indexOf("<CoachPhoneSchedule")).toBeLessThan(branch.indexOf("<UndatedProgramCards"));
  });
  it("the picker says Book a client… and '3 left', with no side padding of its own", () => {
    expect(pickerNumber(5, 2)).toBe("3 left");
    const html = renderToStaticMarkup(createElement(ScheduleClientPicker, { groupId: "g", clients: [{ id: "a", fullName: "Jane Doe", balance: 3, booked: 0 }] }));
    expect(html).toContain("Book a client…");
    expect(html).toContain("Jane Doe · 3 left");
    expect(html).not.toContain(" — ");
    expect(html).not.toContain("px-5");
    expect(html).not.toContain("Calendar for</label>");
    const one = renderToStaticMarkup(createElement(ScheduleClientPicker, { groupId: "g", clients: [{ id: "a", fullName: "Jane Doe", balance: 3, booked: 0 }], selectedId: "a" }));
    expect(one).toContain("Calendar for");
    expect(one).toContain("All clients");
  });
});

describe("coach Calendar on a computer (DK28)", () => {
  it("no explanation paragraph; the last view used is remembered", () => {
    expect(body).not.toContain("A\n          client&apos;s workouts live on their own calendar");
    expect(body).toContain("<CalendarViewMemory view={view} explicit={!!(searchParams.view || searchParams.month || searchParams.week)} />");
  });
  it("remembers a view the coach picked, and a bare open goes to Week only when Week was last", () => {
    expect(calendarViewAction(null, "month", false)).toBeNull();
    expect(calendarViewAction("month", "month", false)).toBeNull();
    expect(calendarViewAction("week", "month", false)).toBe("open-week");
    expect(calendarViewAction("week", "week", true)).toBe("remember");
    expect(calendarViewAction("week", "month", true)).toBe("remember");
  });
  it("blocked storage never breaks the page", () => {
    const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(readCalendarView(blocked)).toBeNull();
    expect(() => writeCalendarView(blocked, "week")).not.toThrow();
    expect(readCalendarView(null)).toBeNull();
    const memory = read("components/coach/desktop/calendar-view-memory.tsx");
    expect(memory).toContain("try {\n      storage = window.localStorage;");
  });
});

describe("client Calendar (CL13, CL14)", () => {
  it("Book a session sits right under the pill; today's Start is a plain link with ?start=1", () => {
    const client = body.slice(body.indexOf("if (showMobileView) {"), body.indexOf("// The group and the coach's time zone"));
    expect(client.indexOf("<ScheduleCard")).toBeGreaterThan(client.indexOf("</header>"));
    expect(client.indexOf("<ScheduleCard")).toBeLessThan(client.indexOf("WEEKDAY_LABELS.map"));
    expect(client).toContain('${w.status === "done" ? "" : "?start=1"}');
  });
});

describe("coach day page (PH6, PH7, DK27, PH8)", () => {
  it("on a narrow screen the sessions come before the hour grid; side by side on a wide one as before", () => {
    expect(day).toContain('<div className="min-w-0 order-2 @4xl:order-none" data-day-hour-grid-column>');
    expect(day).toContain('<div className="min-w-0 order-1 @4xl:order-none" data-day-sessions-column>');
    expect(day.indexOf("data-day-hour-grid-column")).toBeLessThan(day.indexOf("<DayCalendar"));
  });
  it("the old 'Add a to-do or event' form is gone; a to-do with no time (the one thing the tap-a-time sheet cannot add) has a small box after the sessions", () => {
    const html = renderToStaticMarkup(createElement(AddDayEventForm, { coachId: "c", dateKey: "2026-11-21", organizationId: null }));
    expect(html).not.toContain("Add a to-do or event");
    expect(html).not.toContain('type="time"');
    expect(html).toContain('aria-label="Add a to-do"');
    expect(html).toContain("h-11");
    expect(html).not.toContain("h-9");
    expect(read("components/coach/desktop/add-day-event-form.tsx")).toContain("event_time: null,");
    const sessions = day.slice(day.indexOf("data-day-sessions-column"));
    expect(sessions.indexOf("{slots.map(")).toBeLessThan(sessions.indexOf("<AddDayEventForm"));
    expect(sessions.indexOf("Other sessions today")).toBeLessThan(sessions.indexOf("To-dos &amp; events"));
    // the sheet still adds timed events
    expect(read("components/coach/desktop/day-calendar.tsx")).toContain('kind === "event" ? "Add event"');
  });
  it("the booked row's label is the client's name at normal size; the inline Cancel is not on a narrow screen", () => {
    const row = day.slice(day.indexOf("const renderBooked ="), day.indexOf("// The coach's session caps"));
    expect(row).not.toContain("Booked —");
    expect(row).toContain('className="font-body text-[15px] font-medium text-chalk"');
    expect(row).toContain('<span className="hidden @4xl:contents" data-inline-cancel>');
    expect(row).toContain("<MarkAttendedControl");
    expect(row).toContain("<MarkNoShowToggle");
  });
  it("the session menu: Log their workout and Open profile first, Remove last and set apart", () => {
    const popup = menu.slice(menu.indexOf("function SessionMenuPopup"), menu.indexOf("function useEscape"));
    const log = popup.indexOf("Log their workout");
    const profile = popup.indexOf("Open profile");
    const reschedule = popup.indexOf('pick("reschedule")');
    const canceled = popup.indexOf("Client canceled\n");
    const remove = popup.indexOf("data-menu-remove");
    expect(log).toBeGreaterThan(-1);
    expect(log).toBeLessThan(profile);
    expect(profile).toBeLessThan(reschedule);
    expect(canceled).toBeLessThan(remove);
    expect(popup.slice(canceled, remove)).toContain('role="separator"');
    expect(popup).toContain('querySelector<HTMLElement>("[data-first-item]")');
  });
  it("canceled sessions still show on the day page and the phone month", () => {
    expect(day).toContain("data-canceled-list");
    expect(phone).toContain('className: "text-steel line-through"');
  });
});

describe("client profile Back (PH21)", () => {
  it("goes one step back inside the app, otherwise to the fallback", () => {
    expect(canGoBackInApp(3, "https://spotlightcoaching.app/my-space/home", "https://spotlightcoaching.app")).toBe(true);
    expect(canGoBackInApp(3, "https://www.google.com/", "https://spotlightcoaching.app")).toBe(false);
    expect(canGoBackInApp(1, "https://spotlightcoaching.app/x", "https://spotlightcoaching.app")).toBe(false);
    expect(canGoBackInApp(3, "", "https://spotlightcoaching.app")).toBe(false);
    expect(canGoBackInApp(1, "", "https://spotlightcoaching.app", true)).toBe(true);
    expect(canGoBackInApp(5, "https://spotlightcoaching.app/x", "https://spotlightcoaching.app", false)).toBe(false);
  });
});
