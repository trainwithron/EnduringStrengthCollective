// Drafted messages never ride in the address (review of the desktop audit, Nov 21): the page links the plain conversation; a press makes a random key, keeps the words in the tab under it and
// opens the conversation with ?draft=<key>; the conversation reads them back. A new tab, or nothing kept, opens an empty box; an older ?draft=<words> link still works.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { initialDraftText, isDraftKey, newDraftKey, readDraft, stashDraft, withDraftKey } from "@/lib/message-draft";
import { DraftMessageLink } from "@/components/messages/draft-message-link";
// a drafted-message link opens the conversation through the app's router
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");

function fakeStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), clear: () => m.clear(), key: () => null, length: 0 };
}

describe("the draft's key", () => {
  it("is random: a new one every time, never made from the words", () => {
    const a = newDraftKey();
    const b = newDraftKey();
    expect(isDraftKey(a)).toBe(true);
    expect(a).toMatch(/^md-[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
    expect(withDraftKey("/groups/g1/messages/a1", a)).toBe(`/groups/g1/messages/a1?draft=${a}`);
    expect(withDraftKey("/x?tab=messages", a)).toBe(`/x?tab=messages&draft=${a}`);
    expect(read("lib/message-draft.ts")).not.toMatch(/createHash|fnv|Math\.imul/i);
  });
  it("an older link's words still open as they are; a key opens empty until the tab reads it", () => {
    expect(initialDraftText("Hello there")).toBe("Hello there");
    expect(initialDraftText(newDraftKey())).toBe("");
    expect(initialDraftText(undefined)).toBe("");
  });
});

describe("kept in this tab", () => {
  const g = globalThis as unknown as { window?: unknown };
  let before: unknown;
  beforeEach(() => {
    before = g.window;
    g.window = { sessionStorage: fakeStorage() };
  });
  afterEach(() => {
    g.window = before;
  });
  it("a press keeps the words under a fresh key; the conversation reads them back by it", () => {
    const words = "Hey Ann, haven't seen you in a bit — just checking in.";
    const k1 = stashDraft(words)!;
    const k2 = stashDraft(words)!;
    expect(isDraftKey(k1)).toBe(true);
    expect(k1).not.toBe(k2);
    expect(readDraft(k1)).toBe(words);
    // a key with nothing kept (another tab, a stale link) and anything that is not a key read as empty
    expect(readDraft(newDraftKey())).toBe("");
    expect(readDraft("Hello")).toBe("");
  });
  it("storage that throws (private mode, blocked) never breaks anything: no key, and the box opens empty", () => {
    g.window = { sessionStorage: { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } } };
    expect(stashDraft("x")).toBeNull();
    expect(readDraft(newDraftKey())).toBe("");
  });
});

describe("wiring", () => {
  it("the page links the plain conversation: no words and no key in the address until it is pressed", () => {
    const html = renderToStaticMarkup(createElement(DraftMessageLink, { threadHref: "/groups/g1/messages/a1", draft: "Hi Sam, your card failed." }, "Message Sam"));
    expect(html).toContain('href="/groups/g1/messages/a1"');
    expect(html).not.toContain("?draft=");
    expect(html).not.toContain("card failed");
    const link = read("components/messages/draft-message-link.tsx");
    // a plain press: a random key, the words kept, then the conversation with the key; a new-tab press is left to the browser (empty box)
    expect(link).toContain("if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;");
    expect(link).toMatch(/e\.preventDefault\(\);\s*const key = stashDraft\(draft\);\s*const href = key \? withDraftKey\(threadHref, key\) : threadHref;\s*router\.push\(href\);/);
    expect(link).toContain("<Link prefetch={false} href={threadHref} onClick={open}");
  });
  it("the conversation reads a key from the tab after mounting and keeps an older link's words", () => {
    const t = read("components/messages/direct-message-thread.tsx");
    expect(t).toContain("useState(() => initialDraftText(initialDraft))");
    expect(t).toMatch(/if \(!isDraftKey\(initialDraft\)\) return;\s*const words = readDraft\(initialDraft\);/);
  });
  it("no drafted link the coach desktop makes puts the words, or a key, in the address it draws", () => {
    for (const f of [
      "lib/needs-you-data.ts",
      "components/coach/payment-problems-section.tsx",
      "components/coach/expiry-checkin-panel.tsx",
      "components/coach/inactive-clients-panel.tsx",
      "components/coach/progress-look-panel.tsx",
      "components/coach/schedule-requests-panel.tsx",
    ]) {
      const s = read(f);
      expect(s, f).not.toContain("?draft=");
      expect(s, f).not.toContain("&draft=");
    }
  });
});
