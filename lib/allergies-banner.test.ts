import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {} }) }));
vi.mock("@/lib/supabase/client", () => ({ createBrowserClient: () => ({}) }));

import { AllergiesConfirmBanner } from "@/components/coach/nutrition/allergies-confirm-banner";

const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

// Oct 19 audit item 15: all 19 clients had no preferences row, and "never asked" looked like "no allergies": a plan could contain peanuts or shellfish with no warning.
describe("allergies never asked", () => {
  it("the banner says so plainly, offers the one-tap confirmation and a way to enter them", () => {
    const html = renderToStaticMarkup(createElement(AllergiesConfirmBanner, { athleteId: "a1", clientName: "Cindie" }));
    expect(html).toContain("Cindie hasn&#x27;t been asked about food allergies. Meal plans can&#x27;t be built until you confirm they have none, or enter them below.");
    expect(html).toContain("Cindie has no allergies");
    expect(html).toContain('href="#preferences"');
  });
  const nutrition = read("components/coach/nutrition/client-nutrition.tsx");
  it("shows only when the client has no saved row (a failed read is the existing, different, case) and passes the answer to the builder", () => {
    expect(nutrition).toContain("const allergiesAsked = !!prefsRow || !!prefsReadError;");
    expect(nutrition).toContain("{!allergiesAsked && <AllergiesConfirmBanner");
    expect(nutrition).toContain("allergiesAsked={allergiesAsked}");
  });
  it("confirming writes an ordinary preferences row with no allergies, the same row Save writes (never over an existing one: the banner is only shown when there is none)", () => {
    const banner = read("components/coach/nutrition/allergies-confirm-banner.tsx");
    expect(banner).toContain('upsert(preferencesToRow({ ...DEFAULT_PREFERENCES }, athleteId), { onConflict: "athlete_id" })');
    expect(banner).toContain("router.refresh();");
  });
  const gen = read("components/coach/desktop/meal-plan-generator.tsx");
  it("the builder treats 'never asked' like unreadable rules at every entry: generate, import, week, the AI buttons and the swap roles", () => {
    expect(gen).toContain("const rulesReadable = rulesReadableProp && allergiesAsked;");
    expect(gen).toContain("Allergies haven't been asked yet, so nothing can be built.");
    expect((gen.match(/if \(!rulesReadable\) \{/g) ?? []).length).toBeGreaterThanOrEqual(5);
    expect(gen).toContain("disabled={!rulesReadable}");
    expect(read("components/coach/desktop/nutrition-tools.tsx")).toContain("allergiesAsked={allergiesAsked}");
  });
});
