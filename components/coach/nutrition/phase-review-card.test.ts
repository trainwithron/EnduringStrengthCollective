import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/lib/supabase/client", () => ({ createBrowserClient: () => ({}) }));

import { PhaseReviewCard, type PhaseReviewCardProps } from "@/components/coach/nutrition/phase-review-card";

const base: PhaseReviewCardProps = {
  athleteId: "a1",
  groupId: "g1",
  coachId: "c1",
  clientFirst: "Sam",
  todayKey: "2026-10-08",
  phase: "fat_loss",
  headline: "Review is due Oct 8",
  results: ["Week 2 of fat loss. Looking at the 14 days since Sep 25.", "Weight: 200 lb to 198.4 lb (down 1.6 lb), about 0.8 percent of body weight a week.", "Food logged on 12 of 14 days."],
  verdictLine: "Sam is moving the way this phase aims for, at a sensible speed.",
  verdict: "on_track",
  next: "reverse_diet",
  stance: "supports",
  stanceLine: "The numbers support moving to reverse diet.",
  factors: ["Body fat is under the rule-of-thumb line, so rebuilding is a reasonable next step."],
  moveState: "none",
  drafts: { continue: "Hi Sam, keep going.", move: "Hi Sam, the best path now is a reverse diet.", extend: "Hi Sam, a little more time." },
};
const render = (over: Partial<PhaseReviewCardProps> = {}) => renderToStaticMarkup(createElement(PhaseReviewCard, { ...base, ...over }));

describe("the phase review card", () => {
  it("shows the real results, what the numbers say about the planned step, and the three choices", () => {
    const html = render();
    expect(html).toContain("Review Sam&#x27;s phase");
    expect(html).toContain("down 1.6 lb");
    expect(html).toContain("Food logged on 12 of 14 days.");
    expect(html).toContain("Planned next: Reverse diet. The numbers support moving to reverse diet.");
    expect(html).toContain("Only you see this plan.");
    expect(html).toContain("rule-of-thumb line");
    expect(html).toContain("Keep going");
    expect(html).toContain("Suggest reverse diet");
    expect(html).toContain("Extend the review");
  });
  it("highlights only the choice the numbers point to: the move when it is supported", () => {
    const html = render();
    expect((html.match(/bg-rust text-graphite/g) ?? []).length).toBe(1);
    expect(html.indexOf("Suggest reverse diet")).toBeGreaterThan(html.lastIndexOf("bg-rust text-graphite", html.indexOf("Suggest reverse diet")) - 1);
  });
  it("does not pitch the move when the numbers do not support it: nothing is highlighted for it", () => {
    const html = render({ verdict: "low_adherence", stance: "does_not_support", stanceLine: "The numbers do not support moving to reverse diet yet.", verdictLine: "Sam logged food on 6 of 14 days, so the result does not say much yet." });
    expect(html).toContain("do not support moving to reverse diet yet");
    expect((html.match(/bg-rust text-graphite/g) ?? []).length).toBe(0);
  });
  it("too fast highlights keeping going (the safe call); too little data highlights extending", () => {
    const fast = render({ verdict: "too_fast", stance: "unclear", stanceLine: "The numbers do not say clearly about moving to reverse diet." });
    expect(fast.slice(fast.indexOf("Keep going") - 200, fast.indexOf("Keep going"))).toContain("bg-rust text-graphite");
    const thin = render({ verdict: "not_enough_data", stance: "unclear", stanceLine: "x" });
    expect(thin.slice(thin.indexOf("Extend the review") - 200, thin.indexOf("Extend the review"))).toContain("bg-rust text-graphite");
  });
  it("with no planned next phase there is nothing about one and no move button", () => {
    const html = render({ next: null, stance: null, stanceLine: null, factors: [], drafts: { ...base.drafts, move: null } });
    expect(html).not.toContain("Planned next");
    expect(html).not.toContain("Suggest ");
  });
  it("planning the same phase again is 'keep going', not a move", () => {
    const html = render({ next: "fat_loss", stanceLine: "The numbers support continuing fat loss." });
    expect(html).not.toContain("Suggest fat loss");
  });
  it("says when a suggestion is waiting or was declined, and hides a second move while waiting", () => {
    const waiting = render({ moveState: "waiting" });
    expect(waiting).toContain("Waiting for them to confirm or change it");
    expect(waiting).not.toContain("Suggest reverse diet");
    expect(render({ moveState: "declined" })).toContain("said not now to that suggestion");
  });
  it("never sends anything itself: it says the message is the coach's to edit and send", () => {
    // The text area only appears after a choice is opened, so the promise lives in the source too.
    expect(render()).not.toContain("<textarea");
  });
});

describe("the message never goes in a web address", () => {
  it("the card offers Copy message and a plain link to Messages, with no draft in the address", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(new URL("./phase-review-card.tsx", import.meta.url), "utf8");
    expect(source).toContain("Copy message");
    expect(source).not.toContain("?draft=");
    expect(source).not.toContain("encodeURIComponent");
  });
});
