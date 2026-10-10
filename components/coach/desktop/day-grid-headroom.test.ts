import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (rel: string) => readFileSync(join(__dirname, "..", "..", "..", rel), "utf8").replace(/\r\n/g, "\n");

describe("the expanded day grid shows its first hour and has no scrollbar thumb", () => {
  const grid = read("components/coach/desktop/day-time-grid.tsx");

  it("leaves headroom above the first hour so its label is not clipped", () => {
    expect(grid).toContain("const GRID_HEADROOM_PX = 12;");
    expect(grid).toContain("paddingTop: GRID_HEADROOM_PX");
  });

  it("opens scrolled so the earliest working hour sits just below the top edge", () => {
    expect(grid).toContain("offsetFromMinute(firstBusyMin, range) + GRID_HEADROOM_PX - 24");
  });

  it("hides the scrollbar thumb but stays scrollable and keyboard reachable", () => {
    expect(grid).toContain("overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden");
    expect(grid).toContain("tabIndex={0}");
  });

  it("the day panel's own scroller hides its thumb too", () => {
    expect(read("components/coach/desktop/expanded-day-scheduler.tsx")).toContain("[scrollbar-width:none] [&::-webkit-scrollbar]:hidden");
  });
});
