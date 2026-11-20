import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cardRadiiFor, DEFAULT_ORG_THEME, orgThemeToCssVars, surfaceTokensFor } from "@/lib/theme";
import { contrastRatio } from "@/lib/color-contrast";
import { INITIALS_TINTS, initialsTint } from "@/lib/initials";
import { dateLabelFor, daySummary, greetingFor, greetingTitle, recentWins, trainedThisWeek } from "@/lib/home-greeting";

// Look Refresh (Ron, Nov 20: the coach app "feels kind of plain and blocky and lifeless").
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

describe("the skin: card colors, secondary text and lines follow the organization's own colors", () => {
  it("the default theme lands on the mockup's ground, cards and line", () => {
    expect(DEFAULT_ORG_THEME.backgroundColor).toBe("#0F0E0D");
    expect(surfaceTokensFor("#0F0E0D", "#EDE8E0")).toMatchObject({ surface: "#1A1816", surface2: "#23201D", line: "#2E2A26" });
  });
  it("secondary text holds 4.5:1 on cards and raised items for every live organization's colors", () => {
    for (const [bg, text] of [["#0F0E0D", "#EDE8E0"], ["#0f0e0d", "#f1ece4"], ["#050505", "#a4906a"], ["#0A0A0A", "#F5F0E6"], ["#211c1c", "#fecdcd"], ["#1C1B1A", "#EDE8E0"], ["#F7F6F3", "#1C1B1A"]]) {
      const t = surfaceTokensFor(bg, text);
      expect(contrastRatio(t.steel, t.surface2)!, `${bg}/${text}`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(t.steel, t.surface)!, `${bg}/${text}`).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("a light ground steps darker for its cards", () => {
    const t = surfaceTokensFor("#F7F6F3", "#1C1B1A");
    expect(parseInt(t.surface.slice(1, 3), 16)).toBeLessThan(0xf7);
  });
  it("the root carries the new vars; a Sharp organization keeps square cards", () => {
    const vars = orgThemeToCssVars(DEFAULT_ORG_THEME) as Record<string, string>;
    expect(vars["--surface"]).toBe("26 24 22");
    expect(vars["--surface-2"]).toBe("35 32 29");
    expect(vars["--line"]).toBe("46 42 38");
    expect(vars["--r-card"]).toBe("16px");
    expect(cardRadiiFor("sharp")).toEqual({ card: "0px", row: "0px" });
    expect(cardRadiiFor("pill")).toEqual({ card: "16px", row: "10px" });
  });
  it("tailwind reads them, and borders draw quietly from the secondary text color", () => {
    const tw = read("tailwind.config.ts");
    expect(tw).toContain('surface: { DEFAULT: "rgb(var(--surface) / <alpha-value>)", 2: "rgb(var(--surface-2) / <alpha-value>)" },');
    expect(tw).toContain('steel: "rgb(var(--steel) / <alpha-value>)",');
    expect(tw).toContain('steel: "rgb(var(--steel) / calc(<alpha-value> * 0.45))",');
    const css = read("app/globals.css");
    expect(css).toContain(":where(.bg-surface) {\n  border-radius: var(--r-card, 0px);");
    expect(css).toContain(":where(.bg-surface.border-b, .bg-surface.border-t) {\n  border-radius: 0;");
  });
});

describe("round initials, one soft color per person", () => {
  it("the same id always gets the same tint, and every tint reads", () => {
    expect(initialsTint("abc")).toEqual(initialsTint("abc"));
    for (const t of INITIALS_TINTS) expect(contrastRatio(t.fg, t.bg)!).toBeGreaterThanOrEqual(4.5);
    expect(new Set(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].map((k) => initialsTint(k).bg)).size).toBeGreaterThan(2);
  });
  it("the roster and Home lists use them", () => {
    for (const f of ["components/coach/desktop/client-card-grid.tsx", "components/coach/desktop/coach-clients-list.tsx", "components/coach/desktop/home-client-card.tsx", "components/coach/mobile/coach-roster-mobile.tsx", "components/coach/mobile/coach-own-row.tsx"]) {
      expect(read(f), f).toContain("<InitialsAvatar");
    }
  });
});

describe("Home's greeting band", () => {
  const now = new Date("2026-11-20T20:30:00Z");
  it("greets by the coach's own time of day, with their first name", () => {
    expect(greetingFor(now, "America/Chicago")).toBe("Good afternoon");
    expect(greetingFor(new Date("2026-11-20T13:00:00Z"), "America/Chicago")).toBe("Good morning");
    expect(greetingFor(new Date("2026-11-21T01:00:00Z"), "America/Chicago")).toBe("Good evening");
    expect(greetingTitle("Good afternoon", "Ron Arnold")).toBe("Good afternoon, Ron");
    expect(greetingTitle("Good afternoon", null)).toBe("Good afternoon");
    expect(dateLabelFor(now, "America/Chicago")).toBe("Friday, November 20");
  });
  it("one line for the day, from Your day's own counts", () => {
    expect(daySummary(0, 6)).toBe("Nothing on the calendar today. 6 things need you.");
    expect(daySummary(2, 0)).toBe("2 on the calendar today. Nothing needs you right now.");
  });
  it("the ring is the week's active count over the roster", () => {
    expect(trainedThisWeek(5, 22)).toEqual({ active: 5, total: 22, pct: 23 });
    expect(trainedThisWeek(0, 0).pct).toBe(0);
  });
  it("the band replaces the old title and holds the two starts, linking where they already go", () => {
    const page = read("app/(coach)/dashboard/page.tsx");
    expect(page).not.toContain(">Home</h1>");
    expect(page).toContain("href={`/groups/${bandProgramGroupId}/programs/new?library=1`}");
    expect(page).toContain('href="/clients?add=1"');
    expect(read("components/coach/coach-profile-editor.tsx")).toContain("data-home-band");
  });
  it("Wins are clients who trained in the last few days, newest first", () => {
    const wins = recentWins(
      [
        { athleteId: "a", groupId: "g", fullName: "Sawyer Steele", lastWorkoutAt: "2026-11-20T15:00:00Z" },
        { athleteId: "b", groupId: "g", fullName: "Oliver Bourne", lastWorkoutAt: "2026-11-19T15:00:00Z" },
        { athleteId: "c", groupId: "g", fullName: "Old Timer", lastWorkoutAt: "2026-11-01T15:00:00Z" },
        { athleteId: "d", groupId: "g", fullName: "Never", lastWorkoutAt: null },
      ],
      now,
      "America/Chicago"
    );
    expect(wins.map((w) => w.line)).toEqual(["Sawyer Steele logged a workout today", "Oliver Bourne logged a workout yesterday"]);
  });
});
