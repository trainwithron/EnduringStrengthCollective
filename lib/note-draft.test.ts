import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearAllNoteDrafts,
  clearNoteDraft,
  clearNoteOffer,
  clearOtherUsersDrafts,
  decideDraft,
  hashNote,
  NOTE_DRAFT_MAX_AGE_MS,
  noteDraftKey,
  noteOfferKey,
  readNoteDraft,
  readNoteOffer,
  writeNoteDraft,
  writeNoteOffer,
} from "@/lib/note-draft";

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

const U = "user-1";

describe("the note draft kept on this phone", () => {
  it("is written with a HASH of the server note it was typed over, never the note itself, and read back", () => {
    writeNoteDraft(U, "e1", "Old note about my shoulder", "Old note about my shoulder, plus tight", 1000);
    expect(readNoteDraft(U, "e1", 2000)).toEqual({ baseHash: hashNote("Old note about my shoulder"), text: "Old note about my shoulder, plus tight", at: 1000 });
    const stored = window.localStorage.getItem(noteDraftKey(U, "e1")) as string;
    // The kept copy holds what the person typed, and a hash of the base, but no second copy of the server note.
    expect(stored).toContain("baseHash");
    expect(JSON.parse(stored)).not.toHaveProperty("base");
    expect(stored.split("Old note about my shoulder").length - 1).toBe(1);
  });
  it("the hash tells one note from another, ignoring surrounding spaces", () => {
    expect(hashNote("same")).toBe(hashNote("  same  "));
    expect(hashNote("same")).not.toBe(hashNote("same."));
    expect(hashNote("")).toBe(hashNote(null));
  });
  it("is dropped when it is older than a week", () => {
    writeNoteDraft(U, "e1", "", "stale", 1000);
    expect(readNoteDraft(U, "e1", 1000 + NOTE_DRAFT_MAX_AGE_MS + 1)).toBeNull();
    expect(window.localStorage.getItem(noteDraftKey(U, "e1"))).toBeNull();
    writeNoteDraft(U, "e2", "", "fresh", 1000);
    expect(readNoteDraft(U, "e2", 1000 + NOTE_DRAFT_MAX_AGE_MS - 1)?.text).toBe("fresh");
  });
  it("a malformed entry is removed, never trusted", () => {
    window.localStorage.setItem(noteDraftKey(U, "e1"), "not json");
    expect(readNoteDraft(U, "e1")).toBeNull();
    window.localStorage.setItem(noteDraftKey(U, "e2"), JSON.stringify({ text: 5 }));
    expect(readNoteDraft(U, "e2")).toBeNull();
    expect(window.localStorage.getItem(noteDraftKey(U, "e2"))).toBeNull();
    // an entry from before the hash (it kept the whole base) is not trusted either
    window.localStorage.setItem(noteDraftKey(U, "e3"), JSON.stringify({ base: "x", text: "y", at: 1 }));
    expect(readNoteDraft(U, "e3")).toBeNull();
  });
  it("is cleared one at a time, and ALL of them at sign-out (and nothing else is touched)", () => {
    writeNoteDraft(U, "e1", "", "a");
    writeNoteDraft(U, "e2", "", "b");
    writeNoteOffer(U, "e2", "offered");
    window.localStorage.setItem("esc-workspace-layout", "keep me");
    clearNoteDraft(U, "e1");
    expect(readNoteDraft(U, "e1")).toBeNull();
    expect(readNoteDraft(U, "e2")?.text).toBe("b");
    clearAllNoteDrafts();
    expect(readNoteDraft(U, "e2")).toBeNull();
    expect(readNoteOffer(U, "e2")).toBeNull();
    expect(window.localStorage.getItem("esc-workspace-layout")).toBe("keep me");
  });
  it("without storage (private mode, server) every call is a quiet no-op", () => {
    delete (globalThis as unknown as { window?: unknown }).window;
    expect(readNoteDraft(U, "e1")).toBeNull();
    expect(readNoteOffer(U, "e1")).toBeNull();
    expect(() => {
      writeNoteDraft(U, "e1", "", "x");
      writeNoteOffer(U, "e1", "x");
      clearNoteDraft(U, "e1");
      clearNoteOffer(U, "e1");
      clearOtherUsersDrafts(U);
      clearAllNoteDrafts();
    }).not.toThrow();
  });
});

describe("a draft belongs to the person who typed it", () => {
  it("is keyed by the signed-in person: someone else cannot read it", () => {
    writeNoteDraft("alice", "e1", "", "Alice's private pain note");
    expect(readNoteDraft("bob", "e1")).toBeNull();
    expect(readNoteDraft("alice", "e1")?.text).toBe("Alice's private pain note");
  });
  it("when a person opens a note screen, every draft and offer that is not theirs is removed (a session that expired leaves nothing for the next person)", () => {
    writeNoteDraft("alice", "e1", "", "alice draft");
    writeNoteOffer("alice", "e1", "alice offer");
    writeNoteDraft("bob", "e2", "", "bob draft");
    writeNoteOffer("bob", "e2", "bob offer");
    // an older key from before drafts had an owner
    window.localStorage.setItem("note-draft:e9", JSON.stringify({ base: "", text: "old", at: 1 }));
    window.localStorage.setItem("esc-workspace-layout", "keep me");
    clearOtherUsersDrafts("bob");
    expect(readNoteDraft("alice", "e1")).toBeNull();
    expect(readNoteOffer("alice", "e1")).toBeNull();
    expect(window.localStorage.getItem("note-draft:e9")).toBeNull();
    expect(readNoteDraft("bob", "e2")?.text).toBe("bob draft");
    expect(readNoteOffer("bob", "e2")?.text).toBe("bob offer");
    expect(window.localStorage.getItem("esc-workspace-layout")).toBe("keep me");
  });
});

describe("an offered draft is kept apart from what is being typed (typing never overwrites it)", () => {
  it("lives under its own key and survives new typing, until it is answered", () => {
    writeNoteOffer(U, "e1", "text from earlier");
    expect(noteOfferKey(U, "e1")).not.toBe(noteDraftKey(U, "e1"));
    writeNoteDraft(U, "e1", "server note", "what I am typing now");
    expect(readNoteOffer(U, "e1")?.text).toBe("text from earlier");
    expect(readNoteDraft(U, "e1")?.text).toBe("what I am typing now");
    clearNoteOffer(U, "e1");
    expect(readNoteOffer(U, "e1")).toBeNull();
    expect(readNoteDraft(U, "e1")?.text).toBe("what I am typing now");
  });
  it("an offer is dropped after a week, like a draft", () => {
    writeNoteOffer(U, "e1", "old", 1000);
    expect(readNoteOffer(U, "e1", 1000 + NOTE_DRAFT_MAX_AGE_MS + 1)).toBeNull();
  });
});

describe("what to do with a kept draft when the screen opens", () => {
  const d = (base: string, text: string) => ({ baseHash: hashNote(base), text, at: 1 });
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
