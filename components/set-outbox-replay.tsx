"use client";

import { useEffect } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { SetLogSaver, writeOrDeleteSetLogRow } from "@/lib/set-log-saver";
import { browserOutbox, requestPersistentStorage } from "@/lib/set-outbox";

// Opening the app anywhere (not only on the workout screen) sends the sets that were kept on this phone but never reached the server: a closed tab, a restart, a workout done in a dead-signal basement.
// Nothing is shown; the workout screen's own banner covers the case where the person is looking at it. Runs again when the connection returns or the app comes back to the front.
export function SetOutboxReplay() {
  useEffect(() => {
    // The offline layer (public/sw.js): the app's files and an opened workout page stay available with no signal.
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    const outbox = browserOutbox();
    if (!outbox) return;
    void requestPersistentStorage();
    const supabase = createBrowserClient({ crossOrg: true });
    const saver = new SetLogSaver({
      write: (id, payload) => writeOrDeleteSetLogRow(supabase as never, id, payload),
      outbox,
      backoffMs: [],
    });
    let busy = false;
    const replay = async () => {
      if (busy || (typeof navigator !== "undefined" && navigator.onLine === false)) return;
      busy = true;
      try {
        const kept = await outbox.all();
        if (kept.length > 0) {
          saver.restore(kept);
          await saver.flush();
        }
      } finally {
        busy = false;
      }
    };
    void replay();
    const onVisible = () => {
      if (document.visibilityState === "visible") void replay();
    };
    window.addEventListener("online", replay);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", replay);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return null;
}
