import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";

vi.mock("@/lib/supabase/client", () => ({ createBrowserClient: () => ({}) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

import { AvailabilityManagerDesktop } from "./availability-manager-desktop";
import { SessionTypeManager } from "./session-type-manager";
import { BookingTypeSelect } from "./booking-type-select";

const windows = [
  { id: "w1", weekday: 1, startTime: "06:00:00", endTime: "12:00:00", slotDurationMinutes: 60, sessionTypeId: "t1" },
  { id: "w2", weekday: 1, startTime: "12:00:00", endTime: "18:00:00", slotDurationMinutes: 60, sessionTypeId: null },
];
const types = [
  { id: "t1", name: "Online" },
  { id: "t2", name: "In person" },
];
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("session types on hours", () => {
  it("each window can be given one of the coach's own types, shown on its row, and 'Any' is the default", () => {
    const html = renderToStaticMarkup(createElement(AvailabilityManagerDesktop, { coachId: "c", initialWindows: windows, sessionTypes: types, sessionTypeEnabled: true }));
    expect(html).toContain("Session type (optional)");
    expect(html).toContain(">Any</option>");
    expect(html).toContain("Online");
    expect(html).toContain("In person");
    expect(html).toContain("· Online");
  });
  it("hidden until the database update is applied, or when the coach has no types yet", () => {
    expect(renderToStaticMarkup(createElement(AvailabilityManagerDesktop, { coachId: "c", initialWindows: windows, sessionTypes: types, sessionTypeEnabled: false }))).not.toContain("Session type (optional)");
    expect(renderToStaticMarkup(createElement(AvailabilityManagerDesktop, { coachId: "c", initialWindows: windows, sessionTypes: [], sessionTypeEnabled: true }))).not.toContain("Session type (optional)");
  });
  it("the tag is saved on add, edit and copy, and read back with the window", () => {
    const src = read("./availability-manager-desktop.tsx");
    expect(src).toContain("session_type_id: typeInput");
    expect(src).toContain("session_type_id: draft.sessionTypeId ?? null");
    expect(src).toContain("session_type_id: w.sessionTypeId");
    expect(src).toContain('(sessionTypeEnabled ? ", session_type_id" : "")');
    expect(read("../../../app/(coach)/groups/[groupId]/availability/page.tsx")).toContain("sessionTypeEnabled={sessionTypeEnabled}");
  });
});

describe("starter session types", () => {
  it("one tap adds Online / In person or Weight room / Practice / Game as ordinary private types, and the team set is suggested for a team coach", () => {
    const personal = renderToStaticMarkup(createElement(SessionTypeManager, { initialTypes: [], teamMode: false }));
    expect(personal).toContain("Personal coaching: Online, In person");
    expect(personal).toContain("Team coaching: Weight room, Practice, Game");
    expect(personal).toContain("not shown on your public booking page");
    expect(read("./session-type-manager.tsx")).toContain("public_visible: false");
    const done = renderToStaticMarkup(createElement(SessionTypeManager, { initialTypes: [{ id: "a", name: "Online", creditCost: 1 }, { id: "b", name: "In person", creditCost: 1 }] }));
    expect(done).toContain("(added)");
  });
});

describe("the type shows where it is useful", () => {
  it("the coach can set the type of a booked session, and it is read on the calendar day and on the Calendar Spot row", () => {
    const html = renderToStaticMarkup(createElement(BookingTypeSelect, { bookingId: "b", types, current: "t1" }));
    expect(html).toContain("Session type");
    expect(html).toContain("No type");
    expect(read("../../../app/(coach)/groups/[groupId]/calendar/[date]/page.tsx")).toContain("<BookingTypeSelect");
    expect(read("./calendar-spotter-panel.tsx")).toContain("sessionTypeName");
  });
  it("tagging never touches credits: only session_type_id is written", () => {
    expect(read("./booking-type-select.tsx")).toContain('update({ session_type_id: next || null })');
  });
});
