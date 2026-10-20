import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Render the list once folded and once opened (no browser here: the open state is set through useState).
let opened = false;
vi.mock("react", async (orig) => {
  const real = await orig<typeof import("react")>();
  return { ...real, useState: (init: unknown) => (opened ? [true, () => {}] : real.useState(init)) };
});
const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { UpcomingSessionsList } = await import("./upcoming-sessions-list");

const rows = Array.from({ length: 10 }, (_, i) => ({ id: `b${i}`, name: `Client ${i + 1}`, when: `Oct ${20 + i}, 9:00 AM` }));
const render = (r = rows) => renderToStaticMarkup(createElement(UpcomingSessionsList, { rows: r }));

// Ron, Oct 19: "The calendar looks good, but the upcoming sessions is it's long and could be collapsed."
describe("coach phone Calendar: upcoming sessions fold", () => {
  it("shows the first 3 and one quiet row with the count", () => {
    opened = false;
    const html = render();
    expect(html).toContain("Client 3");
    expect(html).not.toContain("Client 4");
    expect(html).toContain("Show all 10 upcoming");
    expect(html).toContain('aria-expanded="false"');
  });
  it("opened: every row, and Show fewer", () => {
    opened = true;
    const html = render();
    expect(html).toContain("Client 10");
    expect(html).toContain("Show fewer");
    opened = false;
  });
  it("3 or fewer: no toggle", () => {
    expect(render(rows.slice(0, 3))).not.toContain("Show all");
  });
  it("the coach phone Calendar uses it with the same rows", () => {
    const src = readFileSync(join(__dirname, "calendar-page-body.tsx"), "utf8");
    expect(src).toContain('<UpcomingSessionsList rows={upcomingBookings.map((b) => ({ id: b.id, name: b.athleteName, when: formatInTimezone(new Date(b.startAt), coachTz, "dateTime") }))} />');
  });
});
