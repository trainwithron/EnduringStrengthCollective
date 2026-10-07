import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";

vi.mock("@/lib/supabase/client", () => ({
  createBrowserClient: () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
}));

import { ProgressCardView, ProgressLookPanel } from "./progress-look-panel";
import type { ProgressCardData } from "@/lib/progress-look-gather";

const look = { exerciseName: "Back Squat", isMain: true, sessions: 4, weight: 225, reps: 5, spanDays: 21, effort: "falling" as const, rpes: [8, 7, 7], overTargetHint: false };
const card = (over: Partial<ProgressCardData> = {}): ProgressCardData => ({
  key: "progress::a1::g1::p1::1::main",
  athleteId: "a1",
  groupId: "g1",
  title: "Tuesday lower",
  kind: "main",
  flagged: [look],
  others: [{ ...look, exerciseName: "Romanian Deadlift", isMain: false, sessions: 3, effort: "none", rpes: [] }],
  lastSessionAt: "2026-10-04T12:00:00Z",
  evidenceAt: "2026-09-13T12:00:00Z",
  clientName: "Sam Lee",
  programIsPersonal: true,
  nextSlotByExercise: {},
  harderByExercise: {},
  ...over,
});
const render = (c: ProgressCardData) => renderToStaticMarkup(createElement("ul", null, createElement(ProgressCardView, { card: c, onResolved: () => {}, record: async () => true })));

describe("a time-to-progress card", () => {
  it("points at the workout, says what looks odd inside it, and asks softly", () => {
    const html = render(card());
    expect(html).toContain("Sam Lee&#x27;s Tuesday lower.");
    expect(html).toContain("Back Squat 225 × 5 for the last 4 sessions");
    expect(html).toContain("Same weight at lower effort is getting stronger");
    expect(html).toContain("Also in this workout:");
    expect(html).toContain("Romanian Deadlift 225 × 5 for the last 3 sessions");
    expect(html).toContain("Did you notice this?");
  });

  it("has the three answers, and the options stay closed until asked for", () => {
    const html = render(card());
    expect(html).toContain("Yes, deliberate");
    expect(html).toContain("Show me options");
    expect(html).toContain("Not now");
    expect(html).not.toContain("A little more load");
    expect(html).not.toContain("Apply");
  });

  it("offers an optional note, a time, and the question, all as links the coach chooses; nothing is sent by itself", () => {
    const html = render(card());
    expect(html).toContain("Draft a note to Sam");
    expect(html).toContain("/groups/g1/messages/a1?draft=");
    expect(html).toContain("Suggest a time");
    expect(html).toContain("/groups/g1/calendar?client=a1&amp;scheduleFor=a1");
    expect(html).toContain("Ask what they need most help with");
    expect(html).not.toContain("<form");
  });

  it("the accessory card is its own, softer card", () => {
    const html = render(card({ kind: "accessory", flagged: [{ ...look, isMain: false }], others: [] }));
    expect(html).toContain("main lifts are moving in Tuesday lower; the accessories haven&#x27;t.");
  });

  it("never uses stalled, plateau or stuck, or shaming words", () => {
    expect(render(card())).not.toMatch(/stall|plateau|stuck|fail|lazy|behind/i);
  });
});

describe("the row on Home", () => {
  it("shows nothing until there is something to look at, and never breaks Home", () => {
    expect(renderToStaticMarkup(createElement(ProgressLookPanel))).toBe("");
  });

  it("is on the desktop and phone Home, behind a coach-only route that returns nothing unless the caller coaches", () => {
    expect(readFileSync(new URL("../../app/(coach)/dashboard/page.tsx", import.meta.url), "utf8")).toContain("<ProgressLookPanel />");
    expect(readFileSync(new URL("./mobile/coach-mobile-home.tsx", import.meta.url), "utf8")).toContain("<ProgressLookPanel />");
    const route = readFileSync(new URL("../../app/api/progress-look/route.ts", import.meta.url), "utf8");
    expect(route).toContain('eq("role", "coach")');
    expect(route).toContain("groupIds.length === 0");
  });

  it("the panel collapses to a count and caps the open cards, from the same rules as the tested logic", () => {
    const src = readFileSync(new URL("./progress-look-panel.tsx", import.meta.url), "utf8");
    expect(src).toContain("need a look");
    expect(src).toContain("collapseCards(data.cards)");
    expect(src).toContain("I&apos;ll ask after {data.threshold} sessions at the same load.");
    expect(src).toContain("rough guidelines, not rules");
  });

  it("a client's profile shows what they said they need most help with, only to the coach, and can turn it into a suggested goal", () => {
    const profile = readFileSync(new URL("../../app/(coach)/groups/[groupId]/athletes/[athleteId]/page.tsx", import.meta.url), "utf8");
    expect(profile).toContain("findHelpAnswer(");
    expect(profile).toContain("Turn this into a goal");
    expect(profile).toContain("fromWords={helpAnswer.answer}");
    expect(readFileSync(new URL("../athlete/goal-proposal-form.tsx", import.meta.url), "utf8")).toContain("fromWords");
    // the client's words stay in the goal's own label; the coach-editable note starts empty
    expect(readFileSync(new URL("../athlete/goal-proposal-form.tsx", import.meta.url), "utf8")).toContain('const [priorityNote, setPriorityNote] = useState("");');
  });
});
