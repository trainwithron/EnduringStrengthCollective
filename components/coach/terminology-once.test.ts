import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (rel: string) => readFileSync(join(__dirname, "..", "..", rel), "utf8").replace(/\r\n/g, "\n");

// "What do you call your people?" used to be asked once on Home as a first-run card. Clutter audit DK14 (Nov 21): it is set in one place, Organization > Labels, so Home no
// longer asks it. The column that remembered the answer (migration 0336) stays; nothing reads it any more.
describe("what do you call your people", () => {
  it("is not asked on Home", () => {
    const home = read("app/(coach)/dashboard/page.tsx");
    expect(home).not.toContain("TerminologyFirstRunCard");
    expect(home).toContain('.select("full_name, timezone, coach_type")');
  });
  it("picking ANY word (the default included) still tells whoever asked", () => {
    const chooser = read("components/coach/desktop/terminology-chooser.tsx");
    expect(chooser).toContain("onChosen?.();");
    const defaultBranch = chooser.slice(chooser.indexOf('if (o.id === "default")'), chooser.indexOf("className={`h-11 px-4 border font-body text-sm ${o.selected"));
    expect(defaultBranch).toContain("onChosen?.()");
  });
  it("the migration added one column and marked every existing coach as answered", () => {
    const sql = read("supabase/migrations/0336_terminology_asked.sql");
    expect(sql).toContain("add column if not exists terminology_asked_at timestamptz;");
    expect(sql).toContain("where gm.role = 'coach'");
    expect(sql).not.toMatch(/delete from|drop /);
  });
});
