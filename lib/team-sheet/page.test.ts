import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

describe("the Team sheet page and its place in the menu", () => {
  it("offers exactly two sheets, a Day sheet and a Week sheet, as a PDF to print or an Excel file; no other layout", () => {
    const f = src("components/coach/team-sheet-download-form.tsx");
    expect(f).toContain('{m === "day" ? "Day sheet" : "Week sheet"}');
    expect(f).toContain("Download PDF to print");
    expect(f).toContain("Download Excel");
    expect(f).not.toMatch(/whole-team|per-athlete/i);
    expect(f).toContain("/api/team-sheet/download?");
    expect(f).toContain("Timed and distance work (a plank, a carry) is not read yet: it goes in Notes.");
  });

  it("the page is for a coach of the group only, and is in the team menu under More", () => {
    const p = src("app/(coach)/groups/[groupId]/team-sheet/page.tsx");
    expect(p).toContain('membership?.role !== "coach"');
    expect(p).toContain('active="team-sheet"');
    expect(src("lib/team-sport.ts")).toContain('{ key: "team-sheet", label: "Team sheet", href: `/groups/${groupId}/team-sheet` }');
    expect(src("components/coach/coach-desktop-shell.tsx")).toContain('| "team-sheet"');
  });

  it("the download is a read, not a write: no database change, no AI", () => {
    const r = src("app/api/team-sheet/download/route.ts");
    expect(r).toContain("export async function GET");
    expect(r).toContain("MAX_BYTES = 4_000_000");
    expect(r).not.toMatch(/\.insert\(|\.update\(|\.upsert\(|\.delete\(|anthropic|openai/i);
  });
});
