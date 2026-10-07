"use client";

import { useEffect } from "react";
import { MUTATION_MESSAGE, debounce, installMutationReporter } from "@/lib/workspace-mutation";

// Inside a workspace pane: when something is saved here, tell the page that holds the pane so the other panes and the page itself show it (see
// components/coach/workspace/workspace-context.tsx). Never shown, never blocks a save.
export function EmbeddedActivityReporter() {
  useEffect(() => {
    if (window.parent === window) return;
    // Saves a page makes while it is still loading (a "last seen" mark) are not the coach's edits: ignored for the first few seconds, so a reload cannot set off another.
    const bornAt = Date.now();
    const tell = debounce(() => {
      if (Date.now() - bornAt < 4000) return;
      try {
        window.parent.postMessage({ type: MUTATION_MESSAGE }, window.location.origin);
      } catch {
        // The holder is gone: nothing to tell.
      }
    }, 300);
    return installMutationReporter(tell);
  }, []);
  return null;
}
