// A drafted message that opens in a conversation's box ("Message Sam" with a check-in already written). The draft names the client and their sessions, so it never rides in the address
// (addresses reach server logs; review of the desktop audit, Nov 21). The link itself is the plain conversation; when it is pressed, a RANDOM key is made right then, the words are kept in
// this tab's sessionStorage under it, and the conversation opens with ?draft=<that key> and reads the words back into its box (components/messages/draft-message-link.tsx). The key says
// nothing about the words and cannot be worked back to them. Opened in a new tab, or with nothing kept, the box opens empty.
// An older link whose ?draft= is the words themselves still opens with them.

const PREFIX = "spotlight:draft:";
const KEY_RE = /^md-[0-9a-f]{32}$/;

export function isDraftKey(value: string | null | undefined): boolean {
  return !!value && KEY_RE.test(value);
}

/** A new random key (128 bits). */
export function newDraftKey(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return `md-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** Keeps the words in this tab under a new random key and returns the key, or null when the browser would not keep them. */
export function stashDraft(text: string): string | null {
  try {
    const key = newDraftKey();
    window.sessionStorage.setItem(PREFIX + key, text);
    return key;
  } catch {
    return null;
  }
}

/** The conversation's address with a key: `/groups/g/messages/a?draft=md-…`. */
export function withDraftKey(threadHref: string, key: string): string {
  return `${threadHref}${threadHref.includes("?") ? "&" : "?"}draft=${key}`;
}

/** The words for a key, or "" when there are none (another tab, storage blocked, a stale link). */
export function readDraft(key: string): string {
  if (!isDraftKey(key)) return "";
  try {
    return window.sessionStorage.getItem(PREFIX + key) ?? "";
  } catch {
    return "";
  }
}

/** What the box opens with on first render: an old-style ?draft= (the words themselves) as it was; a key opens empty until the browser reads it (readDraft, after mounting). */
export function initialDraftText(param: string | null | undefined): string {
  if (!param || isDraftKey(param)) return "";
  return param;
}
