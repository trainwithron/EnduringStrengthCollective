import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (rel: string) => readFileSync(join(__dirname, "..", "..", "..", rel), "utf8").replace(/\r\n/g, "\n");

describe("answering a confirmation does not close the menu it was opened from", () => {
  const menu = read("components/coach/desktop/program-card-menu.tsx");
  it("a click inside the confirmation is not an outside click", () => {
    expect(menu).toContain("target.closest('[role=\"alertdialog\"]')");
    expect(menu.indexOf("target.closest('[role=\"alertdialog\"]')")).toBeLessThan(menu.indexOf("buttonRef.current?.contains(target)"));
  });
  it("Escape inside the confirmation closes only the confirmation", () => {
    expect(menu).toContain("!document.querySelector('[role=\"alertdialog\"]')");
    expect(read("components/shared/confirm-dialog.tsx")).toContain("e.stopPropagation();");
  });
  it("a failed delete shows its error inside the still-open menu", () => {
    expect(menu).toContain("Couldn't delete");
    expect(menu).toContain("{error && (");
  });
});
