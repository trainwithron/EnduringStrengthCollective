import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (rel: string) => readFileSync(join(__dirname, "..", "..", rel), "utf8").replace(/\r\n/g, "\n");

describe("adding sessions by hand does not ask 'are you sure'; taking them away still does", () => {
  it("the schedule panel's + adds at once and shows the result; its minus still asks", () => {
    const src = read("components/coach/desktop/client-schedule-panel.tsx");
    expect(src).toContain("if (delta < 0 && !await confirmDialog(");
    expect(src).not.toContain('delta > 0 ? "Add" : "Remove"');
    expect(src).toContain("Added one.");
    expect(src).toContain("Balance is now");
  });
  it("the Assign sessions button adds at once, with its own result line", () => {
    const src = read("components/coach/assign-sessions-control.tsx");
    expect(src).not.toContain('confirmLabel: "Add sessions"');
    expect(src).toContain("Added ${n}. ${clientName} now has ${newBalance}.");
    // setting the balance (which can lower it) still asks
    expect(src).toContain('confirmLabel: "Set balance"');
  });
  it("the profile's + adds at once with a result line; its minus still asks", () => {
    const src = read("components/coach/session-credits-control.tsx");
    expect(src).toContain("if (delta < 0 && !await confirmDialog(");
    expect(src).toContain("Added 1.");
    expect(src).not.toContain('"Add session"');
  });
});
