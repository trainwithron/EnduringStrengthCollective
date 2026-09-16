import { describe, expect, it } from "vitest";
import { mapPersonalEventsResponse } from "./google-calendar";

describe("mapPersonalEventsResponse", () => {
  it("returns an empty array for undefined/non-array input", () => {
    expect(mapPersonalEventsResponse(undefined)).toEqual([]);
  });

  it("maps a real timed event", () => {
    const result = mapPersonalEventsResponse([
      {
        id: "evt1",
        summary: "Dentist",
        start: { dateTime: "2026-09-20T14:00:00-07:00" },
        end: { dateTime: "2026-09-20T15:00:00-07:00" },
      },
    ]);
    expect(result).toEqual([
      {
        externalEventId: "evt1",
        title: "Dentist",
        startAt: "2026-09-20T14:00:00-07:00",
        endAt: "2026-09-20T15:00:00-07:00",
      },
    ]);
  });

  it("falls back to a generic title when summary is missing", () => {
    const result = mapPersonalEventsResponse([
      {
        id: "evt2",
        start: { dateTime: "2026-09-20T14:00:00-07:00" },
        end: { dateTime: "2026-09-20T15:00:00-07:00" },
      },
    ]);
    expect(result[0].title).toBe("Busy");
  });

  it("skips cancelled events", () => {
    const result = mapPersonalEventsResponse([
      {
        id: "evt3",
        status: "cancelled",
        start: { dateTime: "2026-09-20T14:00:00-07:00" },
        end: { dateTime: "2026-09-20T15:00:00-07:00" },
      },
    ]);
    expect(result).toEqual([]);
  });

  it("skips all-day events (date-only, no dateTime)", () => {
    const result = mapPersonalEventsResponse([
      {
        id: "evt4",
        summary: "Vacation",
        start: { date: "2026-09-20" },
        end: { date: "2026-09-21" },
      },
    ]);
    expect(result).toEqual([]);
  });

  it("skips malformed entries missing an id", () => {
    const result = mapPersonalEventsResponse([
      {
        summary: "No id",
        start: { dateTime: "2026-09-20T14:00:00-07:00" },
        end: { dateTime: "2026-09-20T15:00:00-07:00" },
      },
    ]);
    expect(result).toEqual([]);
  });
});
