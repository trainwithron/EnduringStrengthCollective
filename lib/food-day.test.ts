import { describe, it, expect } from "vitest";
import { daysBetween, foodDayHeading, foodDayHref, foodDayLabel, foodDaySwitcher, loggedTotalsTitle, shownFoodDay } from "./food-day";
import { dateKeyInZone } from "./timezone";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const TODAY = "2026-10-20";

describe("the day Today's food shows", () => {
  it("is today unless the address asks for a real day within a week either side", () => {
    expect(shownFoodDay(undefined, TODAY)).toBe(TODAY);
    expect(shownFoodDay("2026-10-19", TODAY)).toBe("2026-10-19");
    expect(shownFoodDay("2026-10-13", TODAY)).toBe("2026-10-13"); // 7 back
    expect(shownFoodDay("2026-10-27", TODAY)).toBe("2026-10-27"); // 7 ahead
    expect(shownFoodDay("2026-10-12", TODAY)).toBe(TODAY); // 8 back
    expect(shownFoodDay("2026-10-28", TODAY)).toBe(TODAY); // 8 ahead
    for (const bad of ["", "yesterday", "2026-10-1", "2026-02-30", "2026-13-01", "2026-10-19T00:00"]) expect(shownFoodDay(bad, TODAY), bad).toBe(TODAY);
  });
  it("counts calendar days across a month and a year end", () => {
    expect(daysBetween("2026-10-31", "2026-11-01")).toBe(1);
    expect(daysBetween("2026-12-31", "2027-01-01")).toBe(1);
    expect(shownFoodDay("2026-11-03", "2026-10-31")).toBe("2026-11-03");
    // the clock change (Nov 1 in the US) does not move a calendar day
    expect(daysBetween("2026-10-31", "2026-11-02")).toBe(2);
  });
  it("today is the person's own calendar day: 6:30 PM in Las Vegas on Oct 19 is still Oct 19 (01:30 UTC on Oct 20)", () => {
    const now = new Date("2026-10-20T01:30:00Z");
    const today = dateKeyInZone("America/Los_Angeles", now);
    expect(today).toBe("2026-10-19");
    expect(foodDaySwitcher(today, today).prev?.key).toBe("2026-10-18");
    expect(foodDaySwitcher(today, today).next?.key).toBe("2026-10-20");
  });
});

describe("the switcher", () => {
  it("on today: ‹ Yesterday · Today · Tomorrow ›", () => {
    const s = foodDaySwitcher(TODAY, TODAY);
    expect(s).toEqual({ prev: { key: "2026-10-19", label: "Yesterday" }, current: "Today", next: { key: "2026-10-21", label: "Tomorrow" }, isToday: true });
  });
  it("names other days by their date, and stops at a week either side", () => {
    expect(foodDayLabel("2026-10-13", TODAY)).toBe("Tue, Oct 13");
    const back = foodDaySwitcher("2026-10-13", TODAY);
    expect(back.prev).toBeNull();
    expect(back.next).toEqual({ key: "2026-10-14", label: "Wed, Oct 14" });
    const ahead = foodDaySwitcher("2026-10-27", TODAY);
    expect(ahead.next).toBeNull();
    expect(ahead.prev?.key).toBe("2026-10-26");
  });
  it("links: today has no ?day=, any other day does", () => {
    expect(foodDayHref("g1", TODAY, TODAY)).toBe("/groups/g1/nutrition");
    expect(foodDayHref("g1", "2026-10-19", TODAY)).toBe("/groups/g1/nutrition?day=2026-10-19");
  });
  it("the section and the totals say which day it is", () => {
    expect(foodDayHeading("2026-10-19", TODAY)).toBe("Yesterday's food");
    expect(foodDayHeading("2026-10-15", TODAY)).toBe("Food for Thu, Oct 15");
    expect(loggedTotalsTitle(TODAY, TODAY)).toBe("Logged so far today");
    expect(loggedTotalsTitle("2026-10-21", TODAY)).toBe("Logged tomorrow");
  });
});

describe("the page uses the day for everything in Today's food", () => {
  const page = readFileSync(join(__dirname, "..", "app/(coach)/groups/[groupId]/nutrition/page.tsx"), "utf8").replace(/\r\n/g, "\n");
  const section = readFileSync(join(__dirname, "..", "components/athlete/food-log-section.tsx"), "utf8").replace(/\r\n/g, "\n");
  const entries = readFileSync(join(__dirname, "..", "components/athlete/food-log-entries.tsx"), "utf8").replace(/\r\n/g, "\n");
  it("logging, the plan cards, what was logged and the nutrients all read the shown day; a new day is a fresh section", () => {
    expect(page).toContain("const shownDay = trackingOn ? shownFoodDay(searchParams.day, todayKey) : todayKey;");
    expect(page).toContain("fetchFoodLogDay(supabase, athleteId, shownDay)");
    expect(page).toContain('.eq("log_date", shownDay)');
    expect(page).toContain("logDate={shownDay}");
    expect(page).toContain("key={shownDay}");
    expect(page).toContain("<FoodDaySwitcher groupId={params.groupId} shownKey={shownDay} todayKey={todayKey} />");
    expect(page).toContain("fetchNutrientLog(supabase, athleteId, shownDay)");
    // Today's targets stay on today
    expect(page).toContain(".eq(\"log_date\", todayKey)");
    expect(section).toContain("todayKey={logDate}");
  });
  it("Copy yesterday copies from the day before the shown day", () => {
    expect(entries).toContain("fetchFoodLogDay(supabase, athleteId, addDaysToKey(logDate, -1))");
    expect(entries).toContain("copyRows(yesterday, { athleteId, groupId, toDate: logDate })");
  });
  it("the switcher is plain 44 px links in the address, with no new page", () => {
    const sw = readFileSync(join(__dirname, "..", "components/athlete/food-day-switcher.tsx"), "utf8");
    expect(sw).toContain("min-h-[44px]");
    expect(sw).toContain("scroll={false}");
    expect(sw).toContain("foodDayHref(groupId,");
  });
});
