import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseBalanceInput } from "@/lib/balance-input";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");

describe("a number typed into Sessions left", () => {
  it("takes a whole number from 0 to 500", () => {
    expect(parseBalanceInput("1")).toBe(1);
    expect(parseBalanceInput(" 10 ")).toBe(10);
    expect(parseBalanceInput("0")).toBe(0);
    expect(parseBalanceInput("500")).toBe(500);
  });
  it("reverts (null) for blank, text, negative, decimal or over 500", () => {
    for (const bad of ["", "  ", "abc", "-1", "1.5", "501", "1e2", "99999"]) expect(parseBalanceInput(bad)).toBeNull();
  });
});

describe("both Sessions left controls are typeable and keep - and +", () => {
  const panel = read("components/coach/desktop/client-schedule-panel.tsx");
  const profile = read("components/coach/session-credits-control.tsx");
  const editable = read("components/coach/editable-balance.tsx");

  it("use the editable number with the set-balance path", () => {
    expect(panel).toContain("<EditableBalance value={balance}");
    expect(profile).toContain("<EditableBalance value={balance}");
    for (const src of [panel, profile]) {
      expect(src).toContain("setClientBalance(createBrowserClient()");
      expect(src).toContain("onClick={() => adjustCredits(-1)}".replace("adjustCredits", src === panel ? "adjustCredits" : "adjust"));
    }
  });
  it("raising asks nothing, lowering asks once", () => {
    for (const src of [panel, profile]) expect(src).toContain("next < balance && !await confirmDialog(");
  });
  it("Enter and leaving the box save, Escape reverts, and it has a label", () => {
    expect(editable).toContain('e.key === "Enter"');
    expect(editable).toContain('e.key === "Escape"');
    expect(editable).toContain("onBlur=");
    expect(editable).toContain("aria-label={label}");
  });
});
