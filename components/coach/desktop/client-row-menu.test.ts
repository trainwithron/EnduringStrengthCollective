import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createConfirmStore, describeConfirm } from "@/lib/confirm-store";

const read = (rel: string) => readFileSync(join(__dirname, "..", "..", "..", rel), "utf8").replace(/\r\n/g, "\n");

describe("the three-dot menu on a client", () => {
  const menu = read("components/coach/desktop/client-row-menu.tsx");
  const list = read("components/coach/desktop/coach-clients-list.tsx");
  it("has the everyday links on top (DK26), then three actions reusing the existing flows (Set inactive, Remove from my clients, Delete permanently), plus Take off hold for a client on hold", () => {
    // one menuitem for the mapped everyday links, then Set inactive, Take off hold, Remove and Delete
    expect(menu.match(/role="menuitem"/g)?.length).toBe(5);
    // Take off hold shows only when the client is held, and uses the same call as the group's client cards (audit, Nov 21: Needs payment said a hold comes off here)
    expect(menu).toMatch(/\{held && \(\s*<button type="button" role="menuitem" onClick=\{\(\) => void takeOffHold\(\)\}/);
    expect(menu).toContain('setPaymentHold(groupId, athleteId, false)');
    expect(read("lib/payment-hold-client.ts")).toContain('fetch("/api/reup/hold"');
    expect(read("components/coach/desktop/client-card-grid.tsx")).toContain('"/api/reup/hold"');
    expect(read("components/coach/desktop/needs-payment-panel.tsx")).toContain("${HOLD_UNDO_WHERE}");
    expect(read("app/(coach)/groups/[groupId]/athletes/[athleteId]/page.tsx")).toContain("<PaymentHoldControl groupId={params.groupId}");
    expect(menu).toContain('supabase.rpc("set_client_inactive"');
    expect(menu).toContain("runDeleteClient(");
    expect(menu).toContain("runRemoveClient(");
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
    expect(menu).toContain('Remove from my {term("client")}s');
    expect(menu).toContain('Delete {term("client")} permanently');
    expect(menu).not.toContain("useRouter"); // it renders without an app router, like the rest of the list
  });
});

describe("one delete flow, no typed name", () => {
  const flow = read("components/coach/delete-client-flow.ts");
  it("is the in-page confirm with the history tick-box, red Delete, Cancel", () => {
    expect(flow).toContain("message: DELETE_CONFIRM(athleteName)");
    expect(flow).toContain('confirmLabel: "Delete"');
    expect(flow).toContain("destructive: true");
    expect(flow).toContain("Also erase their logged workouts and my notes about them");
    expect(flow).toContain("eraseHistory: checked");
    expect(flow).toContain("permanent: true");
    expect(flow).not.toContain("confirmName");
  });
  it("the profile control and the menu both use it, and the profile control has no typed-name step", () => {
    const control = read("components/coach/delete-client-control.tsx");
    expect(control).toContain("runDeleteClient(");
    expect(control).not.toMatch(/Type .* to confirm|confirmName/);
  });
  it("the old erase-at-once route is closed (410): the 30-day way is the only way to erase a client", () => {
    const route = read("app/api/clients/delete/route.ts");
    expect(route).toContain("status: 410");
    expect(route).not.toMatch(/eraseAccount|deleteUser|createServiceRoleClient/);
    // and the real checks live where the erase now happens: the remove route (permanent) and the database function
    const remove = read("app/api/clients/remove/route.ts");
    for (const check of ["rateLimitResponse", "Only a coach of this group can remove a client.", "deletionBlocker("]) expect(remove).toContain(check);
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
