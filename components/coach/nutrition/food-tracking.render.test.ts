import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("@/lib/supabase/client", () => ({ createBrowserClient: () => ({}) }));

import { FoodTrackingToggle } from "@/components/coach/nutrition/food-tracking-toggle";
import { AiBudgetMeter } from "@/components/coach/ai-budget-meter";
import { FOOD_TRACKING_OFF_LINE } from "@/lib/nutrition-tracking";

describe("the coach's food-tracking switch", () => {
  it("says what it does, is on by default for the client and has a 44px control", () => {
    const html = renderToStaticMarkup(createElement(FoodTrackingToggle, { athleteId: "a", groupId: "g", initialEnabled: true, clientFirstName: "Sam" }));
    expect(html).toContain("Food tracking for Sam");
    expect(html).toContain("On by default");
    expect(html).toContain("Anything already logged stays.");
    expect(html).toContain("checked");
    expect(html).toContain("min-h-[44px]");
  });
  it("shows off when the coach turned it off", () => {
    const html = renderToStaticMarkup(createElement(FoodTrackingToggle, { athleteId: "a", groupId: "g", initialEnabled: false, clientFirstName: "Sam" }));
    expect(html).not.toMatch(/<input[^>]*checked/);
  });
});

describe("the client's page when the coach turned tracking off", () => {
  it("reads the switch on its own (so a missing column never loses the tier) and shows a plain note instead of the food log", () => {
    const src = readFileSync(join(process.cwd(), "app/(coach)/groups/[groupId]/nutrition/page.tsx"), "utf8");
    expect(src).toContain("food_tracking_enabled");
    expect(src).toContain("trackingOn ?");
    expect(src).toContain("FOOD_TRACKING_OFF_LINE");
    expect(FOOD_TRACKING_OFF_LINE).toContain("Your coach has turned off food tracking for you");
  });
});

describe("AiBudgetMeter", () => {
  it("renders nothing until the numbers arrive (and nothing for the banner when there is nothing to say)", () => {
    expect(renderToStaticMarkup(createElement(AiBudgetMeter, {}))).toBe("");
    expect(renderToStaticMarkup(createElement(AiBudgetMeter, { variant: "banner" }))).toBe("");
  });
});
