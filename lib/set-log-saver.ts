// A logged set must never be lost to a bad gym signal. Writes to set_logs go
// through this queue instead of fire-and-forget-then-revert: the typed value
// always stays on screen, a failed write is retried with backoff, and anything
// still unsaved is surfaced to the athlete (and blocks "Complete workout"
// until it lands). A write only counts as saved when the database confirms
// exactly one row was updated — a 0-row update (RLS, a deleted row) is a
// failure, not a success.

// A queued change with this key set to true means "delete this set" instead of "update it": removing a set rides the same retry queue, so
// it survives a bad signal exactly like a logged value does. A delete wins over any update queued for the same set.
export const SET_LOG_DELETE = "__delete";

export type SetLogWrite = (id: string, payload: Record<string, unknown>) => Promise<boolean>;

export interface SetLogSaverOptions {
  write: SetLogWrite;
  // Called whenever the set of unsaved/failed ids changes.
  onChange?: (state: { unsaved: string[]; failed: string[] }) => void;
  // Delay before automatic retry n (1-based); once exhausted, retries stop
  // until the athlete taps "Retry now" or the connection returns.
  backoffMs?: number[];
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
}

interface Entry {
  payload: Record<string, unknown>;
  version: number; // bumped on every queue(), so newer edits aren't lost to an older in-flight write
  attempts: number; // consecutive failures since the last queue()/retry
  inflight: Promise<boolean> | null;
  timer: unknown;
}

export const DEFAULT_SET_SAVE_BACKOFF_MS = [1000, 3000, 8000, 20000];

export class SetLogSaver {
  private entries = new Map<string, Entry>();
  private readonly backoff: number[];
  private readonly schedule: (fn: () => void, ms: number) => unknown;
  private readonly cancel: (handle: unknown) => void;

  constructor(private readonly opts: SetLogSaverOptions) {
    this.backoff = opts.backoffMs ?? DEFAULT_SET_SAVE_BACKOFF_MS;
    this.schedule = opts.schedule ?? ((fn, ms) => setTimeout(fn, ms));
    this.cancel = opts.cancel ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  get unsaved(): string[] {
    return [...this.entries.keys()];
  }

  // Ids with at least one failed attempt (the ones worth showing as "not saved").
  get failed(): string[] {
    return [...this.entries.entries()].filter(([, e]) => e.attempts > 0).map(([id]) => id);
  }

  // Merge a change for one set and start saving it right away.
  queue(id: string, payload: Record<string, unknown>): void {
    let entry = this.entries.get(id);
    if (!entry) {
      entry = { payload: {}, version: 0, attempts: 0, inflight: null, timer: null };
      this.entries.set(id, entry);
    }
    entry.payload = { ...entry.payload, ...payload };
    entry.version += 1;
    entry.attempts = 0;
    if (entry.timer) {
      this.cancel(entry.timer);
      entry.timer = null;
    }
    this.notify();
    void this.run(id);
  }

  // Forget pending changes for sets that no longer exist (an exercise was removed). Without this a write for a deleted
  // row updates zero rows, counts as a failure, and blocks Complete workout forever.
  discard(ids: string[]): void {
    let changed = false;
    for (const id of ids) {
      const entry = this.entries.get(id);
      if (!entry) continue;
      if (entry.timer) {
        this.cancel(entry.timer);
        entry.timer = null;
      }
      this.entries.delete(id);
      changed = true;
    }
    if (changed) this.notify();
  }

  // Try everything unsaved again now (manual "Retry now", or the network is back).
  retryAll(): void {
    for (const [id, entry] of this.entries) {
      if (entry.timer) {
        this.cancel(entry.timer);
        entry.timer = null;
      }
      entry.attempts = 0;
      void this.run(id);
    }
  }

  // Resolves true only if every pending change ended up saved.
  async flush(): Promise<boolean> {
    for (const [id, entry] of this.entries) {
      if (entry.timer) {
        this.cancel(entry.timer);
        entry.timer = null;
      }
      entry.attempts = 0;
      void id;
    }
    await Promise.all(this.unsaved.map((id) => this.run(id)));
    return this.entries.size === 0;
  }

  private async run(id: string): Promise<boolean> {
    const entry = this.entries.get(id);
    if (!entry) return true;
    if (entry.inflight) return entry.inflight;

    const attempt = (async (): Promise<boolean> => {
      for (;;) {
        const current = this.entries.get(id);
        if (!current) return true;
        const version = current.version;
        const payload = { ...current.payload };
        let ok = false;
        try {
          ok = await this.opts.write(id, payload);
        } catch {
          ok = false;
        }
        const after = this.entries.get(id);
        if (!after) return true;
        if (ok) {
          if (after.version === version) {
            this.entries.delete(id);
            this.notify();
            return true;
          }
          continue; // newer edits arrived while saving — save those too
        }
        after.attempts += 1;
        this.notify();
        return false;
      }
    })();

    entry.inflight = attempt;
    const ok = await attempt;
    const latest = this.entries.get(id);
    if (latest) latest.inflight = null;
    if (!ok && latest) this.scheduleRetry(id, latest);
    return ok;
  }

  private scheduleRetry(id: string, entry: Entry): void {
    const delay = this.backoff[entry.attempts - 1];
    if (delay === undefined) return; // exhausted: wait for a manual retry / reconnect
    entry.timer = this.schedule(() => {
      entry.timer = null;
      void this.run(id);
    }, delay);
  }

  private notify(): void {
    this.opts.onChange?.({ unsaved: this.unsaved, failed: this.failed });
  }
}

// One real write to set_logs; true only when exactly one row was updated.
export async function writeSetLogRow(
  client: {
    from: (table: string) => {
      update: (v: Record<string, unknown>) => {
        eq: (c: string, v: string) => { select: (cols: string) => PromiseLike<{ data: unknown[] | null; error: unknown }> };
      };
    };
  },
  id: string,
  payload: Record<string, unknown>
): Promise<boolean> {
  const { data, error } = await client.from("set_logs").update(payload).eq("id", id).select("id");
  return !error && Array.isArray(data) && data.length === 1;
}

// An error no retry can fix: the workout was finished (on another device) while this one was still open, so the database refuses any change to its sets.
export function isTerminalSetLogError(error: unknown): boolean {
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === "string" && message.toLowerCase().includes("already completed");
}

// Delete one set. A row that is already gone counts as done (a retry after a delete that actually landed must not fail forever); any other error stays a
// failure and stays visible as "not saved". The one exception is a finished workout: retrying can never succeed and would block Complete forever, so it
// counts as done and `onTerminal` lets the screen reload to show the workout as it really is.
export async function deleteSetLogRow(
  client: {
    from: (table: string) => {
      delete: () => {
        eq: (c: string, v: string) => { select: (cols: string) => PromiseLike<{ data: unknown[] | null; error: unknown }> };
      };
    };
  },
  id: string,
  onTerminal?: () => void
): Promise<boolean> {
  const { error } = await client.from("set_logs").delete().eq("id", id).select("id");
  if (error && isTerminalSetLogError(error)) {
    onTerminal?.();
    return true;
  }
  return !error;
}

// Routes one queued change to the right write.
export async function writeOrDeleteSetLogRow(
  client: Parameters<typeof writeSetLogRow>[0] & Parameters<typeof deleteSetLogRow>[0],
  id: string,
  payload: Record<string, unknown>,
  onTerminal?: () => void
): Promise<boolean> {
  return payload[SET_LOG_DELETE] === true ? deleteSetLogRow(client, id, onTerminal) : writeSetLogRow(client, id, payload);
}
