import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("@/lib/supabase/client", () => ({ createBrowserClient: () => ({}) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {} }), usePathname: () => "/" }));

import { FoodLogSection } from "@/components/athlete/food-log-section";
import { NutritionTotalsCard } from "@/components/athlete/nutrition-totals-card";

// Look Refresh, client step (Ron, Nov 20): the client's Nutrition page, matched to the ClientNutrition mockup. Same actions as before; only placement and look changed.
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const base = { athleteId: "a1", groupId: "g1", logDate: "2026-11-20", meals: [], recents: [], initialEntries: [] };

describe("the order on the page: totals, search, three tiles, pills, then the rest", () => {
  it("renders in that order", () => {
    const html = renderToStaticMarkup(createElement(FoodLogSection, { ...base }));
    const order = ['data-testid="logged-totals"', ">Search foods<", 'aria-label="Scan a barcode"', 'aria-label="Log food from a photo"', 'aria-label="My foods and saved meals"', ">Copy yesterday<", ">+ Snack or ate out<"];
    let last = -1;
    for (const m of order) {
      const i = html.indexOf(m);
      expect(i, m).toBeGreaterThan(last);
      last = i;
    }
  });
  it("the three tiles share one row and an open panel drops under it", () => {
    const section = read("components/athlete/food-log-section.tsx");
    expect(section).toContain('<div className="flex flex-wrap gap-2.5" data-log-tiles>');
    expect(section).toContain('<div className="flex flex-wrap items-center gap-2" data-log-pills>');
    expect(read("components/athlete/log-tile.ts")).toContain("flex-1 basis-0 min-w-0 min-h-[72px]");
    for (const f of ["components/athlete/my-foods-panel.tsx", "components/athlete/quick-log-food-button.tsx", "components/athlete/barcode-scan-button.tsx", "components/athlete/photo-log-food-button.tsx"]) {
      expect(read(f), f).toContain("basis-full order-last");
    }
  });
  it("Copy yesterday is in the pills on this page, once (the list does not show it again here)", () => {
    const section = read("components/athlete/food-log-section.tsx");
    expect(section).toContain("<FoodLogEntries\n        showCopyYesterday={false}");
    const html = renderToStaticMarkup(createElement(FoodLogSection, { ...base }));
    expect(html.split(">Copy yesterday<").length - 1).toBe(1);
  });
  it("vitamins and minerals and the targets stay below the log", () => {
    const page = read("app/(coach)/groups/[groupId]/nutrition/page.tsx");
    expect(page.indexOf("<FoodLogSection")).toBeLessThan(page.indexOf('<section id="my-targets"'));
    const section = read("components/athlete/food-log-section.tsx");
    expect(section.indexOf("<FoodLogEntries")).toBeLessThan(section.indexOf("<LogNutrients"));
  });
});

describe("the totals card", () => {
  it("without a target: the logged numbers, empty ring and bars, and Set my targets when the client may set one", () => {
    const html = renderToStaticMarkup(
      createElement(NutritionTotalsCard, { title: "Logged so far today", totals: { calories: 420, proteinG: 30, carbsG: 40, fatG: 12 }, target: null, withTarget: false, noTargetLine: "No target yet.", coachCanSeeLine: null, setTargetsHref: "#my-targets" })
    );
    expect(html).toContain('aria-label="420 calories logged, no target"');
    expect(html).not.toContain('stroke="rgb(var(--rust))"');
    expect(html).toContain("30 g");
    // a button that opens the targets in a pop-up (audit C10, Nov 21), not a jump down the page
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain("data-set-targets");
    expect(html).not.toContain('href="#my-targets"');
    expect(html).toContain(">Set my targets<");
  });
  it("with a target: the ring and bars fill toward it, never past full", () => {
    const html = renderToStaticMarkup(
      createElement(NutritionTotalsCard, { title: "Logged so far today", totals: { calories: 3000, proteinG: 90, carbsG: 100, fatG: 35 }, target: { calories: 2000, proteinG: 180, carbsG: 200, fatG: 70 }, withTarget: true, noTargetLine: null, coachCanSeeLine: "Your coach can see what you log here." })
    );
    expect(html).toContain('aria-label="3000 of 2000 calories"');
    expect(html).toContain('stroke="rgb(var(--rust))"');
    expect(html).toContain("width:50%");
    expect(html).not.toContain("Set my targets");
  });
  it("the page passes its own targets card as the link, only when the client may set their target", () => {
    expect(read("app/(coach)/groups/[groupId]/nutrition/page.tsx")).toContain('setTargetsHref={macrosEnabled && setMyTargets ? "#my-targets" : null}');
  });
});
