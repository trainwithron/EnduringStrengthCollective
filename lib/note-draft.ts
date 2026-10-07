// An unsaved note kept on THIS phone (never sent anywhere): text typed or dictated that did not reach the server, restored when the screen is reopened.
// It remembers which server note it was typed over (`base`), so it is restored silently only over that same note; if the server note has since changed (the coach
// or another device edited it) the person is asked instead of being overwritten. Drafts older than a week are dropped when read, and every draft is removed at
// sign-out (a shared phone must not keep someone's unsaved pain note).

const PREFIX = "note-draft:";
export const NOTE_DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface NoteDraft {
  base: string;
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

export function noteDraftKey(sessionExerciseId: string): string {
  return PREFIX + sessionExerciseId;
}

export function readNoteDraft(sessionExerciseId: string, now: number = Date.now()): NoteDraft | null {
  const store = storage();
  if (!store) return null;
  const key = noteDraftKey(sessionExerciseId);
  try {
    const raw = store.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<NoteDraft> | null;
    if (!parsed || typeof parsed.text !== "string" || typeof parsed.base !== "string" || typeof parsed.at !== "number") {
      store.removeItem(key);
      return null;
    }
    if (now - parsed.at > NOTE_DRAFT_MAX_AGE_MS) {
      store.removeItem(key);
      return null;
    }
    return { base: parsed.base, text: parsed.text, at: parsed.at };
  } catch {
    return null;
  }
}

export function writeNoteDraft(sessionExerciseId: string, base: string, text: string, now: number = Date.now()): void {
  try {
    storage()?.setItem(noteDraftKey(sessionExerciseId), JSON.stringify({ base, text, at: now } satisfies NoteDraft));
  } catch {
    // storage blocked or full: the autosave still works
  }
}

export function clearNoteDraft(sessionExerciseId: string): void {
  try {
    storage()?.removeItem(noteDraftKey(sessionExerciseId));
  } catch {
    // nothing to clear
  }
}

// At sign-out: every note draft on this phone.
export function clearAllNoteDrafts(): void {
  const store = storage();
  if (!store) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k && k.startsWith(PREFIX)) keys.push(k);
    }
    for (const k of keys) store.removeItem(k);
  } catch {
    // nothing to clear
  }
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
  if (draft.base.trim() === server) return { kind: "restore", text: draft.text };
  return { kind: "ask", text: draft.text };
}
