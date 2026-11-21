// Drafted messages never ride in the address (review of the desktop audit, Nov 21): the link carries a key, the words are kept in the tab, the conversation reads them back.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { draftKey, draftThreadHref, initialDraftText, isDraftKey, readDraft, stashDraft } from "@/lib/message-draft";
import { DraftMessageLink } from "@/components/messages/draft-message-link";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");

function fakeStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), clear: () => m.clear(), key: () => null, length: 0 };
}

describe("the draft's key", () => {
  const words = "Hi Sam, I noticed you have 4 sessions left that will expire in about 5 days.";
  it("is opaque, the same for the same words, and different for different words", () => {
    const k = draftKey(words);
    expect(isDraftKey(k)).toBe(true);
    expect(k).toBe(draftKey(words));
    expect(k).not.toBe(draftKey(words + " "));
    expect(k).toMatch(/^md-[0-9a-f]{16}$/);
    expect(k).not.toMatch(/sam|session/i);
    expect(draftThreadHref("/groups/g1/messages/a1", words)).toBe(`/groups/g1/messages/a1?draft=${k}`);
    expect(draftThreadHref("/x?tab=messages", words)).toBe(`/x?tab=messages&draft=${k}`);
  });
  it("an older link's words still open as they are; a key opens empty until the tab reads it", () => {
    expect(initialDraftText("Hello there")).toBe("Hello there");
    expect(initialDraftText(draftKey(words))).toBe("");
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
  it("pressing the link keeps the words under the key; the conversation reads them back", () => {
    const words = "Hey Ann, haven't seen you in a bit — just checking in.";
    expect(stashDraft(words)).toBe(true);
    expect(readDraft(draftKey(words))).toBe(words);
    // a key with nothing kept (another tab, a stale link) and anything that is not a key read as empty
    expect(readDraft(draftKey("something else"))).toBe("");
    expect(readDraft("Hello")).toBe("");
  });
  it("storage that throws (private mode, blocked) never breaks anything: the box just opens empty", () => {
    g.window = { sessionStorage: { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } } };
    expect(stashDraft("x")).toBe(false);
    expect(readDraft(draftKey("x"))).toBe("");
  });
});

describe("wiring", () => {
  it("the link renders only the key in its address", () => {
    const html = renderToStaticMarkup(createElement(DraftMessageLink, { threadHref: "/groups/g1/messages/a1", draft: "Hi Sam, your card failed." }, "Message Sam"));
    expect(html).toContain(`href="/groups/g1/messages/a1?draft=${draftKey("Hi Sam, your card failed.")}"`);
    expect(html).not.toContain("card failed");
    const link = read("components/messages/draft-message-link.tsx");
    expect(link).toContain("onClick={keep} onAuxClick={keep}");
  });
  it("the conversation reads a key from the tab after mounting and keeps an older link's words", () => {
    const t = read("components/messages/direct-message-thread.tsx");
    expect(t).toContain("useState(() => initialDraftText(initialDraft))");
    expect(t).toMatch(/if \(!isDraftKey\(initialDraft\)\) return;\s*const words = readDraft\(initialDraft\);/);
  });
  it("no drafted link the coach desktop makes puts the words in the address any more (the calendar's Spotter, which this change may not touch, still works through the old form)", () => {
    for (const f of [
      "lib/needs-you-data.ts",
      "components/coach/payment-problems-section.tsx",
      "components/coach/expiry-checkin-panel.tsx",
      "components/coach/inactive-clients-panel.tsx",
      "components/coach/progress-look-panel.tsx",
      "components/coach/schedule-requests-panel.tsx",
    ]) {
      const s = read(f);
      expect(s, f).not.toMatch(/draft=\$\{encodeURIComponent/);
      expect(s, f).not.toContain("?draft=`");
    }
  });
});
