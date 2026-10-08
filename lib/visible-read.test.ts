import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { attachVisibleReader, pageIsInFront } from "@/lib/visible-read";

function fakePage(state: "visible" | "hidden", focused = true) {
  const docListeners: (() => void)[] = [];
  const winListeners: (() => void)[] = [];
  const doc = {
    visibilityState: state as string,
    focused,
    hasFocus() {
      return this.focused;
    },
    addEventListener(_t: "visibilitychange", l: () => void) {
      docListeners.push(l);
    },
    removeEventListener(_t: "visibilitychange", l: () => void) {
      docListeners.splice(docListeners.indexOf(l), 1);
    },
  };
  const win = {
    addEventListener(_t: "focus", l: () => void) {
      winListeners.push(l);
    },
    removeEventListener(_t: "focus", l: () => void) {
      winListeners.splice(winListeners.indexOf(l), 1);
    },
  };
  return { doc, win, docListeners, winListeners, becomeVisible: () => { doc.visibilityState = "visible"; docListeners.forEach((l) => l()); }, focusWindow: () => { doc.focused = true; winListeners.forEach((l) => l()); } };
}

describe("a message counts as read only while the page is in front of the coach", () => {
  it("in front: the message is marked read when it arrives", () => {
    const p = fakePage("visible");
    let marks = 0;
    const r = attachVisibleReader({ doc: p.doc, win: p.win, markRead: () => void marks++ });
    r.onArrive();
    expect(marks).toBe(1);
  });
  it("hidden tab: nothing is marked; becoming visible marks once", () => {
    const p = fakePage("hidden");
    let marks = 0;
    const r = attachVisibleReader({ doc: p.doc, win: p.win, markRead: () => void marks++ });
    r.onArrive();
    r.onArrive();
    expect(marks).toBe(0);
    p.becomeVisible();
    expect(marks).toBe(1);
    p.becomeVisible();
    expect(marks).toBe(1);
  });
  it("visible but the window is not focused: it waits for focus", () => {
    const p = fakePage("visible", false);
    let marks = 0;
    const r = attachVisibleReader({ doc: p.doc, win: p.win, markRead: () => void marks++ });
    r.onArrive();
    expect(pageIsInFront(p.doc)).toBe(false);
    expect(marks).toBe(0);
    p.focusWindow();
    expect(marks).toBe(1);
  });
  it("coming back to the front with nothing waiting marks nothing", () => {
    const p = fakePage("hidden");
    let marks = 0;
    attachVisibleReader({ doc: p.doc, win: p.win, markRead: () => void marks++ });
    p.becomeVisible();
    expect(marks).toBe(0);
  });
  it("dispose removes the listeners (a closed thread never marks anything)", () => {
    const p = fakePage("hidden");
    let marks = 0;
    const r = attachVisibleReader({ doc: p.doc, win: p.win, markRead: () => void marks++ });
    r.onArrive();
    r.dispose();
    expect(p.docListeners.length).toBe(0);
    expect(p.winListeners.length).toBe(0);
    p.becomeVisible();
    expect(marks).toBe(0);
  });
});

describe("the thread component uses it", () => {
  const src = readFileSync(resolve(__dirname, "../components/messages/direct-message-thread.tsx"), "utf8").replace(/\r\n/g, "\n");
  it("marks the thread's unread messages from the other person through the reader, and actually sends the update", () => {
    expect(src).toContain("attachVisibleReader(");
    expect(src).toContain("if (row.sender_id === otherId) reader.onArrive();");
    expect(src).toContain('.is("read_at", null)');
    expect(src).toContain(".then(() => undefined)");
    expect(src).toContain("reader.dispose();");
    expect(src).not.toContain('.eq("id", row.id);');
  });
});
