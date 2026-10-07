"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { MUTATION_MESSAGE, REFRESH_MESSAGE, debounce, installMutationReporter, paneActivity } from "@/lib/workspace-mutation";

// Inside a workspace pane. It (1) tells the page that holds the pane when something is saved here, (2) refreshes this page's data softly when asked (router.refresh,
// which keeps what is typed), (3) lets the holder see whether saves are still going and whether typed text was never saved (so closing a pane never loses work),
// and (4) makes a link to another site open in a new tab instead of leaving the pane blank. Never shown; never blocks a save.
export function EmbeddedActivityReporter() {
  const router = useRouter();

  useEffect(() => {
    if (window.parent === window) return;
    (window as Window & { __escPane?: typeof paneActivity }).__escPane = paneActivity;

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
    const stopReporting = installMutationReporter(tell);

    function onMessage(e: MessageEvent) {
      if (e.source !== window.parent || e.origin !== window.location.origin || e.data?.type !== REFRESH_MESSAGE) return;
      router.refresh();
    }
    window.addEventListener("message", onMessage);

    // Typed text that has not been saved since: any typing in a field, cleared by the next successful save (lib/workspace-mutation.ts).
    function onInput(e: Event) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) paneActivity.typed = true;
    }
    document.addEventListener("input", onInput, true);

    // A link to another site would be refused in a pane (blank box): open it in a new tab.
    function onClick(e: MouseEvent) {
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target) return;
      try {
        if (new URL(a.href, window.location.href).origin !== window.location.origin) {
          a.target = "_blank";
          a.rel = "noopener noreferrer";
        }
      } catch {
        // not a URL: leave it
      }
    }
    document.addEventListener("click", onClick, true);

    return () => {
      stopReporting();
      window.removeEventListener("message", onMessage);
      document.removeEventListener("input", onInput, true);
      document.removeEventListener("click", onClick, true);
    };
  }, [router]);
  return null;
}
