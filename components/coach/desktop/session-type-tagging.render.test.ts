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
  it("each window shows its type on its row; the add and edit boxes offer the coach's own types with 'Any' as the default", () => {
    const html = renderToStaticMarkup(createElement(AvailabilityManagerDesktop, { coachId: "c", initialWindows: windows, sessionTypes: types, sessionTypeEnabled: true }));
    expect(html).toContain("· Online");
    const src = read("./availability-manager-desktop.tsx");
    expect(src).toContain("Session type (optional)");
    expect(src).toContain("<option value=\"\">Any</option>");
    expect(src).toContain("const showTypes = sessionTypeEnabled && sessionTypes.length > 0;");
    expect(src).toContain("{showTypes && <SessionTypeSelect");
  });
  it("the tag is saved on add, edit and copy, and read back with the window", () => {
    const src = read("./availability-manager-desktop.tsx");
    expect(src).toContain("session_type_id: draft.sessionTypeId }");
    expect(src).toContain("session_type_id: draft.sessionTypeId ?? null");
    expect(src).toContain("session_type_id: w.sessionTypeId");
    expect(src).toContain('(sessionTypeEnabled ? ", session_type_id" : "")');
    expect(read("../../../components/coach/desktop/calendar-page-tabs.tsx")).toContain("sessionTypeEnabled={sessionTypeEnabled}");
  });
});

describe("starter session types", () => {
  it("one tap adds Online / In person or Weight room / Practice / Game as ordinary private types, and the team set is suggested for a team coach", () => {
    const personal = renderToStaticMarkup(createElement(SessionTypeManager, { initialTypes: [], teamMode: false, organizationId: null }));
    expect(personal).toContain("Personal coaching: Online, In person");
    expect(personal).toContain("Team coaching: Weight room, Practice, Game");
    expect(personal).toContain("not shown on your public booking page");
    expect(read("./session-type-manager.tsx")).toContain("public_visible: false");
    const done = renderToStaticMarkup(createElement(SessionTypeManager, { initialTypes: [{ id: "a", name: "Online" }, { id: "b", name: "In person" }], organizationId: null }));
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
