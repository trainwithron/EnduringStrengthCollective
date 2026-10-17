// The phone's own copy of every logged set that has not reached the server yet. The retry queue (lib/set-log-saver.ts) used to live in memory only, so a closed tab, a phone restart or a killed
// browser lost the sets in it. Each change is written here first (IndexedDB), and removed only when the database confirms it. On the next open the leftovers are sent again.
// A set row already exists with its own id when the workout starts, so sending a change again is safe: it is an update by id, not a new row.

export interface OutboxEntry {
  id: string; // the set_logs row id
  payload: Record<string, unknown>; // the merged change still to send
  savedAt: number; // when it was first kept on this phone
}

export interface OutboxStore {
  put(entry: OutboxEntry): Promise<void>;
  remove(id: string): Promise<void>;
  all(): Promise<OutboxEntry[]>;
}

// Changes older than this are dropped on read (a set nobody has sent in a month is not coming back).
export const OUTBOX_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export class MemoryOutbox implements OutboxStore {
  private rows = new Map<string, OutboxEntry>();
  async put(entry: OutboxEntry) {
    this.rows.set(entry.id, entry);
  }
  async remove(id: string) {
    this.rows.delete(id);
  }
  async all() {
    return [...this.rows.values()];
  }
}

const DB_NAME = "esc-outbox";
const STORE = "sets";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// IndexedDB when the browser has it (a private window or old browser may refuse); every call fails quietly into "nothing kept", never into a broken workout.
export class IndexedDbOutbox implements OutboxStore {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private db(): Promise<IDBDatabase> {
    if (!this.dbPromise) this.dbPromise = openDb();
    return this.dbPromise;
  }
  async put(entry: OutboxEntry) {
    try {
      const db = await this.db();
      await done(db.transaction(STORE, "readwrite").objectStore(STORE).put(entry));
    } catch {
      // not kept on this phone; the in-memory retry still runs
    }
  }
  async remove(id: string) {
    try {
      const db = await this.db();
      await done(db.transaction(STORE, "readwrite").objectStore(STORE).delete(id));
    } catch {
      // nothing to remove
    }
  }
  async all() {
    try {
      const db = await this.db();
      const rows = (await done(db.transaction(STORE, "readonly").objectStore(STORE).getAll())) as OutboxEntry[];
      const cutoff = Date.now() - OUTBOX_MAX_AGE_MS;
      return rows.filter((r) => r && typeof r.id === "string" && r.savedAt >= cutoff);
    } catch {
      return [];
    }
  }
}

export function browserOutbox(): OutboxStore | null {
  return typeof indexedDB === "undefined" ? null : new IndexedDbOutbox();
}

// Ask the browser not to clear what the app keeps on the phone when storage runs low. Harmless when refused or unsupported.
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (typeof navigator === "undefined" || !navigator.storage?.persist) return false;
    if (await navigator.storage.persisted?.()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
