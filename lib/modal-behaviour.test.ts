import { describe, expect, it } from "vitest";
import { attachModal, FOCUSABLE, type DocLike, type FocusableLike, type KeyEventLike } from "@/lib/modal-behaviour";

// A tiny fake page: a document that tracks the focused element and its key listeners, and a dialog with two focusable controls.
function setup() {
  const listeners: ((e: KeyEventLike) => void)[] = [];
  const el = (name: string): FocusableLike & { name: string } => ({
    name,
    focus() {
      doc.activeElement = this;
    },
  });
  const opener = el("opener");
  const first = el("first");
  const last = el("last");
  const doc: DocLike = {
    activeElement: opener,
    body: { style: { overflow: "auto" } },
    addEventListener: (_t, l) => void listeners.push(l),
    removeEventListener: (_t, l) => void listeners.splice(listeners.indexOf(l), 1),
  };
  const dialog = { querySelectorAll: () => [first, last] };
  const press = (key: string, shiftKey = false) => {
    const e = { key, shiftKey, prevented: false, preventDefault() { this.prevented = true; } };
    for (const l of [...listeners]) l(e);
    return e;
  };
  return { doc, dialog, opener, first, last, listeners, press };
}

describe("a modal dialog's behaviour", () => {
  it("moves focus in when it opens and gives it back to what opened it when it closes", () => {
    const t = setup();
    const detach = attachModal({ doc: t.doc, dialog: t.dialog, getOnClose: () => () => {}, initialFocus: t.first });
    expect(t.doc.activeElement).toBe(t.first);
    detach();
    expect(t.doc.activeElement).toBe(t.opener);
  });
  it("Esc closes it, using the latest close function even if the parent made a new one meanwhile", () => {
    const t = setup();
    const calls: string[] = [];
    let current = () => calls.push("old");
    attachModal({ doc: t.doc, dialog: t.dialog, getOnClose: () => current });
    current = () => calls.push("new");
    t.press("Escape");
    expect(calls).toEqual(["new"]);
  });
  it("Tab cycles inside the dialog: from the last control to the first, and Shift+Tab from the first to the last", () => {
    const t = setup();
    attachModal({ doc: t.doc, dialog: t.dialog, getOnClose: () => () => {}, initialFocus: t.first });
    t.doc.activeElement = t.last;
    const forward = t.press("Tab");
    expect(forward.prevented).toBe(true);
    expect(t.doc.activeElement).toBe(t.first);
    const back = t.press("Tab", true);
    expect(back.prevented).toBe(true);
    expect(t.doc.activeElement).toBe(t.last);
  });
  it("Tab in the middle is left alone, and focus that has strayed outside is pulled back in", () => {
    const t = setup();
    attachModal({ doc: t.doc, dialog: t.dialog, getOnClose: () => () => {}, initialFocus: t.first });
    expect(t.press("Tab").prevented).toBe(false); // first to last is the browser's own move
    t.doc.activeElement = t.opener; // somewhere behind the dialog
    const e = t.press("Tab");
    expect(e.prevented).toBe(true);
    expect(t.doc.activeElement).toBe(t.first);
  });
  it("the page behind cannot scroll while it is open, and scrolls again after", () => {
    const t = setup();
    const detach = attachModal({ doc: t.doc, dialog: t.dialog, getOnClose: () => () => {} });
    expect(t.doc.body.style.overflow).toBe("hidden");
    detach();
    expect(t.doc.body.style.overflow).toBe("auto");
  });
  it("closing removes its key listener, so nothing keeps reacting afterwards", () => {
    const t = setup();
    const detach = attachModal({ doc: t.doc, dialog: t.dialog, getOnClose: () => () => {} });
    expect(t.listeners).toHaveLength(1);
    detach();
    expect(t.listeners).toHaveLength(0);
  });
  it("looks for ordinary controls and skips ones taken out of the tab order", () => {
    expect(FOCUSABLE).toContain("button:not([disabled])");
    expect(FOCUSABLE).toContain('[tabindex]:not([tabindex="-1"])');
  });
});
