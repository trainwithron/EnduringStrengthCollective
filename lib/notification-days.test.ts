import { describe, expect, it } from "vitest";
import { groupNotificationsByDay, timeAgo } from "./notification-days";

const n = (id: string, createdAt: string) => ({ id, createdAt });

describe("groupNotificationsByDay", () => {
  const now = new Date("2026-10-05T23:30:00Z"); // 7:30pm Eastern on Oct 5
  it("groups by the viewer's own day, newest first, with Today and Yesterday", () => {
    const groups = groupNotificationsByDay(
      [n("old", "2026-10-01T15:00:00Z"), n("today-late", "2026-10-05T22:00:00Z"), n("yday", "2026-10-04T18:00:00Z"), n("today-early", "2026-10-05T13:00:00Z")],
      "America/New_York",
      now
    );
    expect(groups.map((g) => g.label)).toEqual(["Today", "Yesterday", "Thu, Oct 1"]);
    expect(groups[0].items.map((i) => i.id)).toEqual(["today-late", "today-early"]);
  });
  it("uses the viewer's zone, not UTC, to decide what day something happened", () => {
    // 1:30am UTC on Oct 6 is 9:30pm Eastern on Oct 5: still "Today" for them.
    const groups = groupNotificationsByDay([n("late", "2026-10-06T01:30:00Z")], "America/New_York", new Date("2026-10-06T02:00:00Z"));
    expect(groups.map((g) => g.label)).toEqual(["Today"]);
  });
  it("returns nothing for nothing", () => {
    expect(groupNotificationsByDay([], "America/New_York", now)).toEqual([]);
  });
});

describe("timeAgo", () => {
  const now = new Date("2026-10-05T12:00:00Z");
  it("reads in minutes, hours and days", () => {
    expect(timeAgo("2026-10-05T11:59:40Z", now)).toBe("just now");
    expect(timeAgo("2026-10-05T11:48:00Z", now)).toBe("12m ago");
    expect(timeAgo("2026-10-05T09:00:00Z", now)).toBe("3h ago");
    expect(timeAgo("2026-10-03T12:00:00Z", now)).toBe("2d ago");
  });
});
