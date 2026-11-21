// A drafted message that opens in a conversation's box ("Message Sam" with a check-in already written). The draft names the client and their sessions, so it never rides in the address
// (addresses reach server logs; review of the desktop audit, Nov 21): the link carries only an opaque key (?draft=md-…), the words are kept in this tab's sessionStorage under that key when the
// link is pressed (components/messages/draft-message-link.tsx), and the conversation reads them back into its box. Nothing stored: the box opens empty.
// An older link whose ?draft= is the words themselves still opens with them (a panel not moved over yet).

const PREFIX = "spotlight:draft:";
const KEY_RE = /^md-[0-9a-f]{16}$/;

// FNV-1a, twice with different seeds: the same draft always gets the same key, so a page can render the link on the server and the browser agrees (no mismatch), and the key says nothing
// about the words.
function fnv(text: string, seed: number): string {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export function draftKey(text: string): string {
  return `md-${fnv(text, 0x811c9dc5)}${fnv(text, 0x050c5d1f)}`;
}

export function isDraftKey(value: string | null | undefined): boolean {
  return !!value && KEY_RE.test(value);
}

/** The conversation's address with the draft's key: `/groups/g/messages/a?draft=md-…`. */
export function draftThreadHref(threadHref: string, text: string): string {
  return `${threadHref}${threadHref.includes("?") ? "&" : "?"}draft=${draftKey(text)}`;
}

/** Keeps the words for the key (this tab only). False when the browser would not keep them. */
export function stashDraft(text: string): boolean {
  try {
    window.sessionStorage.setItem(PREFIX + draftKey(text), text);
    return true;
  } catch {
    return false;
  }
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
