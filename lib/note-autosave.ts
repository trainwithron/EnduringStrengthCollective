// Saving a note field without ever losing what was typed or said. Phone dictation commits text in bursts and the field can lose focus a moment later (a tap
// on Complete workout, a swipe, the app going to the background), so the note is saved: shortly after typing pauses, when the field loses focus (reading the
// value from the field itself, never from a possibly stale copy), when the screen is left or hidden, and when the workout is completed. Saves go one at a time
// and the NEWEST text always wins: a slow older save can never overwrite a newer one, and a save that fails leaves the text marked unsaved so the next chance
// (the next pause, blur or leave) tries again.

export interface NoteAutosaver {
  // The text changed: remember it and (re)start the pause timer.
  change: (value: string) => void;
  // Save now (blur, leaving, hidden, completing): resolves when this text, or something newer, is saved or the attempt failed.
  flush: (value?: string) => Promise<boolean>;
  // Try again right now (the Retry button, or the connection coming back).
  retry: () => Promise<boolean>;
  // True while the latest text has not been saved.
  isDirty: () => boolean;
  dispose: () => void;
  // Undo dispose (React StrictMode runs an effect cleanup and then the effect again on the same object): status reporting and retries work again.
  reopen: () => void;
}

export function createNoteAutosaver(opts: {
  initial: string | null;
  write: (trimmed: string | null) => Promise<boolean>;
  onStatus?: (status: "saving" | "saved" | "error") => void;
  delayMs?: number;
  // After a failed save, try again after each of these delays (then stop until the next change, blur or Retry).
  retryDelaysMs?: number[];
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
}): NoteAutosaver {
  const delay = opts.delayMs ?? 1500;
  const retryDelays = opts.retryDelaysMs ?? [2000, 6000, 15000];
  let failures = 0;
  const schedule = opts.schedule ?? ((fn, ms) => setTimeout(fn, ms));
  const cancel = opts.cancel ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  let saved = (opts.initial ?? "").trim();
  let latest = opts.initial ?? "";
  let timer: unknown = null;
  let chain: Promise<boolean> = Promise.resolve(true);
  let disposed = false;

  const dirty = () => latest.trim() !== saved;

  function run(): Promise<boolean> {
    // Each save sends the NEWEST text at the time it actually runs, so queued saves collapse into one and never go out of order.
    chain = chain.then(async () => {
      if (!dirty()) return true;
      const sending = latest.trim();
      if (!disposed) opts.onStatus?.("saving");
      let ok = false;
      try {
        ok = await opts.write(sending || null);
      } catch {
        ok = false;
      }
      if (ok) {
        saved = sending;
        failures = 0;
      } else {
        failures += 1;
        const wait = retryDelays[failures - 1];
        if (wait !== undefined && !disposed) {
          if (timer) cancel(timer);
          timer = schedule(() => {
            timer = null;
            void run();
          }, wait);
        }
      }
      if (!disposed) opts.onStatus?.(ok ? "saved" : "error");
      return ok;
    });
    return chain;
  }

  return {
    change(value) {
      latest = value;
      failures = 0;
      if (timer) cancel(timer);
      timer = schedule(() => {
        timer = null;
        void run();
      }, delay);
    },
    async flush(value) {
      if (value !== undefined) latest = value;
      if (timer) {
        cancel(timer);
        timer = null;
      }
      return run();
    },
    async retry() {
      failures = 0;
      if (timer) {
        cancel(timer);
        timer = null;
      }
      return run();
    },
    isDirty: dirty,
    reopen() {
      disposed = false;
    },
    dispose() {
      disposed = true;
      if (timer) {
        cancel(timer);
        timer = null;
      }
    },
  };
}
