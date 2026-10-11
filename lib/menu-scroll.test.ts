import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { scrollIsInsideMenu } from "@/lib/menu-scroll";

// A tiny stand-in for a DOM tree: a node contains itself and its descendants.
class Fake {
  children: Fake[] = [];
  contains(other: unknown): boolean {
    if (!(other instanceof Fake)) throw new TypeError("not a Node");
    return other === this || this.children.some((c) => c.contains(other));
  }
}

describe("a menu closes when the page scrolls, not when its own list does", () => {
  it("tells a scroll inside the menu from a scroll outside it", () => {
    const menu = new Fake();
    const list = new Fake();
    menu.children.push(list);
    const elsewhere = new Fake();
    const asTarget = (x: unknown) => x as EventTarget;
    expect(scrollIsInsideMenu(menu, asTarget(menu))).toBe(true);
    expect(scrollIsInsideMenu(menu, asTarget(list))).toBe(true);
    expect(scrollIsInsideMenu(menu, asTarget(elsewhere))).toBe(false);
    // the window is not a node: contains() throws, which counts as outside
    expect(scrollIsInsideMenu(menu, asTarget({}))).toBe(false);
    expect(scrollIsInsideMenu(null, asTarget(list))).toBe(false);
    expect(scrollIsInsideMenu(menu, null)).toBe(false);
  });
  it("the program card menu uses it before closing", () => {
    const src = readFileSync(join(__dirname, "..", "components/coach/desktop/program-card-menu.tsx"), "utf8").replace(/\r\n/g, "\n");
    expect(src).toContain("if (scrollIsInsideMenu(menuRef.current, e.target)) return;");
  });
});
