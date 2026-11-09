import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Ron, Nov 9: "Book a consultation" led to "No consultations are available to book online right now."
describe("the public page only offers Book when there is a consultation to book", () => {
  it("counts the coach's public session types before showing Book", () => {
    const page = readFileSync(join(__dirname, "..", "app/c/[slug]/page.tsx"), "utf8");
    expect(page).toContain('.eq("coach_id", page.coach_id).eq("public_visible", true)');
    expect(page).toContain("&& (bookableTypes ?? 0) > 0;");
  });
});
