import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");

describe("Duplicate makes an unassigned library program", () => {
  it("the database function makes a plain duplicate not active and a client's copy live", () => {
    const sql = read("supabase/migrations/0351_duplicate_makes_library_program.sql");
    expect(sql).toContain("case when p_athlete_id is null then false else not src.ai_draft end,");
  });
  it("an unassigned program that is not active reads 'In your library', not 'Set active'", () => {
    const toggle = read("components/coach/program-active-toggle.tsx");
    expect(toggle).toContain('unassigned ? "In your library" : "Set active"');
    expect(read("components/coach/desktop/program-card-grid.tsx")).toContain("unassigned={!program.athleteId}");
  });
  it("a program in the library has a plain Assign button and no make-active hint", () => {
    expect(read("components/coach/desktop/program-card-grid.tsx")).toContain("showAssignButton={!program.athleteId && !program.isActive && !program.aiDraft}");
    expect(read("components/coach/desktop/program-card-menu.tsx")).toContain("function openAssign()");
    expect(read("components/coach/program-active-toggle.tsx")).not.toContain("Tap to make it active for the group");
  });
  it("Duplicate to another group never offers a client's one-on-one space", () => {
    expect(read("components/coach/desktop/program-card-menu.tsx")).toContain('.neq("group_kind", "one_on_one")');
  });
});
