// An unsaved note kept on THIS phone (never sent anywhere): text typed or dictated that did not reach the server, restored when the screen is reopened.
// It remembers which server note it was typed over, as a HASH of that note (not the note itself: the phone keeps only what the person typed, never a copy of what the
// server holds), so it is restored silently only over that same note; if the server note has since changed (the coach or another device edited it) the person is asked
// instead of being overwritten.
//
// Whose it is: a draft is keyed by the signed-in person, and every draft that belongs to someone else (or to nobody: an older key) is removed when a person opens a note
// screen, so a draft cannot outlive an expired session until a different person signs in and finds it. Drafts older than a week are dropped when read, and every draft is
// removed at sign-out (a shared phone must not keep someone's unsaved pain note).
//
// When a kept draft cannot be restored (the note changed since) it is moved to its own "offer" key while the person decides, so typing in the field meanwhile (which keeps
// writing the normal draft) can never overwrite the text that is being offered back.

const PREFIX = "note-draft:";
const OFFER = "offer:";
export const NOTE_DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface NoteDraft {
  // A hash of the server note this was typed over.
  baseHash: string;
  text: string;
  at: number;
}

export interface NoteOffer {
  text: string;
  at: number;
}

function storage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

// A small, fast, non-cryptographic 53-bit hash (cyrb53). It only has to tell "the same note" from "a different note"; it is not a secret and not a security measure.
export function hashNote(note: string | null | undefined): string {
  const s = (note ?? "").trim();
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

export function noteDraftKey(userId: string, sessionExerciseId: string): string {
  return `${PREFIX}${userId}:${sessionExerciseId}`;
}
export function noteOfferKey(userId: string, sessionExerciseId: string): string {
  return `${PREFIX}${OFFER}${userId}:${sessionExerciseId}`;
}

function readFresh<T extends { at: number }>(key: string, ok: (p: Partial<T>) => boolean, pick: (p: Partial<T>) => T, now: number): T | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<T> | null;
    if (!parsed || !ok(parsed)) {
      store.removeItem(key);
      return null;
    }
    if (now - (parsed.at as number) > NOTE_DRAFT_MAX_AGE_MS) {
      store.removeItem(key);
      return null;
    }
    return pick(parsed);
  } catch {
    return null;
  }
}

export function readNoteDraft(userId: string, sessionExerciseId: string, now: number = Date.now()): NoteDraft | null {
  return readFresh<NoteDraft>(
    noteDraftKey(userId, sessionExerciseId),
    (p) => typeof p.text === "string" && typeof p.baseHash === "string" && typeof p.at === "number",
    (p) => ({ baseHash: p.baseHash as string, text: p.text as string, at: p.at as number }),
    now
  );
}

// `base` is the server note the text was typed over; only its hash is stored.
export function writeNoteDraft(userId: string, sessionExerciseId: string, base: string, text: string, now: number = Date.now()): void {
  try {
    storage()?.setItem(noteDraftKey(userId, sessionExerciseId), JSON.stringify({ baseHash: hashNote(base), text, at: now } satisfies NoteDraft));
  } catch {
    // storage blocked or full: the autosave still works
  }
}

export function clearNoteDraft(userId: string, sessionExerciseId: string): void {
  try {
    storage()?.removeItem(noteDraftKey(userId, sessionExerciseId));
  } catch {
    // nothing to clear
  }
}

export function readNoteOffer(userId: string, sessionExerciseId: string, now: number = Date.now()): NoteOffer | null {
  return readFresh<NoteOffer>(
    noteOfferKey(userId, sessionExerciseId),
    (p) => typeof p.text === "string" && typeof p.at === "number",
    (p) => ({ text: p.text as string, at: p.at as number }),
    now
  );
}

export function writeNoteOffer(userId: string, sessionExerciseId: string, text: string, now: number = Date.now()): void {
  try {
    storage()?.setItem(noteOfferKey(userId, sessionExerciseId), JSON.stringify({ text, at: now } satisfies NoteOffer));
  } catch {
    // storage blocked or full: the offer simply is not kept past this screen
  }
}

export function clearNoteOffer(userId: string, sessionExerciseId: string): void {
  try {
    storage()?.removeItem(noteOfferKey(userId, sessionExerciseId));
  } catch {
    // nothing to clear
  }
}

function removeWhere(test: (key: string) => boolean): void {
  const store = storage();
  if (!store) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k && k.startsWith(PREFIX) && test(k)) keys.push(k);
    }
    for (const k of keys) store.removeItem(k);
  } catch {
    // nothing to clear
  }
}

// At sign-out: every note draft and offer on this phone.
export function clearAllNoteDrafts(): void {
  removeWhere(() => true);
}

// When a person opens a note screen: every draft or offer that is not theirs (another person's, or an older key with no owner) goes, so a draft left behind by an expired
// session is gone before anyone else can reach it.
export function clearOtherUsersDrafts(userId: string): void {
  const mine = `${PREFIX}${userId}:`;
  const myOffers = `${PREFIX}${OFFER}${userId}:`;
  removeWhere((k) => !(k.startsWith(mine) || k.startsWith(myOffers)));
}

// What to do with a kept draft when the screen opens.
export type DraftDecision =
  | { kind: "none" }
  | { kind: "discard" } // identical to what the server already has
  | { kind: "restore"; text: string } // typed over this very server note: put it back and save it
  | { kind: "ask"; text: string }; // the server note changed since: do not overwrite, offer Use it / Discard

export function decideDraft(draft: NoteDraft | null, serverNote: string | null): DraftDecision {
  if (!draft) return { kind: "none" };
  const server = (serverNote ?? "").trim();
  if (draft.text.trim() === server) return { kind: "discard" };
  if (draft.baseHash === hashNote(server)) return { kind: "restore", text: draft.text };
  return { kind: "ask", text: draft.text };
}
