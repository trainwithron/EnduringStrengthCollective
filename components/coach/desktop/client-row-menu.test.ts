import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (rel: string) => readFileSync(join(__dirname, "..", "..", "..", rel), "utf8").replace(/\r\n/g, "\n");

describe("the three-dot menu on a client", () => {
  const menu = read("components/coach/desktop/client-row-menu.tsx");
  const list = read("components/coach/desktop/coach-clients-list.tsx");
  it("has exactly two actions, reusing the existing flows (no second delete dialog)", () => {
    expect(menu.match(/role="menuitem"/g)?.length).toBe(2);
    expect(menu).toContain('supabase.rpc("set_client_inactive"');
    expect(menu).toContain("<DeleteClientControl");
    expect(menu).toContain("defaultOpen");
    expect(menu).not.toContain("/api/clients/delete");
  });
  it("is a 44px, keyboard-reachable control that closes on outside click and Escape and sits outside the card's link", () => {
    expect(menu).toContain("w-11 h-11");
    expect(menu).toContain('aria-haspopup="menu"');
    expect(menu).toContain('e.key === "Escape"');
    expect(menu).toContain('addEventListener("mousedown"');
    // in the list, the menu is a sibling of the Link, never inside it
    const afterLink = list.split("</Link>");
    expect(afterLink.some((chunk) => chunk.trimStart().startsWith("<ClientRowMenu") || chunk.trimStart().startsWith('<div className="absolute top-0 right-0"'))).toBe(true);
  });
  it("is on both the card view and the list view, and says the coach's own word for client", () => {
    expect(list.match(/<ClientRowMenu/g)?.length).toBe(2);
    expect(menu).toContain('Delete {term("client")}');
  });
  it("the delete panel opens straight to the existing confirm and its Cancel closes the menu's overlay", () => {
    const control = read("components/coach/delete-client-control.tsx");
    expect(control).toContain("defaultOpen = false");
    expect(control).toContain("onCancel?.();");
    expect(control).toContain("Type {athleteName} to confirm");
  });
});
