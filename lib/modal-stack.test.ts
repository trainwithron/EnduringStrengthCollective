import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { anotherModalIsOpen, releaseScrollLock } from "@/lib/modal-stack";

const fakeDoc = (count: number) => {
  const body = { style: { overflow: "hidden" } };
  return { querySelectorAll: () => ({ length: count }) as unknown as NodeListOf<Element>, querySelector: () => (count > 0 ? ({} as Element) : null), body };
};

describe("two dialogs open at once", () => {
  it("Escape belongs to the top dialog: a lower one stays open while another is present", () => {
    expect(anotherModalIsOpen(fakeDoc(2) as never)).toBe(true);
    expect(anotherModalIsOpen(fakeDoc(1) as never)).toBe(false);
    expect(anotherModalIsOpen(fakeDoc(0) as never)).toBe(false);
  });
  it("the page scrolls again only when no dialog is left, whatever order they close in", async () => {
    const left = fakeDoc(1);
    releaseScrollLock(left as never);
    await Promise.resolve();
    expect(left.body.style.overflow).toBe("hidden");
    const none = fakeDoc(0);
    releaseScrollLock(none as never);
    await Promise.resolve();
    expect(none.body.style.overflow).toBe("");
  });
  it("both sheets use it, and neither restores a value it saved earlier", () => {
    const read = (p: string) => readFileSync(resolve(__dirname, p), "utf8");
    for (const f of ["../components/coach/desktop/client-preview.tsx", "../components/logging/demo-sheet.tsx"]) {
      const src = read(f);
      expect(src).toContain("releaseScrollLock()");
      expect(src).not.toContain("document.body.style.overflow = prev");
    }
    expect(read("../components/coach/desktop/client-preview.tsx")).toContain("!anotherModalIsOpen()");
  });
});
