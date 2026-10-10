import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createConfirmStore, describeConfirm } from "@/lib/confirm-store";

const read = (rel: string) => readFileSync(join(__dirname, "..", "..", "..", rel), "utf8").replace(/\r\n/g, "\n");

describe("the three-dot menu on a client", () => {
  const menu = read("components/coach/desktop/client-row-menu.tsx");
  const list = read("components/coach/desktop/coach-clients-list.tsx");
  it("has exactly two actions, reusing the existing flows", () => {
    expect(menu.match(/role="menuitem"/g)?.length).toBe(2);
    expect(menu).toContain('supabase.rpc("set_client_inactive"');
    expect(menu).toContain("runDeleteClient(");
    expect(menu).not.toContain("/api/clients/delete");
  });
  it("is a 44px, keyboard-reachable control that closes on outside click and Escape and sits outside the card's link", () => {
    expect(menu).toContain("w-11 h-11");
    expect(menu).toContain('aria-haspopup="menu"');
    expect(menu).toContain('e.key === "Escape"');
    expect(menu).toContain('addEventListener("mousedown"');
    expect(list.split("</Link>").some((chunk) => chunk.trimStart().startsWith("<ClientRowMenu") || chunk.trimStart().startsWith('<div className="absolute top-0 right-0"'))).toBe(true);
  });
  it("is on both the card view and the list view, and says the coach's own word for client", () => {
    expect(list.match(/<ClientRowMenu/g)?.length).toBe(2);
    expect(menu).toContain('Delete {term("client")}');
    expect(menu).not.toContain("useRouter"); // it renders without an app router, like the rest of the list
  });
});

describe("one delete flow, no typed name", () => {
  const flow = read("components/coach/delete-client-flow.ts");
  it("is the in-page confirm with the history tick-box, red Delete, Cancel", () => {
    expect(flow).toContain("Delete ${athleteName}? This permanently removes their account and cannot be undone.");
    expect(flow).toContain('confirmLabel: "Delete"');
    expect(flow).toContain("destructive: true");
    expect(flow).toContain("Also erase their logged workouts and my notes about them");
    expect(flow).toContain("eraseHistory: checked");
    expect(flow).not.toContain("confirmName");
  });
  it("the profile control and the menu both use it, and the profile control has no typed-name step", () => {
    const control = read("components/coach/delete-client-control.tsx");
    expect(control).toContain("runDeleteClient(");
    expect(control).not.toMatch(/Type .* to confirm|confirmName/);
  });
  it("the server drops the typed-name requirement but keeps every real check", () => {
    const route = read("app/api/clients/delete/route.ts");
    expect(route).not.toContain("confirmName");
    for (const check of ["rateLimitResponse", "Only the coach of this group can delete a client.", "That person isn't a client in this group.", "don't coach", "deletionBlocker("]) expect(route).toContain(check);
  });
  it("the dialog's tick-box comes back with the answer, and only when confirmed", async () => {
    const store = createConfirmStore();
    const asked = store.askWithChoice({ message: "Delete?", destructive: true, checkbox: { label: "Also", checked: false } });
    expect(store.getSnapshot()?.checkbox).toEqual({ label: "Also", checked: false });
    store.answer(true, true);
    expect(await asked).toEqual({ confirmed: true, checked: true });
    const cancelled = store.askWithChoice({ message: "Delete?", checkbox: { label: "Also" } });
    store.answer(false, true);
    expect(await cancelled).toEqual({ confirmed: false, checked: false });
    expect(describeConfirm("Plain?").checkbox).toBeNull();
  });
});
