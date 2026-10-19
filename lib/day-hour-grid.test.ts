import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { blockBox, DayHourGrid } from "@/components/coach/desktop/day-hour-grid";

const LA = "America/Los_Angeles";
// Ron's Monday Oct 19 on his phone: 55-minute sessions at 6, 8, 9 and 10 AM (PDT = UTC-7).
const session = (id: string, startUtc: string, label: string) => ({ id, start: new Date(startUtc), end: new Date(new Date(startUtc).getTime() + 55 * 60000), label });
const bookings = [
  session("a", "2026-10-19T13:00:00Z", "Oliver Bourne"),
  session("b", "2026-10-19T15:00:00Z", "Johann Gorsek"),
  session("c", "2026-10-19T16:00:00Z", "Cindie Downing"),
  session("d", "2026-10-19T17:00:00Z", "Hewan Belete"),
];

describe("a session is drawn from the line of its start time for exactly its length", () => {
  it("one pixel per minute: a 6:00 session of 55 minutes starts at the 6 AM line and ends 5 px short of the 7 AM line", () => {
    expect(blockBox(6 * 60, 6 * 60 + 55, 5 * 60)).toEqual({ top: 60, height: 55 });
    expect(blockBox(8 * 60, 8 * 60 + 55, 5 * 60)).toEqual({ top: 180, height: 55 });
    expect(blockBox(9 * 60, 9 * 60 + 55, 5 * 60)).toEqual({ top: 240, height: 55 });
  });
  it("a very short block is still tall enough to read", () => {
    expect(blockBox(600, 605, 300).height).toBe(18);
  });
  it("the hour line, its label and the block share one origin: the 6 AM line, label and block all sit at 60px", () => {
    const html = renderToStaticMarkup(createElement(DayHourGrid, { windows: [], bookings, events: [], timeZone: LA }));
    expect(html.match(/top:60px/g)?.length).toBe(3); // the 6 AM label, the 6 AM line and the 6 AM session
    expect(html).toContain("top:60px;height:55px");
    expect(html).toContain("top:180px;height:55px");
    expect(html).toContain("top:240px;height:55px");
    expect(html).toContain("top:300px;height:55px");
  });
  it("the hour labels are centered on their lines, and the first one has room above it so the grid's top border does not cut it", () => {
    const html = renderToStaticMarkup(createElement(DayHourGrid, { windows: [], bookings, events: [], timeZone: LA }));
    expect(html.match(/-translate-y-1\/2/g)?.length).toBe(8); // 5 AM .. 12 PM
    expect(html).toContain("5 AM");
    expect(html).toContain("padding-top:12px");
    expect(html).toContain("padding-bottom:12px");
  });
});
