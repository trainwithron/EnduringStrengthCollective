import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/supabase/client", () => ({ createBrowserClient: () => ({}) }));

import { ScheduleRequestCard, type ScheduleRequestCardData } from "./schedule-requests-panel";

const NOW = new Date("2026-10-13T16:00:00Z"); // Oct 13, noon in New York
const data = (patch: Partial<ScheduleRequestCardData> = {}): ScheduleRequestCardData => ({
  id: "r1", kind: "pause", clientName: "Sam Lee", athleteId: "a1", groupId: "g1", effectiveOn: "2026-10-13", resumeOn: null, createdAt: "2026-10-12T16:00:00Z", note: null,
  weekday: 2, startTime: "06:00", durationMinutes: 60, timezone: "America/New_York", status: "pending", ...patch,
});
const render = (d: ScheduleRequestCardData, confirming = false) =>
  renderToStaticMarkup(createElement(ScheduleRequestCard, { data: d, busy: false, confirming, onAskDone() {}, onCancelDone() {}, onDone() {}, onHandled() {}, now: NOW }));

describe("the coach's card for a schedule request", () => {
  it("says who asked for what, the schedule, and the day it takes effect", () => {
    const h = render(data());
    expect(h).toContain("Sam Lee");
    expect(h).toContain("asked to pause their weekly schedule (Tuesdays at 6:00 AM, 60 minutes)");
    expect(h).toContain("Sessions stay through Oct 13");
  });
  it("a freeze names the restart day; a cancel says it ends the schedule and its day is the last session day", () => {
    expect(render(data({ kind: "freeze", resumeOn: "2026-11-10" }))).toContain("asked to freeze their weekly schedule (Tuesdays at 6:00 AM, 60 minutes) until Nov 10");
    const c = render(data({ kind: "cancel" }));
    expect(c).toContain("asked to end their weekly schedule");
    expect(c).toContain("Last session day Oct 13");
  });
  it("shows the client's private note in quotes to the coach", () => {
    expect(render(data({ note: "Traveling for work" }))).toContain("Traveling for work");
    expect(render(data())).not.toContain("&ldquo;");
  });
  it("has Message, Done (on or after the day) and Mark handled, and NO decline", () => {
    const h = render(data());
    expect(h).toContain(">Message<");
    expect(h).toContain(">Done<");
    expect(h).toContain("Mark handled");
    expect(h).not.toMatch(/decline/i);
    expect(h).toContain("/groups/g1/messages/a1?draft=");
  });
  it("before its day Done is not offered: it says the request applies on its own after that day", () => {
    const h = render(data({ effectiveOn: "2026-10-20" }));
    expect(h).not.toContain(">Done<");
    expect(h).toContain("Applies on its own after Oct 20.");
  });
  it("a cancel also offers a pause or freeze instead, as a draft the coach sends", () => {
    const h = render(data({ kind: "cancel" }));
    expect(h).toContain("Offer pause or freeze");
    expect(decodeURIComponent(h.split("Offer pause or freeze")[0].split('href="').pop() ?? "")).toContain("would a pause or a freeze fit better");
    expect(render(data())).not.toContain("Offer pause or freeze");
  });
  it("the drafts open in the message box; nothing is sent from here, and the draft never contains the note", () => {
    const h = render(data({ note: "my husband is ill" }));
    const hrefs = [...h.matchAll(/href="([^"]+)"/g)].map((m) => decodeURIComponent(m[1])).join(" ");
    expect(hrefs).toContain("/messages/a1?draft=");
    expect(hrefs).not.toMatch(/husband/);
    // the only place the note appears is the quoted line
    expect(h.split("my husband is ill").length).toBe(2);
  });
  it("Done asks first, in plain words, before anything is changed", () => {
    const h = render(data(), true);
    expect(h).toContain("Apply now?");
    expect(h).toContain("come off the calendar");
    expect(h).toContain("Not yet");
    expect(h).not.toContain(">Message<");
  });
  it("a request nobody has answered for two days says how long it has been waiting", () => {
    expect(render(data({ createdAt: "2026-10-10T16:00:00Z" }))).toContain("waiting 3 days");
    expect(render(data())).not.toContain("waiting");
  });
});
