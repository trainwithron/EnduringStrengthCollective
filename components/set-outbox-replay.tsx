"use client";

import { useEffect } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { SetLogSaver, writeOrDeleteSetLogRow } from "@/lib/set-log-saver";
import { browserOutbox, requestPersistentStorage } from "@/lib/set-outbox";
import { purgeOfflinePages } from "@/lib/offline-pages";

// Opening the app anywhere (not only on the workout screen) sends the sets that were kept on this phone but never reached the server: a closed tab, a restart, a workout done in a dead-signal basement.
// Nothing is shown; the workout screen's own banner covers the case where the person is looking at it. Runs again when the connection returns or the app comes back to the front.
const LAST_USER_KEY = "esc-last-user";

export function SetOutboxReplay() {
  useEffect(() => {
    // The offline layer (public/sw.js): the app's files and an opened workout page stay available with no signal.
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    const supabase = createBrowserClient({ crossOrg: true });
    // Someone signing in starts with no workout pages kept from whoever used the phone before (a session that simply expired never ran the sign-out clean-up).
    // (The sign-in event also fires when a tab regains focus, so it only counts when the person is different from the last one seen on this phone.)
    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event !== "SIGNED_IN" || !session?.user) return;
      try {
        if (window.localStorage.getItem(LAST_USER_KEY) !== session.user.id) purgeOfflinePages();
        window.localStorage.setItem(LAST_USER_KEY, session.user.id);
      } catch {
        purgeOfflinePages();
      }
    });
    const outbox = browserOutbox(async () => (await supabase.auth.getSession()).data.session?.user.id ?? null);
    if (!outbox) return () => authListener.subscription.unsubscribe();
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
          // Only a phone that really holds unsent sets asks the browser to keep its storage (a first-time visitor to a public page must never see that prompt).
          void requestPersistentStorage();
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
      authListener.subscription.unsubscribe();
      window.removeEventListener("online", replay);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return null;
}
