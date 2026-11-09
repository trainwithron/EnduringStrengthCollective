import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const route = () => readFileSync(join(__dirname, "..", "app/api/coach/packages/route.ts"), "utf8").replace(/\r\n/g, "\n");

// Ron, Nov 9: Save package did nothing, because the save stopped when payments were off, on a page that says packages are assigned by hand until payments are on.
describe("saving a package before payments are on", () => {
  it("saves the package and touches no Stripe", () => {
    const r = route();
    const post = r.slice(r.indexOf("export async function POST"), r.indexOf("export async function PATCH"));
    expect(post.indexOf("isStripeConfigured()")).toBeGreaterThan(post.indexOf(".insert({"));
    expect(post.indexOf("isStripeConfigured()")).toBeLessThan(post.indexOf("getStripeClient()"));
    expect(post).toContain("if (!isStripeConfigured()) return NextResponse.json({ packageId: pkg.id });");
  });
  it("a package with no Stripe product can be repriced before payments are on", () => {
    expect(route()).toContain("(priceAffectingChange && existing.stripe_product_id)");
  });
});
