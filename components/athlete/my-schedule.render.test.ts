import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {} }) }));
vi.mock("@/lib/supabase/client", () => ({ createBrowserClient: () => ({ rpc: async () => ({ error: null }) }) }));

import { MySchedule, type ScheduleItem } from "./my-schedule";
import { MyScheduleCard } from "./my-schedule-card";

const MONEY = /pay|owe|refund|credit|charge|price|cost|fee|\$|balance|expire|unused/i;
const series = { id: "s1", weekday: 2, startTime: "06:00", durationMinutes: 60, status: "active" as const, timezone: "America/New_York", frozenUntil: null, endsOn: null };
const item = (patch: Partial<ScheduleItem> = {}): ScheduleItem => ({ series, nextSessionLabel: "Tue, Oct 20, 6:00 AM", requests: [], ...patch });
const html = (items: ScheduleItem[], canRequest = true) => renderToStaticMarkup(createElement(MySchedule, { groupId: "g1", items, canRequest }));

describe("My schedule (the client's page)", () => {
  it("shows the schedule, its state, the next session and the three plain buttons", () => {
    const h = html([item()]);
    expect(h).toContain("Tuesdays at 6:00 AM, 60 minutes");
    expect(h).toContain("Active");
    expect(h).toContain("Next session: Tue, Oct 20, 6:00 AM");
    expect(h).toContain("Request a pause");
    expect(h).toContain("Request a freeze");
    expect(h).toContain("Request to cancel");
  });
  it("a paused or frozen schedule offers only cancel, and says Frozen until", () => {
    const h = html([item({ series: { ...series, status: "paused", frozenUntil: "2026-11-03" } })]);
    expect(h).toContain("Frozen until Nov 3");
    expect(h).not.toContain("Request a pause");
    expect(h).not.toContain("Request a freeze");
    expect(h).toContain("Request to cancel");
    expect(h).not.toContain("Next session:");
  });
  it("a waiting request replaces the buttons with its status and a way to take it back", () => {
    const r = { id: "r1", seriesId: "s1", kind: "pause" as const, effectiveOn: "2026-11-03", resumeOn: null, status: "pending" as const, createdAt: new Date().toISOString(), appliedAt: null, appliedEarly: false };
    const h = html([item({ requests: [r] })]);
    expect(h).toContain("pause after Nov 3. Your coach will reach out.");
    expect(h).toContain("Withdraw this request");
    expect(h).not.toContain("Request a pause");
    expect(h).not.toContain("Message my coach");
  });
  it("after two days unanswered it says so and offers a one-tap message to the coach", () => {
    const old = new Date(Date.now() - 3 * 86400000).toISOString();
    const r = { id: "r1", seriesId: "s1", kind: "cancel" as const, effectiveOn: "2026-11-03", resumeOn: null, status: "pending" as const, createdAt: old, appliedAt: null, appliedEarly: false };
    const h = html([item({ requests: [r] })]);
    expect(h).toContain("Your coach hasn&#x27;t replied yet.");
    expect(h).toContain('href="/groups/g1/messages"');
    expect(h).toContain("Message my coach");
  });
  it("a coach looking in as the client sees the schedule but no buttons", () => {
    const h = html([item()], false);
    expect(h).toContain("Tuesdays at 6:00 AM");
    expect(h).not.toContain("Request a pause");
  });
  it("an ended schedule reads Ended and has no buttons", () => {
    const h = html([item({ series: { ...series, status: "ended", endsOn: "2026-11-03" } })]);
    expect(h).toContain("Ended Nov 3");
    expect(h).not.toContain("Request");
  });
  it("nothing on the page mentions money", () => {
    expect(html([item()])).not.toMatch(MONEY);
  });
});

describe("the Home card", () => {
  it("links to My schedule with the summary and state, and says when a request is with the coach", () => {
    const h = renderToStaticMarkup(createElement(MyScheduleCard, { groupId: "g1", state: { summary: "Tuesdays at 6:00 AM, 60 minutes", state: "Active", waiting: true } }));
    expect(h).toContain('href="/groups/g1/my-schedule"');
    expect(h).toContain("Tuesdays at 6:00 AM, 60 minutes");
    expect(h).toContain("Your request is with your coach.");
    expect(renderToStaticMarkup(createElement(MyScheduleCard, { groupId: "g1", state: { summary: "x", state: "Paused", waiting: false } }))).not.toContain("with your coach");
  });
});
