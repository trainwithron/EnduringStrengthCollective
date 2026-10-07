import type { FunLine, RecentLine } from "@/lib/workout-fun-line";

// What the card remembers about the fun lines a client has seen, kept on the client's own device (no database): the lines they were shown lately (so none repeats
// inside the window) and the line chosen for each workout card (so reloading the same card shows the same line, and the picture they post matches the screen).
// A client who uses two devices can see a repeat across them; that is the cost of keeping this off the database.

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface FunMemory {
  recent: RecentLine[]; // oldest first
  byPost: Record<string, FunLine>;
}

const MAX_STORED_RECENT = 40;
const MAX_STORED_POSTS = 30;

export const memoryKey = (viewerId: string) => `spotlight.funLines.v1:${viewerId}`;

// Removes every viewer's remembered lines from this device (sign-out): they hold the viewer's own workout wording, so they should not outlive the session.
export function clearAllFunLineMemory(storage: (StorageLike & { length: number; key(i: number): string | null; removeItem(k: string): void }) | null): void {
  if (!storage) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && k.startsWith("spotlight.funLines.v1:")) keys.push(k);
    }
    for (const k of keys) storage.removeItem(k);
  } catch {
    // Storage blocked: nothing to clear.
  }
}

const EMPTY = (): FunMemory => ({ recent: [], byPost: {} });

const KINDS = new Set(["stat", "equiv", "absurd", "encourage"]);
const isLine = (l: unknown): l is FunLine =>
  !!l && typeof l === "object" && typeof (l as FunLine).id === "string" && typeof (l as FunLine).text === "string" && KINDS.has((l as FunLine).kind);

// Reads what is stored, tolerating anything wrong with it (missing, not JSON, the wrong shape, storage blocked): the result is just an empty memory.
export function readFunMemory(storage: StorageLike | null, viewerId: string): FunMemory {
  if (!storage) return EMPTY();
  try {
    const raw = storage.getItem(memoryKey(viewerId));
    if (!raw) return EMPTY();
    const parsed = JSON.parse(raw) as Partial<FunMemory>;
    const recent = Array.isArray(parsed.recent)
      ? parsed.recent.filter((r) => r && typeof r.id === "string" && KINDS.has(r.kind)).map((r) => ({ id: r.id, kind: r.kind }))
      : [];
    const byPost: Record<string, FunLine> = {};
    if (parsed.byPost && typeof parsed.byPost === "object") {
      for (const [postId, line] of Object.entries(parsed.byPost)) {
        if (isLine(line)) byPost[postId] = { id: line.id, kind: line.kind, text: line.text };
      }
    }
    return { recent, byPost };
  } catch {
    return EMPTY();
  }
}

export function writeFunMemory(storage: StorageLike | null, viewerId: string, memory: FunMemory): void {
  if (!storage) return;
  try {
    storage.setItem(memoryKey(viewerId), JSON.stringify(memory));
  } catch {
    // Storage full or blocked: the line still shows for this visit, it just is not remembered.
  }
}

// Records that `line` is now the line for this workout card. A reroll replaces the card's earlier line, but that earlier line was still SEEN, so both stay in recent.
export function rememberLine(memory: FunMemory, postId: string, line: FunLine): FunMemory {
  const recent = [...memory.recent.filter((r) => r.id !== line.id), { id: line.id, kind: line.kind }].slice(-MAX_STORED_RECENT);
  const byPost = { ...memory.byPost, [postId]: line };
  const keys = Object.keys(byPost);
  if (keys.length > MAX_STORED_POSTS) {
    // Drop the oldest cards (insertion order); the line a card showed is already in recent.
    for (const k of keys.slice(0, keys.length - MAX_STORED_POSTS)) delete byPost[k];
  }
  return { recent, byPost };
}
