import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { panMetrics, scrollForThumb } from "@/lib/pan-strip";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");

describe("the week pan strip", () => {
  it("shows nothing to pan when the days fit", () => {
    expect(panMetrics(0, 1200, 1200, 1200).overflowing).toBe(false);
    expect(panMetrics(0, 1200, 1100, 1200).overflowing).toBe(false);
  });
  it("sizes the thumb to the visible share and keeps it inside the track", () => {
    const start = panMetrics(0, 1000, 2000, 1000);
    expect(start.overflowing).toBe(true);
    expect(start.thumbWidth).toBe(500);
    expect(start.thumbLeft).toBe(0);
    const end = panMetrics(1000, 1000, 2000, 1000);
    expect(end.thumbLeft + end.thumbWidth).toBeCloseTo(1000);
    const past = panMetrics(5000, 1000, 2000, 1000);
    expect(past.thumbLeft + past.thumbWidth).toBeLessThanOrEqual(1000.0001);
  });
  it("never makes the thumb too small to grab", () => {
    expect(panMetrics(0, 300, 30000, 600).thumbWidth).toBeGreaterThanOrEqual(28);
  });
  it("dragging the thumb maps back to a scroll position (and round-trips)", () => {
    expect(scrollForThumb(0, 1000, 2000, 1000)).toBe(0);
    expect(scrollForThumb(500, 1000, 2000, 1000)).toBe(1000);
    expect(scrollForThumb(-50, 1000, 2000, 1000)).toBe(0);
    expect(scrollForThumb(900, 1000, 2000, 1000)).toBe(1000);
    const m = panMetrics(400, 1000, 2000, 1000);
    expect(scrollForThumb(m.thumbLeft, 1000, 2000, 1000)).toBeCloseTo(400);
  });
});

describe("the program builder uses the full width", () => {
  it("the shell takes a wide option and the builder page uses it", () => {
    const shell = read("components/coach/coach-desktop-shell.tsx");
    expect(shell).toContain("wide = false");
    expect(shell).toContain('${wide ? "" : "max-w-[1400px]"}');
    expect(read("app/(coach)/groups/[groupId]/programs/[programId]/page.tsx")).toContain('active="programs" wide>');
  });
  it("a week's days share the width equally (at least 300px, at most 420px) inside the pan row, and + Day is narrow", () => {
    const grid = read("components/coach/desktop/week-grid.tsx");
    expect(grid).toContain("<WeekDayRow>");
    expect(grid).toContain("flex-[1_1_0%]");
    expect(grid).toContain("min-w-[300px] max-w-[420px]");
    expect(grid).toContain("w-[72px] shrink-0");
    expect(grid).not.toContain("w-[420px] max-w-full shrink-0");
    const row = read("components/coach/desktop/week-day-row.tsx");
    expect(row).toContain("[&::-webkit-scrollbar]:hidden");
    expect(row).toContain("e.button !== 1");
  });
});
