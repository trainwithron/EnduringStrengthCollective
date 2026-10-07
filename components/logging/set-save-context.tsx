"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { SetLogSaver, SET_LOG_DELETE, writeOrDeleteSetLogRow, writeSetLogRow } from "@/lib/set-log-saver";

interface SetSaveApi {
  // Queue a set_logs change. The value stays on screen; failures retry.
  save: (setId: string, payload: Record<string, unknown>) => void;
  // Remove a set: queued like any other change, retried until the database confirms.
  remove: (setId: string) => void;
  // Sets whose last save failed (shown as "not saved").
  failedIds: Set<string>;
  // Sets with anything still waiting to save (a removal that has not landed yet is in here).
  unsavedIds: Set<string>;
  unsavedCount: number;
  retryAll: () => void;
  // Drop pending saves for sets that were deleted.
  discard: (setIds: string[]) => void;
  // Try everything pending right now; true only if all of it saved (sets AND anything registered below, such as a note).
  flush: () => Promise<boolean>;
  // Something other than a set that must land before the workout is completed (a note): its own flush is run by flush() above. Returns the unregister function.
  registerPending: (flusher: () => Promise<boolean>) => () => void;
}

const Ctx = createContext<SetSaveApi | null>(null);

// Without a provider (anywhere a grid renders outside the live logger) saves
// still happen, just without the retry queue.
const FALLBACK: SetSaveApi = {
  save: (setId, payload) => {
    void writeSetLogRow(createBrowserClient() as never, setId, payload);
  },
  remove: (setId) => {
    void writeOrDeleteSetLogRow(createBrowserClient() as never, setId, { [SET_LOG_DELETE]: true });
  },
  failedIds: new Set(),
  unsavedIds: new Set(),
  unsavedCount: 0,
  retryAll: () => {},
  discard: () => {},
  flush: async () => true,
  registerPending: () => () => {},
};

export function useSetSave(): SetSaveApi {
  return useContext(Ctx) ?? FALLBACK;
}

export function SetSaveProvider({ children }: { children: React.ReactNode }) {
  const [failedIds, setFailedIds] = useState<Set<string>>(new Set());
  const [unsavedCount, setUnsavedCount] = useState(0);
  const [unsavedIds, setUnsavedIds] = useState<Set<string>>(new Set());

  const saverRef = useRef<SetLogSaver | null>(null);
  if (!saverRef.current) {
    const supabase = createBrowserClient();
    saverRef.current = new SetLogSaver({
      write: (id, payload) =>
        writeOrDeleteSetLogRow(supabase as never, id, payload, () => {
          // The workout was finished on another device: show it as it really is instead of leaving a removal that can never save.
          if (typeof window !== "undefined") window.location.reload();
        }),
      onChange: ({ unsaved, failed }) => {
        setUnsavedCount(unsaved.length);
        setUnsavedIds(new Set(unsaved));
        setFailedIds(new Set(failed));
      },
    });
  }
  const saver = saverRef.current;

  // The connection coming back is the best moment to retry.
  useEffect(() => {
    const onOnline = () => saver.retryAll();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [saver]);

  // Leaving with unsaved sets: let the browser warn instead of silently losing them.
  useEffect(() => {
    if (unsavedCount === 0) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [unsavedCount]);

  const save = useCallback((id: string, payload: Record<string, unknown>) => saver.queue(id, payload), [saver]);
  const remove = useCallback((id: string) => saver.queue(id, { [SET_LOG_DELETE]: true }), [saver]);
  const retryAll = useCallback(() => saver.retryAll(), [saver]);
  const pendingRef = useRef(new Set<() => Promise<boolean>>());
  const registerPending = useCallback((flusher: () => Promise<boolean>) => {
    pendingRef.current.add(flusher);
    return () => {
      pendingRef.current.delete(flusher);
    };
  }, []);
  const flush = useCallback(async () => {
    const results = await Promise.all([saver.flush(), ...[...pendingRef.current].map((f) => f().catch(() => false))]);
    return results.every(Boolean);
  }, [saver]);
  const discard = useCallback((ids: string[]) => saver.discard(ids), [saver]);

  const api = useMemo<SetSaveApi>(
    () => ({ save, remove, failedIds, unsavedIds, unsavedCount, retryAll, discard, flush, registerPending }),
    [save, remove, failedIds, unsavedIds, unsavedCount, retryAll, discard, flush, registerPending]
  );

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

// A plain, persistent notice (not a toast that vanishes): nothing the athlete
// logged is lost, but it hasn't reached the server yet.
export function SetSaveBanner() {
  const { failedIds, retryAll } = useSetSave();
  const [busy, setBusy] = useState(false);
  const n = failedIds.size;

  return (
    <div aria-live="polite" role="status">
      {n > 0 && (
        <div className="mx-5 mt-3 border border-amber-400/40 bg-amber-400/10 px-3 py-2.5 flex items-center justify-between gap-3">
          <p className="font-body text-sm text-chalk">
            {n === 1 ? "1 change hasn't saved yet." : `${n} changes haven't saved yet.`}{" "}
            <span className="text-steel">Your numbers are still here — we&apos;ll keep trying.</span>
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              retryAll();
              setTimeout(() => setBusy(false), 1500);
            }}
            className="h-11 px-4 shrink-0 border border-amber-400/60 text-amber-300 font-body text-sm disabled:opacity-50"
          >
            {busy ? "Trying…" : "Retry now"}
          </button>
        </div>
      )}
    </div>
  );
}
