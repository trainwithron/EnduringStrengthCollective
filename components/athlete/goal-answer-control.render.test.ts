import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));
vi.mock("@/lib/supabase/client", () => ({ createBrowserClient: () => ({}) }));
vi.mock("@/lib/push-notify", () => ({ notifyPush: () => {} }));

import { GoalAnswerControl } from "./goal-answer-control";
import { GoalWaitingOnClient } from "../coach/goal-waiting-on-client";
import { GoalProposalForm } from "./goal-proposal-form";

const goal = { id: "g", goalType: "muscle_gain", customLabel: null, targetDate: "2027-03-01", priorityNote: "rear delts" };

describe("a goal the coach suggested", () => {
  it("the client sees it with Looks right, Change it and Not now, and is told it changes nothing until they agree", () => {
    const html = renderToStaticMarkup(createElement(GoalAnswerControl, { goal, groupId: "grp", coachIds: ["c"] }));
    expect(html).toContain("Your coach suggested a goal");
    for (const label of ["Looks right", "Change it", "Not now"]) expect(html).toContain(label);
    expect(html).toContain("won&#x27;t change your plan until you both agree");
    expect(html).toContain("Target date: 2027-03-01");
  });
  it("the coach sees that it is waiting on the client, with no way to confirm it for them", () => {
    const html = renderToStaticMarkup(createElement(GoalWaitingOnClient, { goal, clientName: "Sam Lee" }));
    expect(html).toContain("waiting on Sam");
    expect(html).toContain("Take it back");
    expect(html).not.toContain("Confirm");
  });
  it("the coach's form says it suggests, and sends the coach as the author", () => {
    const html = renderToStaticMarkup(createElement(GoalProposalForm, { athleteId: "a", groupId: "g", suggestedBy: "coach" }));
    expect(html).toContain("Suggest to client");
    const src = readFileSync(new URL("./goal-proposal-form.tsx", import.meta.url), "utf8");
    expect(src).toContain("created_by: suggestedBy ?? athleteId");
  });
});
