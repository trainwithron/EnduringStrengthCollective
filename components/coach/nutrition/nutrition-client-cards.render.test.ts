import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NutritionClientCards, type NutritionCard } from "./nutrition-client-cards";
import { CLIENTS_VIEW_KEY, NUTRITION_CLIENTS_VIEW_KEY, readClientsView, writeClientsView } from "@/lib/clients-view-pref";
import { cardMacros, type CardFlags, type Macros } from "@/lib/nutrition-cards";

const TODAY = "2026-11-24";
const m = (protein: number, carbs: number, fat: number, calories: number): Macros => ({ protein, carbs, fat, calories });
const ok: CardFlags = { trackingOff: false, macrosOff: false, comparable: true, youth: false };
const card = (id: string, fullName: string, extra: Partial<NutritionCard> = {}): NutritionCard => ({
  id,
  groupId: "g",
  fullName,
  href: `/groups/g/nutrition?athleteId=${id}`,
  daysLogged: 5,
  lastLine: "Last log today",
  macros: cardMacros({ todayKey: TODAY, days: [{ date: "2026-11-23", eaten: m(142, 232, 81, 2320) }], targetFor: () => m(180, 250, 70, 2350) }),
  flags: ok,
  ...extra,
});
const render = (cards: NutritionCard[], failed = false) =>
  renderToStaticMarkup(createElement(NutritionClientCards, { cards, self: { name: "Coach Ron", href: "/groups/g/nutrition?athleteId=me" }, failed, list: createElement("div", { "data-old-list": "" }) }));

describe("the Nutrition client cards", () => {
  it("open on Cards and the 7-day average, with the coach's own row first and each card opening that client", () => {
    const html = render([card("a", "Johann Gorsek"), card("b", "Sawyer Steele")]);
    expect(html).toContain('data-nutrition-cards-view="cards"');
    expect(html).not.toContain("data-old-list");
    expect(html).toMatch(/aria-pressed="true"[^>]*>7-day average/);
    expect(html.indexOf("Coach Ron (you)")).toBeLessThan(html.indexOf("Johann Gorsek"));
    expect(html).toContain('href="/groups/g/nutrition?athleteId=a"');
    expect(html.match(/<li[ >]/g)!.length).toBe(2);
  });

  it("a card: name, last log, days logged out of 7, and four bars read out with their numbers", () => {
    const html = render([card("a", "Johann Gorsek")]);
    expect(html).toContain("Last log today");
    expect(html).toMatch(/>5<span class="text-sm text-steel">\/7<\/span>/);
    expect(html).toContain("days logged");
    expect(html).toContain('aria-label="Protein: 142 of 180 g (79%)"');
    expect(html).toContain('aria-label="Calories: 2,320 of 2,350 kcal (99%)"');
    expect(html).toContain('data-band="under"'); // protein 79%
    expect(html).toContain('data-band="over"'); // fat 116%
    expect(html).toContain('data-band="hit"'); // carbs 93%, calories 99%
    expect(html).toContain("2,320</span> / 2,350<");
    expect(html).toContain("On target (90–110%)");
  });

  it("the empty states say why there are no bars", () => {
    const html = render([
      card("a", "Ward Forrest", { flags: { ...ok, macrosOff: true } }),
      card("b", "Amber Belt", { macros: cardMacros({ todayKey: TODAY, days: [], targetFor: () => null }) }),
      card("c", "Robyn", { macros: cardMacros({ todayKey: TODAY, days: [], targetFor: () => m(140, 200, 65, 1945) }) }),
    ]);
    expect(html).toContain("Macros off for this client: logging only.");
    expect(html).toContain("No macros set yet.");
    expect(html).toContain("Prescription 140P · 200C · 65F · 1,945 kcal. Nothing logged yet.");
    expect(html).not.toContain("data-macro-bars");
  });

  it("a week that could not be read says so once, and still lists everyone by name", () => {
    const html = render([card("a", "Johann Gorsek", { daysLogged: null, lastLine: null, macros: null })], true);
    expect(html).toContain("Couldn&#x27;t load this week&#x27;s numbers");
    expect(html).toContain("Johann Gorsek");
    expect(html).not.toContain("days logged");
  });

  it("keeps its own Cards/List choice, separate from the Clients page", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    writeClientsView(storage, "list", NUTRITION_CLIENTS_VIEW_KEY);
    expect(readClientsView(storage, NUTRITION_CLIENTS_VIEW_KEY)).toBe("list");
    expect(readClientsView(storage)).toBe("cards");
    expect(store.has(CLIENTS_VIEW_KEY)).toBe(false);
  });
});
