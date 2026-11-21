import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { amountInWords, buildRecapCardModel, comparisonLine, compactNumber, drawRecapCard, liftsOfYear, topLiftOfYear, withAlpha, type RecapTheme } from "@/lib/year-recap-card";
import { getVolumeEquivalence } from "@/lib/volume-equivalence";
import type { YearRecap } from "@/lib/year-recap";
import type { DrawContext } from "@/lib/share-image";

// Wave 2, P7 (Ron approved the Recap mockup, Nov 20): the December recap picture, private until the client shares it.
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const key = (iso: string) => iso.slice(0, 10);

const recap: YearRecap = {
  year: 2026,
  workouts: 142,
  volume: 1_200_000,
  sets: 2000,
  minutes: 8000,
  prCount: 27,
  prLifts: ["Back Squat"],
  bestMonth: { month: 3, workouts: 18 },
  longestWeekStreak: 9,
  topLifts: [],
};

describe("the numbers on the picture", () => {
  it("the top lift is the one trained most that year, with its best weight that year", () => {
    const rows = [
      { at: "2026-02-01T12:00:00Z", exerciseName: "Back Squat", bestWeight: 225 },
      { at: "2026-05-01T12:00:00Z", exerciseName: "back squat", bestWeight: 245 },
      { at: "2026-06-01T12:00:00Z", exerciseName: "Back Squat", bestWeight: 235 },
      { at: "2026-03-01T12:00:00Z", exerciseName: "Bench", bestWeight: 300 },
      { at: "2025-06-01T12:00:00Z", exerciseName: "Bench", bestWeight: 400 },
      { at: "2025-06-02T12:00:00Z", exerciseName: "Bench", bestWeight: 400 },
      { at: "2025-06-03T12:00:00Z", exerciseName: "Bench", bestWeight: 400 },
      { at: "2026-04-01T12:00:00Z", exerciseName: "Plank", bestWeight: null },
      { at: "2026-04-02T12:00:00Z", exerciseName: "Plank", bestWeight: null },
      { at: "2026-04-03T12:00:00Z", exerciseName: "Plank", bestWeight: null },
      { at: "2026-04-04T12:00:00Z", exerciseName: "Plank", bestWeight: null },
    ];
    expect(topLiftOfYear(rows, 2026, key)).toEqual({ name: "Back Squat", sessions: 3, bestWeight: 245 });
    expect(liftsOfYear(rows, 2026, key).find((l) => l.name === "Bench")?.sessions).toBe(1);
    expect(topLiftOfYear([], 2026, key)).toBeNull();
  });
  it("big numbers short enough for a tile, and in words for the line", () => {
    expect(compactNumber(1_234_567)).toBe("1.2M");
    expect(compactNumber(245_400)).toBe("245K");
    expect(compactNumber(9_800)).toBe("9,800");
    expect(amountInWords(1_200_000, "pounds")).toBe("1.2 million pounds");
    expect(amountInWords(2_000_000, "pounds")).toBe("2 million pounds");
    expect(amountInWords(245_000, "pounds")).toBe("245 thousand pounds");
  });
  it("Showed up 142 times; New PRs, Pounds lifted, Longest streak, Top lift; Coached by Coach Ron, never Coach Coach", () => {
    const m = buildRecapCardModel({ recap, clientName: "Sam Steele", coachName: "Coach Ron", orgName: "Enduring Strength Co.", unit: "lb", topLift: { name: "Back Squat", bestWeight: 245 }, seed: "s" });
    expect(m.heading).toBe("Sam’s year");
    expect([m.titleTop, m.titleBottom]).toEqual(["Showed up", "142 times"]);
    expect(m.tiles).toEqual([
      { label: "New PRs", value: "27" },
      { label: "Pounds lifted", value: "1.2M" },
      { label: "Longest streak", value: "9 wks" },
      { label: "Top lift", value: "Back Squat", sub: "245 lb" },
    ]);
    expect(m.footerLeft).toBe("Coached by Coach Ron");
    expect(m.orgName).toBe("ENDURING STRENGTH CO.");
    expect(m.footerRight).toBe("spotlightcoaching.app");
  });
  it("kilograms for a kilogram person; no top lift falls back to minutes; no name says Your year", () => {
    const m = buildRecapCardModel({ recap, clientName: null, coachName: null, orgName: null, unit: "kg", topLift: null, seed: "s" });
    expect(m.heading).toBe("Your year");
    expect(m.tiles[1]).toEqual({ label: "Kilos lifted", value: "544K" });
    expect(m.tiles[3]).toEqual({ label: "Minutes trained", value: "8,000" });
    expect(m.footerLeft).toBeNull();
  });
});

describe("the comparison: pop culture first, the count right, no straight quotes, no sources", () => {
  it("the count is the helper's own (real pounds over the thing's weight), and the line reads plainly", () => {
    const line = comparisonLine(1_200_000, "lb", "recap:a:2026")!;
    const eq = getVolumeEquivalence(1_200_000, "recap:a:2026", { popOnly: true })!;
    expect(line.startsWith("That’s 1.2 million pounds, ")).toBe(true);
    expect(line).toContain(eq.label.replace(/'/g, "’"));
    expect(line.endsWith(".")).toBe(true);
    expect(line).not.toMatch(/["']/);
    expect(line).not.toMatch(/about the weight of about|source|Pokédex|handbook/i);
  });
  it("never says about twice, and a tiny or zero volume gives no line", () => {
    for (let v = 10; v < 50_000_000; v *= 3.7) {
      const l = comparisonLine(v, "lb", `seed${v}`);
      if (l) {
        expect(l).not.toMatch(/about the weight of about/);
        expect(l).not.toMatch(/["']/);
      }
    }
    expect(comparisonLine(0, "lb", "s")).toBeNull();
  });
  it("in kilograms for a kilogram person, the same thing compared", () => {
    expect(comparisonLine(1_200_000, "kg", "recap:a:2026")!.startsWith("That’s 544 thousand kilograms, ")).toBe(true);
  });
});

describe("the picture", () => {
  it("draws the year, the title, the four tiles, the line and the footer, and no slogan or verse", () => {
    const texts: string[] = [];
    const grad = { addColorStop: () => {} };
    const ctx: DrawContext = {
      font: "",
      fillStyle: "",
      textAlign: "left",
      textBaseline: "alphabetic",
      globalAlpha: 1,
      fillRect: () => {},
      fillText: (t: string) => void texts.push(t),
      measureText: (t: string) => ({ width: t.length * 20 }),
      createLinearGradient: () => grad,
      createRadialGradient: () => grad,
      beginPath: () => {},
      rect: () => {},
      fill: () => {},
    };
    const theme: RecapTheme = { graphite: "rgb(15, 14, 13)", rust: "rgb(228, 167, 63)", chalk: "rgb(241, 236, 228)", steel: "rgb(185, 181, 174)", fontDisplay: "Oswald", fontBody: "Inter", ink: "rgb(228, 167, 63)", surface: "rgb(26, 24, 22)" };
    const m = buildRecapCardModel({ recap, clientName: "Sam", coachName: "Coach Ron", orgName: "Enduring Strength Co.", unit: "lb", topLift: { name: "Squat", bestWeight: 245 }, seed: "x" });
    drawRecapCard(ctx, m, theme);
    for (const t of ["2026", "Sam’s year", "Showed up", "142 times", "New PRs", "27", "1.2M", "9 wks", "Squat", "245 lb", "Coached by Coach Ron", "spotlightcoaching.app"]) expect(texts, t).toContain(t);
    expect(texts.join(" ")).not.toMatch(/scripture|verse|psalm|proverbs|isaiah|philippians/i);
    expect(withAlpha("rgb(1, 2, 3)", 0.5)).toBe("rgba(1, 2, 3, 0.5)");
  });
});

describe("private, free, and only in its season", () => {
  const page = read("app/(coach)/groups/[groupId]/progress/recap/page.tsx");
  const picture = read("components/athlete/progress/recap-picture.tsx");
  it("only the real signed-in client: never a coach through View as client", () => {
    expect(page).not.toContain("getEffectiveAthlete");
    expect(page).toContain('if (membership.role !== "athlete") {');
    expect(page).toContain(".eq(\"athlete_id\", user.id)");
  });
  it("it leaves the phone only by Share or Save: nothing posted, no link, nothing written", () => {
    expect(picture).toContain("navigator.share({ files: [file]");
    expect(picture).toContain("a.download = fileName;");
    expect(page + picture).not.toMatch(/\.(insert|update|upsert|delete)\(|from\("posts"\)|\/share\//);
    expect(picture).toContain("It stays private until you share it.");
  });
  it("offered Dec 1 to Jan 15, needs 10 workouts, and is never behind a plan", () => {
    expect(page).toContain("const year = recapYearFor(todayKey);");
    expect(page).toContain("Your year recap comes back on December 1 and stays until January 15.");
    expect(page).toContain("const recap = yearRecap(year, logs, liftsOfYear(rollup, year, dateKeyOf), dateKeyOf);");
    expect(page).not.toMatch(/plan|tier|subscription|billing/i);
  });
});
