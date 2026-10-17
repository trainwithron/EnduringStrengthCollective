import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// A client with no health-screening answers says so on their profile, so a coach reading nothing cannot take it for "no concerns".
const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");

describe("a missing health screening is said out loud", () => {
  it("the panel shows a plain line when there are no answers", () => {
    const panel = read("components/coach/par-q-answers-panel.tsx");
    expect(panel).toContain("No health screening answers on file for this client.");
    expect(panel).not.toContain("if (answers.length === 0) return null;");
  });
  it("the client profile always renders the panel, with or without an intake form", () => {
    const page = read("app/(coach)/groups/[groupId]/athletes/[athleteId]/page.tsx");
    expect(page).toContain("<ParQAnswersPanel answers={parQAnswers} reviewLine=");
    expect(page).not.toContain("parQAnswers.length > 0 && <ParQAnswersPanel");
  });
});
