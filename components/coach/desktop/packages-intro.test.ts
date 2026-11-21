import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const page = readFileSync(join(__dirname, "..", "..", "..", "app/(coach)/groups/[groupId]/business/packages/page.tsx"), "utf8").replace(/\r\n/g, "\n");

describe("the Packages page does not promise what is off", () => {
  it("with payments not connected it says one plain thing: packages are assigned by hand (no 'until payments are turned on': clutter audit DK12, Nov 21)", () => {
    expect(page).toContain("isStripeConfigured()");
    expect(page).toContain('"Define what you sell, and assign it to clients by hand."');
    expect(page).not.toContain("until payments are turned on");
  });
  it("with payments on it still says clients see them on their Billing page", () => {
    expect(page).toContain("a client sees these on their Billing page.");
  });
  it("the sentence about editing a package's rate (there is no edit control) is gone", () => {
    expect(page).not.toMatch(/Editing a\s+package/);
    expect(page).not.toContain("never changes what an existing subscriber");
  });
});
