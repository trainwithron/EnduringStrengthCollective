import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// While payments are not set up in the app (Ron collects payment outside it), a client must see no money prompts. These guard the four
// places so a later edit cannot show them again before Stripe is configured.
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("client money prompts are hidden until Stripe is configured", () => {
  it("the re-up card on Home", () => {
    expect(read("../app/groups/[groupId]/page.tsx")).toMatch(/isStripeConfigured\(\)\)\s*\{\s*\n\s*try \{\s*\n\s*reupState/);
  });
  it("the Billing section in Settings", () => {
    expect(read("../app/groups/[groupId]/settings/page.tsx")).toContain("!isCoach && isStripeConfigured() && (");
  });
  it("the purchase prompt on both booking day pages", () => {
    expect(read("../app/groups/[groupId]/calendar/[date]/page.tsx")).toContain("isStripeConfigured() && (");
    expect(read("../app/groups/[groupId]/programs/[programId]/calendar/[date]/page.tsx")).toContain("isStripeConfigured() && (");
  });
});
