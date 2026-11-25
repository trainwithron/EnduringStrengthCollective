import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CARD_WEEK_DAYS,
  DAYS_ONLY_CARD,
  MACROS_OFF_CARD,
  NO_MACROS_CARD,
  TRACKING_OFF_CARD,
  bandFor,
  barFor,
  cardBody,
  cardMacros,
  lastLogLine,
  prescriptionText,
  type CardFlags,
  type Macros,
} from "./nutrition-cards";
import { WEEK_DAYS, loadNutritionWeek, summarizeWeek, type FoodRow } from "./coach-nutrition-week";

// Ron, Nov 24: client cards on the coach Nutrition page, each with four bars (prescription as the faint track, what they ate as the fill), for the 7-day average or today.
const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const m = (protein: number | null, carbs: number | null, fat: number | null, calories: number | null): Macros => ({ protein, carbs, fat, calories });
const ok: CardFlags = { trackingOff: false, macrosOff: false, comparable: true, youth: false };
const TODAY = "2026-11-24"; // the week is Nov 18 .. Nov 24
const adults = async () => new Set<string>();

describe("a bar", () => {
  it("green from 90 to 110 percent, gold under, red over 110", () => {
    expect([0.5, 0.899, 0.9, 1, 1.1, 1.101].map(bandFor)).toEqual(["under", "under", "hit", "hit", "hit", "over"]);
    expect(bandFor(null)).toBe("neutral");
  });

  it("the fill is what they ate over the prescription, never past the track; the label reads the numbers out", () => {
    const b = barFor("protein", 142, 180, false);
    expect(b).toMatchObject({ eaten: 142, target: 180, percent: 79, band: "under" });
    expect(b.fill).toBeCloseTo(78.9, 1);
    expect(b.ariaLabel).toBe("Protein: 142 of 180 g (79%)");
    const over = barFor("calories", 2600, 2000, false);
    expect(over).toMatchObject({ fill: 100, percent: 130, band: "over" });
    expect(over.ariaLabel).toBe("Calories: 2,600 of 2,000 kcal (130%)");
  });

  it("Youth/Team mode never judges calories (no red, no gold), and still judges protein", () => {
    expect(barFor("calories", 2600, 2000, true).band).toBe("neutral");
    expect(barFor("calories", 1000, 2000, true).band).toBe("neutral");
    expect(barFor("protein", 80, 160, true).band).toBe("under");
  });

  it("a number with no prescription is shown plainly, without a percent or a colour", () => {
    expect(barFor("carbs", 120, null, false)).toMatchObject({ target: null, percent: null, fill: 0, band: "neutral", ariaLabel: "Carbs: 120 g, no prescription" });
  });
});

describe("what a card shows", () => {
  const macros = cardMacros({ todayKey: TODAY, days: [{ date: "2026-11-23", eaten: m(150, 200, 60, 1900) }], targetFor: () => m(180, 250, 70, 2350) });

  it("food tracking off, macros off, and the days-only rule each say so instead of bars, in that order", () => {
    expect(cardBody(macros, { ...ok, trackingOff: true, macrosOff: true }, "average")).toEqual({ kind: "message", text: TRACKING_OFF_CARD });
    expect(cardBody(macros, { ...ok, macrosOff: true, comparable: false }, "average")).toEqual({ kind: "message", text: MACROS_OFF_CARD });
    expect(cardBody(macros, { ...ok, comparable: false }, "average")).toEqual({ kind: "message", text: DAYS_ONLY_CARD });
    expect(MACROS_OFF_CARD).toBe("Macros off for this client: logging only.");
  });

  it("no prescription says No macros set yet; a prescription with nothing logged shows the prescription", () => {
    const none = cardMacros({ todayKey: TODAY, days: [], targetFor: () => null });
    expect(cardBody(none, ok, "average")).toEqual({ kind: "message", text: NO_MACROS_CARD });
    expect(cardBody(macros, ok, "today")).toEqual({ kind: "nothing_logged", prescription: "180P · 250C · 70F · 2,350 kcal", period: "today" });
    expect(prescriptionText(m(140, null, 65, 1945))).toBe("140P · 65F · 1,945 kcal");
  });

  it("four bars in order: Protein, Carbs, Fat, Calories", () => {
    const body = cardBody(macros, ok, "average");
    expect(body?.kind).toBe("bars");
    if (body?.kind === "bars") expect(body.bars.map((b) => `${b.label} ${b.eaten}/${b.target}`)).toEqual(["Protein 150/180", "Carbs 200/250", "Fat 60/70", "Calories 1900/2350"]);
  });

  it("a card the week could not be read for shows just the person", () => {
    expect(cardBody(null, ok, "average")).toBeNull();
  });
});

describe("the 7-day average", () => {
  it("counts only the days they logged with numbers, so a quiet day never drags it toward zero", () => {
    const c = cardMacros({
      todayKey: TODAY,
      days: [
        { date: "2026-11-20", eaten: m(100, 200, 50, 1800) },
        { date: "2026-11-22", eaten: m(200, 300, 70, 2600) },
        // a day logged with only words (no numbers yet) is not part of the average
        { date: "2026-11-23", eaten: m(null, null, null, null) },
      ],
      targetFor: () => m(180, 250, 70, 2350),
    });
    expect(c.average).toEqual({ eaten: m(150, 250, 60, 2200), target: m(180, 250, 70, 2350), days: 2 });
    expect(c.today.eaten).toBeNull();
  });

  it("compares with the same days' prescriptions (a training day and a rest day can differ); today with today's", () => {
    const targets: Record<string, Macros> = { "2026-11-23": m(200, 300, 80, 2700), [TODAY]: m(160, 200, 60, 2100) };
    const c = cardMacros({ todayKey: TODAY, days: [{ date: "2026-11-23", eaten: m(190, 280, 75, 2600) }, { date: TODAY, eaten: m(80, 100, 30, 1000) }], targetFor: (d) => targets[d] ?? null });
    expect(c.average.target).toEqual(m(180, 250, 70, 2400));
    expect(c.today).toEqual({ eaten: m(80, 100, 30, 1000), target: m(160, 200, 60, 2100) });
  });

  it("with no prescription on the logged days, it compares with today's", () => {
    const c = cardMacros({ todayKey: TODAY, days: [{ date: "2026-11-20", eaten: m(100, 100, 40, 1200) }], targetFor: (d) => (d === TODAY ? m(150, 200, 60, 2000) : null) });
    expect(c.average.target).toEqual(m(150, 200, 60, 2000));
  });

  it("the week is the same seven days as the list", () => {
    expect(CARD_WEEK_DAYS).toBe(WEEK_DAYS);
  });
});

describe("the week's reads feed the cards (no read per card)", () => {
  const food = (athlete: string, day: string, p: number, c: number, f: number, kcal: number, status: string | null = null): FoodRow => ({ athlete_id: athlete, log_date: day, status, protein_g: p, carbs_g: c, fat_g: f, calories: kcal });
  const history = new Map([["a|g", [{ effective_from: "2026-01-01", calories: 2000, protein_g: 150, carbs_g: 200, fat_g: 60 }]]]);

  it("adds up each day, leaves skipped meals out, and uses the day's own target over the standing one", () => {
    const [row] = summarizeWeek({
      clients: [{ id: "a", groupId: "g", fullName: "Ann" }],
      food: [food("a", "2026-11-22", 60, 100, 20, 900), food("a", "2026-11-22", 60, 100, 20, 900), food("a", "2026-11-23", 999, 999, 999, 9999, "skipped"), food("a", TODAY, 100, 150, 40, 1500)],
      todayKey: TODAY,
      histories: history,
      dayTargets: new Map([[`a|g|${TODAY}`, m(180, 220, 70, 2300)]]),
    });
    expect(row.daysLogged).toBe(2);
    expect(row.macros.today).toEqual({ eaten: m(100, 150, 40, 1500), target: m(180, 220, 70, 2300) });
    expect(row.macros.average).toEqual({ eaten: m(110, 175, 40, 1650), target: m(165, 210, 65, 2150), days: 2 });
    expect(row).toMatchObject({ macrosOff: false, comparable: true, youth: false });
  });

  it("reads Youth/Team mode per group in one batched read (unreadable = every calorie bar neutral), and the group tier is logging only", async () => {
    const tables: Record<string, unknown[]> = {
      groups: [{ id: "team", nutrition_youth_mode: true }, { id: "g", nutrition_youth_mode: false }],
      group_memberships: [{ id: "m", profile_id: "b", group_id: "g", food_tracking_enabled: true, coach_sets_macros: null, client_tier: "group" }],
    };
    const db = fakeDb(tables);
    const w = await loadNutritionWeek(db, [{ id: "a", groupId: "team", fullName: "Ann" }, { id: "b", groupId: "g", fullName: "Bo" }], TODAY, adults);
    expect(w.rows.find((r) => r.id === "a")).toMatchObject({ youth: true, macrosOff: false });
    expect(w.rows.find((r) => r.id === "b")).toMatchObject({ youth: false, macrosOff: true });
    const failed = await loadNutritionWeek(fakeDb(tables, ["groups"]), [{ id: "b", groupId: "g", fullName: "Bo" }], TODAY, adults);
    expect(failed.failed).toBe(false);
    expect(failed.rows[0].youth).toBe(true);
    // The reads do not grow with the number of clients (the only per-client read is the list's own last log before this week, for a client idle this week).
    const many = fakeDb({ food_log_entries: Array.from({ length: 30 }, (_, i) => ({ id: `f${i}`, athlete_id: `c${i}`, log_date: TODAY, status: null, protein_g: 1 })) });
    await loadNutritionWeek(many, Array.from({ length: 30 }, (_, i) => ({ id: `c${i}`, groupId: "g", fullName: `C${i}` })), TODAY, adults);
    expect(many.calls).toBeLessThanOrEqual(12);
  });
});

describe("last log line", () => {
  it("today, yesterday, a date, or no logs yet", () => {
    const label = (k: string) => `on ${k}`;
    expect(lastLogLine(TODAY, TODAY, "2026-11-23", label)).toBe("Last log today");
    expect(lastLogLine("2026-11-23", TODAY, "2026-11-23", label)).toBe("Last log yesterday");
    expect(lastLogLine("2026-11-20", TODAY, "2026-11-23", label)).toBe("Last log on 2026-11-20");
    expect(lastLogLine(null, TODAY, "2026-11-23", label)).toBe("No logs yet");
  });
});

describe("how it is wired", () => {
  const page = src("app/(coach)/groups/[groupId]/nutrition/page.tsx");
  const cards = src("components/coach/nutrition/nutrition-client-cards.tsx");

  it("nothing picked shows the cards; a picked client keeps the list and page, with a way back to all clients", () => {
    expect(page).toContain("!selected && !wantsSelf ? (");
    expect(page).toContain("<NutritionClientCards cards={cards}");
    expect(page).toContain("list={listLayout}");
    expect(page).toContain("nutrition?all=1");
    expect(page).toContain("← All clients");
    // ?all=1 is the only thing that stops a one-on-one group opening its own client
    expect(page).toContain('searchParams.all !== "1" && ');
  });

  it("the cards match the Clients page cards and switch Cards/List and 7-day average/Today", () => {
    expect(cards).toContain("rounded-card border border-transparent bg-surface hover:border-rust p-3");
    expect(cards).toContain("<InitialsAvatar name={c.fullName} tintKey={c.id} />");
    expect(cards).toContain("font-display text-xl tabular-nums");
    expect(cards).toContain('aria-label="Period"');
    expect(cards).toContain('aria-label="View"');
    expect(cards).toContain("NUTRITION_CLIENTS_VIEW_KEY");
    expect(cards).toContain('role="img" aria-label={b.ariaLabel}');
    // one column on a phone (a card is never wider than the screen)
    expect(cards).toContain("minmax(min(100%,280px),1fr)");
  });

  it("the cards run in the browser without the server reads", () => {
    expect(cards.startsWith('"use client"')).toBe(true);
    expect(cards).not.toMatch(/from "@\/lib\/coach-nutrition-week"/);
    expect(src("lib/nutrition-cards.ts")).not.toMatch(/^import /m);
  });

  it("says nothing about automatic or AI to the coach beyond the existing switch name", () => {
    for (const line of [TRACKING_OFF_CARD, MACROS_OFF_CARD, NO_MACROS_CARD]) expect(line).not.toMatch(/\bAI\b|Spotter/);
  });
});

// A stand-in database (as in coach-nutrition-week.test.ts) that also counts the reads.
function fakeDb(tables: Record<string, unknown[]>, failing: string[] = []) {
  const db = {
    calls: 0,
    from(table: string) {
      db.calls += 1;
      let range: [number, number] | null = null;
      let single = false;
      const answer = () => {
        if (failing.includes(table)) return { data: null, error: { message: "x" } };
        const rows = tables[table] ?? [];
        if (single) return { data: rows[0] ?? null, error: null };
        return { data: range ? rows.slice(range[0], range[1] + 1) : rows, error: null };
      };
      const q: any = {
        select: () => q,
        in: () => q,
        eq: () => q,
        neq: () => q,
        gte: () => q,
        lte: () => q,
        lt: () => q,
        or: () => q,
        order: () => q,
        limit: () => q,
        range: (a: number, b: number) => ((range = [a, b]), q),
        maybeSingle: async () => ((single = true), answer()),
        then: (resolve: (v: unknown) => void) => resolve(answer()),
      };
      return q;
    },
  };
  return db as any;
}
