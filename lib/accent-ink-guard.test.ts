import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { surfaceTokensFor } from "@/lib/theme";
import { contrastRatio } from "@/lib/color-contrast";

// The accent as TEXT is always the accent ink (Look Refresh contrast sweep, Nov 20). The plain accent on the app's dark grounds read 3.13:1 for one live
// organization and 2.67:1 for another on a card; the ink (lib/theme.ts surfaceTokensFor) is held at 4.5:1 on every ground. Fills, borders and rings
// (bg-rust, border-rust, ring-rust) stay the accent itself.
const root = join(__dirname, "..");
const PLAIN_ACCENT_TEXT = /(?<![\w-])(?:[a-z-]+:)*text-rust(?![-\w])/;

// Text on a light ground (where the ink, lightened for the dark app, would read worse) may keep the plain accent: name the file and why. None today.
const LIGHT_GROUND_ALLOWED: Record<string, string> = {};

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "node_modules" && e.name !== ".next") sourceFiles(p, out);
    } else if (/\.(tsx?|mjs)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

describe("the accent as text is the accent ink", () => {
  it("no source file uses the plain accent as a text color", () => {
    const offenders: string[] = [];
    for (const dir of ["app", "components", "lib"]) {
      for (const f of sourceFiles(join(root, dir))) {
        const rel = relative(root, f).replace(/\\/g, "/");
        if (LIGHT_GROUND_ALLOWED[rel]) continue;
        const lines = readFileSync(f, "utf8").split(/\r?\n/);
        lines.forEach((line, i) => {
          if (PLAIN_ACCENT_TEXT.test(line)) offenders.push(`${rel}:${i + 1}`);
        });
      }
    }
    expect(offenders).toEqual([]);
  });
  it("the ink reads 4.5:1 on the ground and the cards for every live organization's colors, and leaves an accent that already reads alone", () => {
    for (const [bg, text, accent] of [
      ["#0F0E0D", "#EDE8E0", "#D2703B"],
      ["#0f0e0d", "#f1ece4", "#e4a73f"],
      ["#0A0A0A", "#F5F0E6", "#C8102E"],
      ["#211c1c", "#fecdcd", "#d30000"],
      ["#1C1B1A", "#EDE8E0", "#D2703B"],
    ]) {
      const t = surfaceTokensFor(bg, text, accent);
      for (const ground of [bg, t.surface, t.surface2]) expect(contrastRatio(t.accentInk, ground)!, `${accent} on ${ground}`).toBeGreaterThanOrEqual(4.5);
    }
    expect(surfaceTokensFor("#0f0e0d", "#f1ece4", "#e4a73f").accentInk).toBe("#E4A73F");
  });
});
