import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEVICE_TZ_COOKIE, readDeviceZoneCookie, resolveDisplayZone, zoneLabel } from "./display-timezone";
import { formatInTimezone } from "./format-in-timezone";
import { generateSlotsForDate } from "./booking-slots";
import { localDateKey, zonedLocalInputToUtc } from "./timezone";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");

describe("what zone a coach reads times in", () => {
  it("the device zone when it is valid, else the saved zone, else the default", () => {
    expect(resolveDisplayZone("America/Chicago", "America/Los_Angeles")).toBe("America/Chicago");
    expect(resolveDisplayZone(null, "America/Los_Angeles")).toBe("America/Los_Angeles");
    expect(resolveDisplayZone("Not/AZone", "America/Los_Angeles")).toBe("America/Los_Angeles");
    expect(resolveDisplayZone(null, null)).toBe("America/New_York");
  });
  it("reads the device-zone cookie, URL-encoded or not, and ignores a bad value", () => {
    expect(readDeviceZoneCookie(`a=1; ${DEVICE_TZ_COOKIE}=America%2FChicago; b=2`)).toBe("America/Chicago");
    expect(readDeviceZoneCookie(`${DEVICE_TZ_COOKIE}=America/Chicago`)).toBe("America/Chicago");
    expect(readDeviceZoneCookie(`${DEVICE_TZ_COOKIE}=nonsense`)).toBeNull();
    expect(readDeviceZoneCookie("a=1")).toBeNull();
    expect(readDeviceZoneCookie(null)).toBeNull();
  });
  it("names a zone in plain words for the one-line note", () => {
    const october = new Date("2026-10-09T18:00:00Z");
    const january = new Date("2027-01-15T18:00:00Z");
    expect(zoneLabel("America/Chicago", october)).toBe("Central time");
    expect(zoneLabel("America/Chicago", january)).toBe("Central time");
    expect(zoneLabel("America/Los_Angeles", october)).toBe("Pacific time");
    expect(zoneLabel("UTC", october)).toBe("UTC");
  });
});

describe("a coach who travels: hours stay put, only the reading zone moves", () => {
  // Ron's example: open 9 to 5 in his Pacific business zone.
  const windows = [{ weekday: 1, startTime: "09:00", endTime: "17:00", slotDurationMinutes: 60 }];
  const monday = new Date("2026-10-12T00:00:00");
  const slots = generateSlotsForDate(monday, windows, [], "America/Los_Angeles");

  it("9 to 5 Pacific reads 11 to 7 on a Central device, and 9 to 5 on a Pacific one", () => {
    expect(formatInTimezone(slots[0].start, "America/Los_Angeles", "time")).toBe("9:00 AM");
    expect(formatInTimezone(slots[0].start, "America/Chicago", "time")).toBe("11:00 AM");
    expect(formatInTimezone(slots[slots.length - 1].start, "America/Chicago", "time")).toBe("6:00 PM");
  });
  it("a client in Pacific sees the same session two hours earlier than a coach in Central", () => {
    const session = slots[2].start;
    expect(formatInTimezone(session, "America/Chicago", "time")).toBe("1:00 PM");
    expect(formatInTimezone(session, "America/Los_Angeles", "time")).toBe("11:00 AM");
  });
  it("the booked moments are the same instants whatever zone anyone reads them in", () => {
    const again = generateSlotsForDate(monday, windows, [], "America/Los_Angeles");
    expect(again.map((s) => s.start.toISOString())).toEqual(slots.map((s) => s.start.toISOString()));
    expect(slots[0].start.toISOString()).toBe("2026-10-12T16:00:00.000Z");
  });
  it("slots and availability never read the display zone", () => {
    for (const file of ["lib/booking-slots.ts", "lib/timezone.ts"]) {
      expect(read(file)).not.toContain("display-timezone");
    }
  });
});

describe("time off is entered in the coach's saved zone, not the browser's", () => {
  it("9:00 typed for a Pacific business reads as 9:00 Pacific whatever the device zone", () => {
    expect(zonedLocalInputToUtc("2026-10-09T09:00", "America/Los_Angeles").toISOString()).toBe("2026-10-09T16:00:00.000Z");
    expect(zonedLocalInputToUtc("2026-10-09T09:00", "America/Chicago").toISOString()).toBe("2026-10-09T14:00:00.000Z");
  });
  it("the manager converts and shows it in that zone, checks a recurring end, and rolls a failed delete back", () => {
    const src = read("components/coach/desktop/availability-exceptions-manager.tsx");
    expect(src).toContain("zonedLocalInputToUtc(oneOffStart, timezone).toISOString()");
    expect(src).toContain("zonedLocalInputToUtc(oneOffEnd, timezone).toISOString()");
    expect(src).not.toContain("new Date(oneOffStart)");
    expect(src).not.toContain("toLocaleString(undefined");
    expect(src).toContain("recurEnd <= recurStart");
    expect(src).toContain("setExceptions(before)");
    expect(read("app/(coach)/groups/[groupId]/availability/page.tsx")).toContain("timezone={coachProfile?.timezone ?? DEFAULT_COACH_TIMEZONE}");
  });
});

describe("today means the coach's own day", () => {
  it("an evening is still today, not tomorrow", () => {
    expect(localDateKey(new Date(2026, 9, 9, 21, 30))).toBe("2026-10-09");
    expect(localDateKey(new Date(2026, 9, 9, 0, 5))).toBe("2026-10-09");
  });
  it("the assign start date and the discovery date use it, not the UTC date", () => {
    const menu = read("components/coach/desktop/program-card-menu.tsx");
    expect(menu).toContain("return localDateKey();");
    expect(menu).not.toContain("new Date().toISOString().slice(0, 10)");
    const flow = read("components/public/discovery-booking-flow.tsx");
    expect(flow).toContain("return localDateKey();");
    expect(flow).not.toContain("new Date().toISOString().slice(0, 10)");
  });
});

describe("the device zone is display only", () => {
  it("never overwrites a saved zone: the only write is the first fill when none is saved", () => {
    const src = read("components/timezone-capture.tsx");
    expect(src.match(/update\(\{ timezone/g)?.length).toBe(1);
    expect(src).toContain("if (!profile.timezone) {\n        await supabase.from(\"profiles\").update({ timezone: detected })");
    expect(src).toContain("document.cookie = `${DEVICE_TZ_COOKIE}=");
  });
  it("the note appears only for a coach whose device zone differs, and can be dismissed", () => {
    const src = read("components/timezone-capture.tsx");
    expect(src).toContain('.eq("role", "coach")');
    expect(src).toContain("if (detected !== saved)");
    expect(src).toContain("Now showing {zoneLabel(noteZone)}");
    expect(src).toContain('aria-label="Dismiss"');
  });
  it("the server pages the coach reads dates on use the device zone", () => {
    for (const file of [
      "app/(coach)/groups/[groupId]/athletes/[athleteId]/page.tsx",
      "app/(coach)/groups/[groupId]/athletes/[athleteId]/calendar/[date]/page.tsx",
      "app/(coach)/groups/[groupId]/business/page.tsx",
      "app/dispatch/[stepId]/page.tsx",
      "app/print/programs/[programId]/page.tsx",
    ]) {
      expect(read(file)).toContain("getViewerDisplayTimezone(supabase, user.id)");
    }
    expect(read("app/dispatch/[stepId]/page.tsx")).not.toContain("toLocaleString()");
    expect(read("app/(coach)/groups/[groupId]/athletes/[athleteId]/page.tsx")).not.toMatch(/Joined \{new Date\(athleteMembership\.joined_at\)\.toLocaleDateString\(\)\}/);
  });
});

describe("getViewerDisplayTimezone", () => {
  const profile = (tz: string | null) => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { timezone: tz } }) }) }) }),
  });
  async function run(cookieValue: string | undefined, saved: string | null) {
    vi.resetModules();
    vi.doMock("next/headers", () => ({ cookies: async () => ({ get: () => (cookieValue === undefined ? undefined : { value: cookieValue }) }) }));
    const { getViewerDisplayTimezone } = await import("./display-timezone-server");
    return getViewerDisplayTimezone(profile(saved) as any, "u1");
  }
  it("the cookie wins; without one the saved zone; a bad cookie is ignored", async () => {
    expect(await run("America%2FChicago", "America/Los_Angeles")).toBe("America/Chicago");
    expect(await run(undefined, "America/Los_Angeles")).toBe("America/Los_Angeles");
    expect(await run("junk", "America/Los_Angeles")).toBe("America/Los_Angeles");
    expect(await run(undefined, null)).toBe("America/New_York");
  });
});
