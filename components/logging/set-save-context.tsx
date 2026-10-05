"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { SetLogSaver, writeSetLogRow } from "@/lib/set-log-saver";

interface SetSaveApi {
  // Queue a set_logs change. The value stays on screen; failures retry.
  save: (setId: string, payload: Record<string, unknown>) => void;
  // Sets whose last save failed (shown as "not saved").
  failedIds: Set<string>;
  unsavedCount: number;
  retryAll: () => void;
  // Try everything pending right now; true only if all of it saved.
  flush: () => Promise<boolean>;
}

const Ctx = createContext<SetSaveApi | null>(null);

// Without a provider (anywhere a grid renders outside the live logger) saves
// still happen, just without the retry queue.
const FALLBACK: SetSaveApi = {
  save: (setId, payload) => {
    void writeSetLogRow(createBrowserClient() as never, setId, payload);
  },
  failedIds: new Set(),
  unsavedCount: 0,
  retryAll: () => {},
  flush: async () => true,
};

export function useSetSave(): SetSaveApi {
  return useContext(Ctx) ?? FALLBACK;
}

export function SetSaveProvider({ children }: { children: React.ReactNode }) {
  const [failedIds, setFailedIds] = useState<Set<string>>(new Set());
  const [unsavedCount, setUnsavedCount] = useState(0);

  const saverRef = useRef<SetLogSaver | null>(null);
  if (!saverRef.current) {
    const supabase = createBrowserClient();
    saverRef.current = new SetLogSaver({
      write: (id, payload) => writeSetLogRow(supabase as never, id, payload),
      onChange: ({ unsaved, failed }) => {
        setUnsavedCount(unsaved.length);
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
  const retryAll = useCallback(() => saver.retryAll(), [saver]);
  const flush = useCallback(() => saver.flush(), [saver]);

  const api = useMemo<SetSaveApi>(
    () => ({ save, failedIds, unsavedCount, retryAll, flush }),
    [save, failedIds, unsavedCount, retryAll, flush]
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
