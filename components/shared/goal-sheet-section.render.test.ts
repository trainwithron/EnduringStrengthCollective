import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

import { GoalSheetSection } from "./goal-sheet-section";
import { EMPTY_GOAL_SHEET, type GoalSheetRow } from "@/lib/goal-sheet";

const filled: GoalSheetRow = {
  ...EMPTY_GOAL_SHEET,
  why_matters: "Keep up with my kids",
  days_per_week: 3,
  want_score: 8,
  want_why: "Doctor said so",
  food_day_1: "Eggs, coffee, chicken and rice",
  filled_by: "a",
  filled_at: "2026-11-02T15:00:00Z",
  requested_by: null,
  requested_at: null,
};

describe("the goal sheet on screen", () => {
  it("a client with nothing filled in sees the form open, with every question and the 1-10 and days choices", () => {
    const html = renderToStaticMarkup(createElement(GoalSheetSection, { groupId: "g", athleteId: "a", sheet: null, viewer: "client" }));
    for (const q of ["Why does this goal matter to you?", "What would success look like 90 days from now?", "What has gotten in the way before?", "How many days a week can you realistically train?", "How bad do you want this?", "Why that number?", "How hard are you willing to work for it?", "This affects the plan.", "The last 3 days of eating", "Yesterday", "2 days ago", "3 days ago"]) expect(html).toContain(q);
    expect(html).toContain(">10</button>");
    expect(html).toContain(">7</button>");
    expect(html).toContain("Save");
  });
  it("a client whose coach sent it is told so", () => {
    const html = renderToStaticMarkup(createElement(GoalSheetSection, { groupId: "g", athleteId: "a", sheet: { ...filled, requested_by: "c", requested_at: "2026-11-03T00:00:00Z" }, viewer: "client" }));
    expect(html).toContain("Your coach asked you to fill this in.");
  });
  it("the coach reads the answers and can fill it in or send it", () => {
    const html = renderToStaticMarkup(createElement(GoalSheetSection, { groupId: "g", athleteId: "a", sheet: filled, viewer: "coach", clientFirstName: "Adrian", timeZone: "America/Chicago" }));
    expect(html).toContain("Keep up with my kids");
    expect(html).toContain("8 out of 10");
    expect(html).toContain("3 days");
    expect(html).toContain("Eggs, coffee, chicken and rice");
    expect(html).toContain("Filled in Nov 2 by Adrian.");
    expect(html).toContain("Edit");
    expect(html).toContain("Send to Adrian");
  });
  it("a coach with nothing filled in yet is offered to fill it in with the client or send it", () => {
    const html = renderToStaticMarkup(createElement(GoalSheetSection, { groupId: "g", athleteId: "a", sheet: null, viewer: "coach", clientFirstName: "Adrian" }));
    expect(html).toContain("Not filled in yet.");
    expect(html).toContain("Fill in with Adrian");
    expect(html).toContain("Send to Adrian");
  });
});
