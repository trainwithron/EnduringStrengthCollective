import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));
vi.mock("@/lib/supabase/client", () => ({ createBrowserClient: () => ({}) }));
vi.mock("@/lib/push-notify", () => ({ notifyPush: () => {} }));

import { GoalWaitingOnClient } from "../coach/goal-waiting-on-client";
import { GoalProposalForm } from "./goal-proposal-form";

const goal = { id: "g", goalType: "muscle_gain", customLabel: null, targetDate: "2027-03-01", priorityNote: "rear delts" };

describe("a goal the coach suggested", () => {
  // The client answers it on the one goals page now (components/shared/goals-form.tsx; lib/goals-all-in-one.test.ts).
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
