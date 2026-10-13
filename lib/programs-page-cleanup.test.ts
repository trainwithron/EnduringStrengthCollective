import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Ron: the Programs page said "CLIENT PROGRAMS: No individually-assigned programs yet" while clients clearly had programs. Client copies are not cards on this page (one-program model), so that section
// was always empty and wrong. The grid is now one plain list of cards with no inner headings, which also stops the fold from drawing a second "Shared Programs / Client Programs" inside itself.
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const grid = read("components/coach/desktop/program-card-grid.tsx");
const page = read("app/(coach)/programs/page.tsx");

describe("Programs page sections", () => {
  it("never shows the old Client Programs heading or its empty message, or a Shared Programs heading", () => {
    for (const old of ["Client Programs", "No individually-assigned programs yet", "Shared Programs", "No shared programs yet"]) {
      expect(grid, old).not.toContain(old);
    }
    expect(grid).not.toContain("clientPrograms");
    expect(grid).not.toContain("sharedPrograms");
  });
  it("the grid is one list of cards, and the fold shows only cards under its own plain title", () => {
    expect(grid).toContain("{programs.map((p) => (");
    expect(page).toContain("Programs made for one client ({oneClientCards.length})");
  });
  it("library cards keep Assigned to (n)", () => {
    expect(grid).toContain("Assigned to");
  });
});
