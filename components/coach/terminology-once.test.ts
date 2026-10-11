import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (rel: string) => readFileSync(join(__dirname, "..", "..", rel), "utf8").replace(/\r\n/g, "\n");

describe("the what-do-you-call-your-people card is asked once, for good", () => {
  const card = read("components/coach/desktop/terminology-first-run-card.tsx");
  it("is remembered on the coach's profile, not only in this browser", () => {
    expect(card).toContain('update({ terminology_asked_at: new Date().toISOString() })');
    expect(card).toContain("askedOnServer === true");
    expect(card).toContain("if (dismissed || askedOnServer === true) return null;");
    // the browser's memory stays as a fast path
    expect(card).toContain('window.localStorage.setItem(DISMISSED_KEY, "1")');
  });
  it("picking ANY word (the default included) or pressing the X records the answer", () => {
    const chooser = read("components/coach/desktop/terminology-chooser.tsx");
    expect(chooser).toContain("onChosen?.();");
    // the default button sets no override, so it used to leave the card open: it now calls onChosen too
    const defaultBranch = chooser.slice(chooser.indexOf('if (o.id === "default")'), chooser.indexOf("className={`h-11 px-4 border font-body text-sm ${o.selected"));
    expect(defaultBranch).toContain("onChosen?.()");
    expect(card).toContain("onChosen={answered}");
    const dismiss = card.slice(card.indexOf("function dismiss()"), card.indexOf("if (dismissed || askedOnServer"));
    expect(dismiss).toContain("markTerminologyAsked()");
  });
  it("Home reads the flag on its own, so a database without the column does not break Home", () => {
    const home = read("app/(coach)/dashboard/page.tsx");
    expect(home).toContain('.select("terminology_asked_at")');
    expect(home).toContain("askedOnServer={askedRead.error ? null :");
  });
  it("the migration adds one column and marks every existing coach as answered", () => {
    const sql = read("supabase/migrations/0336_terminology_asked.sql");
    expect(sql).toContain("add column if not exists terminology_asked_at timestamptz;");
    expect(sql).toContain("where gm.role = 'coach'");
    expect(sql).not.toMatch(/delete from|drop /);
  });
});
