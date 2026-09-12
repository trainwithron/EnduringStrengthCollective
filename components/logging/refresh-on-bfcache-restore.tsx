"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Real bug this fixes: starting a workout, then navigating back (a
// browser/OS back gesture, not a Link click) lands back on the
// workout-overview page still showing "Start Workout" instead of
// "Resume Workout" — even though the in-progress session (and
// everything already logged in it) is sitting there untouched in the
// database. A plain reload of the same URL always shows the correct
// state; only the back-navigated render is stale.
//
// Diagnosed directly rather than assumed: the `pageshow` event's
// `persisted` flag (the standard "restored from bfcache" signal) never
// fires for this — Next.js's App Router intercepts back/forward
// navigation itself and serves the target route from its own client-side
// Router Cache, a separate mechanism from the browser's bfcache, and
// this app's existing `staleTimes.dynamic = 0` (next.config.mjs) doesn't
// reliably invalidate that cache specifically for a back/forward
// navigation. A `popstate` listener attached inside this component
// doesn't help either: popstate fires as history moves to this page,
// which happens before this component's own effect can attach on the
// resulting (re)mount, so the event is already missed by the time
// anything here could listen for it.
//
// The fix that actually works: unconditionally refresh once whenever
// this page mounts. router.refresh() re-fetches this route's server
// data in place without remounting this component, so it can't loop —
// it costs one small extra round trip on a normal first visit, in
// exchange for a back-navigated visit never showing stale session state.
export function RefreshOnBfcacheRestore() {
  const router = useRouter();

  useEffect(() => {
    router.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
