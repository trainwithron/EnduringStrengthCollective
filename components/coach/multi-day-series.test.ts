import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (rel: string) => readFileSync(join(__dirname, "..", "..", rel), "utf8").replace(/\r\n/g, "\n");

describe("several weekly days at once", () => {
  const form = read("components/coach/series-schedule-form.tsx");

  it("has day rows with their own weekday and time, an Add another day button and a way to remove a row", () => {
    expect(form).toContain("Add another day");
    expect(form).toContain("aria-label={`Time for day ${i + 1}`}");
    expect(form).toContain("aria-label={`Day ${i + 1} of the week`}");
    expect(form).toContain("aria-label={`Remove day ${i + 1}`}");
  });

  it("creates ONE weekly series per row (one request each, in order), so each can be paused or ended alone", () => {
    expect(form).toContain("for (let i = 0; i < rows.length; i++)");
    expect(form.match(/fetch\("\/api\/series"/g)?.length).toBe(1);
    expect(form).toContain("made.push(dayName)");
  });

  it("offers Until their sessions run out, capped at 52 weeks, planned across all rows", () => {
    expect(form).toContain("Until their sessions run out");
    expect(form).toContain('mode === "runout" ? 52 : count');
    expect(form).toContain("planRunOut(rowDates, unticked, sessionsToBook ?? 0)");
  });

  it("No end date is exactly as before and stays available for every client (no subscriber check, no change to the daily top-up)", () => {
    expect(form).toContain("No end date");
    expect(form).toContain("Always kept booked 12 weeks ahead. Pause or end it any time.");
    expect(form).not.toMatch(/subscri/i);
    expect(form).toContain('mode: mode === "ongoing" ? ("ongoing" as const) : ("fixed" as const)');
    // The server side of a series did not change for this.
    expect(read("app/api/series/route.ts")).not.toContain("runout");
    expect(read("lib/series-route.ts")).not.toContain("runout");
  });

  it("keeps the preview, the capitalised weekday labels and the coach-zone wall clock", () => {
    expect(form).toContain("{weekdayName}</span>}</legend>");
    expect(form).toContain('const WEEKDAYS = ["Sundays", "Mondays"');
    expect(form).toContain("zonedTimeToUtc(dateKey, r.time, timezone)");
    expect(form).toContain("will be booked");
  });
});
