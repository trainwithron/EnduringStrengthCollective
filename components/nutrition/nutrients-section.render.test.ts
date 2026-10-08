import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/supabase/server", () => ({ createServerClient: async () => ({}) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: unknown }) => createElement("a", { href, ...rest }, children as never) }));

import { NutrientsView } from "@/components/nutrition/nutrients-section";
import { buildOverview, datesEndingOn } from "@/lib/nutrient-view";
import type { LoggedEntry } from "@/lib/nutrient-day";

const TODAY = "2026-10-08";
const meal = (date: string, nutrients: Record<string, number> | null): LoggedEntry => ({ logDate: date, status: "quick_log", description: "Food", calories: 700, nutrients });
const day = (date: string, calcium: number): LoggedEntry[] => Array.from({ length: 4 }, () => meal(date, { calcium_mg: calcium / 4 }));

const render = (entries: LoggedEntry[], audience: "client" | "coach" = "client", age: number | null = 30, sex: "male" | "female" | null = "male") =>
  renderToStaticMarkup(createElement(NutrientsView, { overview: buildOverview({ entries, todayKey: TODAY, age, sex }), audience, clientName: "Sam", detailHref: (k) => `/n/${k}` }));

describe("NutrientsView", () => {
  it("shows a reported nutrient with its amount, its percent of the reference and a link to its page", () => {
    const html = render(day(TODAY, 500));
    expect(html).toContain('href="/n/calcium_mg"');
    expect(html).toContain("500 mg");
    expect(html).toContain("50% of");
    expect(html).toContain("1000 mg (RDA)");
  });
  it("shows a nutrient nothing reports as 'Not reported', never 0", () => {
    const html = render(day(TODAY, 500));
    expect(html).toContain("Not reported");
    expect(html).not.toMatch(/Iron<\/span><span[^>]*>0 mg/);
  });
  it("says how many of today's foods carry detail", () => {
    const html = render([meal(TODAY, { calcium_mg: 100 }), meal(TODAY, null)]);
    expect(html).toContain("1 of 2 foods logged today has vitamin and mineral detail");
  });
  it("says so plainly when nothing is logged", () => {
    expect(render([])).toContain("Log some food today");
    expect(render([], "coach")).toContain("Sam hasn&#x27;t logged any food today.");
  });
  it("shows the assumption note only when age or sex is missing", () => {
    expect(render(day(TODAY, 500), "client", null, null)).toContain("adult average");
    expect(render(day(TODAY, 500), "client", 30, "male")).not.toContain("adult average");
  });
  it("surfaces a kind 'Worth a look' for a nutrient that has run low, with coach wording for a coach", () => {
    const entries = datesEndingOn(TODAY, 6).flatMap((d) => day(d, 300));
    const client = render(entries);
    expect(client).toContain("Worth a look");
    expect(client).toContain("on the low side");
    expect(client).not.toMatch(/deficien|diagnos/i);
    const coach = render(entries, "coach");
    expect(coach).toContain("Worth a look");
    expect(coach).toContain("for Sam");
  });
  it("shows no 'Worth a look' when nothing is low", () => {
    expect(render(datesEndingOn(TODAY, 6).flatMap((d) => day(d, 1000)))).not.toContain("Worth a look");
  });
  it("sodium shows its level as information only, never a progress bar", () => {
    const html = render([meal(TODAY, { sodium_mg: 1800 })]);
    expect(html).toContain("For information: the level health authorities suggest staying under is 2300 mg");
  });
  it("tucks nutrients with no data under a closed details element and states the upper limits are information only", () => {
    const html = render(day(TODAY, 500));
    expect(html).toContain("<details");
    expect(html).toContain("Upper limits are shown for information only");
  });
});
