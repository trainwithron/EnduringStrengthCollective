import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

// Ron: everyone who finishes a workout gets the workout card, and a client finds it by opening the workout in their history.
describe("the workout card on every finished workout", () => {
  const page = read("app/sessions/[sessionId]/page.tsx");
  it("a finished workout shows View workout card: its feed post when there is one, else the card built from the workout (a signed link)", () => {
    expect(page).toContain("let workoutCardHref: string | null = sharePostId ? `/share/${sharePostId}` : null;");
    expect(page).toContain("workoutCardHref = shareHref(workoutLogForShare.id as string);");
    expect(page).toContain("View workout card");
    // the card is looked up for a completed session only, and the link is the same for the client and the coach (no viewer test)
    expect(page).toContain('session.status === "completed"');
    expect(page.slice(page.indexOf("{workoutCardHref && ("), page.indexOf("</header>"))).not.toContain("isOwnSession");
  });
  it("finishing a workout takes whoever submitted it, a coach for a client and a client under 18 included, to the card", () => {
    const button = read("components/session/complete-workout-button.tsx");
    expect(button).toContain("if (announced.href) navHref = announced.href;");
    expect(button).not.toContain("skipLink");
    // only the feed post is held back for a client under 18
    expect(button).toContain("skipPost: !!coachMode?.clientIsMinor,");
  });
});
