import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearAllNoteDrafts, clearNoteDraft, decideDraft, NOTE_DRAFT_MAX_AGE_MS, noteDraftKey, readNoteDraft, writeNoteDraft } from "@/lib/note-draft";

function fakeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => (m.has(k) ? (m.get(k) as string) : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  } as Storage;
}

beforeEach(() => {
  (globalThis as unknown as { window: unknown }).window = { localStorage: fakeStorage() };
});
afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
});

describe("the note draft kept on this phone", () => {
  it("is written with the server note it was typed over and read back", () => {
    writeNoteDraft("e1", "Old note", "Old note, plus shoulder tight", 1000);
    expect(readNoteDraft("e1", 2000)).toEqual({ base: "Old note", text: "Old note, plus shoulder tight", at: 1000 });
  });
  it("is dropped when it is older than a week", () => {
    writeNoteDraft("e1", "", "stale", 1000);
    expect(readNoteDraft("e1", 1000 + NOTE_DRAFT_MAX_AGE_MS + 1)).toBeNull();
    expect(window.localStorage.getItem(noteDraftKey("e1"))).toBeNull();
    writeNoteDraft("e2", "", "fresh", 1000);
    expect(readNoteDraft("e2", 1000 + NOTE_DRAFT_MAX_AGE_MS - 1)?.text).toBe("fresh");
  });
  it("a malformed entry is removed, never trusted", () => {
    window.localStorage.setItem(noteDraftKey("e1"), "not json");
    expect(readNoteDraft("e1")).toBeNull();
    window.localStorage.setItem(noteDraftKey("e2"), JSON.stringify({ text: 5 }));
    expect(readNoteDraft("e2")).toBeNull();
    expect(window.localStorage.getItem(noteDraftKey("e2"))).toBeNull();
  });
  it("is cleared one at a time, and ALL of them at sign-out (and nothing else is touched)", () => {
    writeNoteDraft("e1", "", "a");
    writeNoteDraft("e2", "", "b");
    window.localStorage.setItem("esc-workspace-layout", "keep me");
    clearNoteDraft("e1");
    expect(readNoteDraft("e1")).toBeNull();
    expect(readNoteDraft("e2")?.text).toBe("b");
    clearAllNoteDrafts();
    expect(readNoteDraft("e2")).toBeNull();
    expect(window.localStorage.getItem("esc-workspace-layout")).toBe("keep me");
  });
  it("without storage (private mode, server) every call is a quiet no-op", () => {
    delete (globalThis as unknown as { window?: unknown }).window;
    expect(readNoteDraft("e1")).toBeNull();
    expect(() => {
      writeNoteDraft("e1", "", "x");
      clearNoteDraft("e1");
      clearAllNoteDrafts();
    }).not.toThrow();
  });
});

describe("what to do with a kept draft when the screen opens", () => {
  const d = (base: string, text: string) => ({ base, text, at: 1 });
  it("nothing kept: nothing to do", () => {
    expect(decideDraft(null, "Server note")).toEqual({ kind: "none" });
  });
  it("identical to what the server has: discard it", () => {
    expect(decideDraft(d("", "Same"), "Same")).toEqual({ kind: "discard" });
    expect(decideDraft(d("", "Same  "), " Same")).toEqual({ kind: "discard" });
  });
  it("typed over the very note the server still holds: restore it silently (and it gets saved)", () => {
    expect(decideDraft(d("Old note", "Old note, plus more"), "Old note")).toEqual({ kind: "restore", text: "Old note, plus more" });
    expect(decideDraft(d("", "First note"), null)).toEqual({ kind: "restore", text: "First note" });
  });
  it("the server note changed meanwhile (the coach or another device): ask, never overwrite", () => {
    expect(decideDraft(d("Old note", "My edit"), "Coach rewrote it")).toEqual({ kind: "ask", text: "My edit" });
  });
});
