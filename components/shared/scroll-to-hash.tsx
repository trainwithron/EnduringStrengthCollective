"use client";

import { useEffect } from "react";

// How long to keep looking for the section: it can be hidden behind a tab that is switched on by another effect, or arrive with data that loads after the page shows.
const TRIES = 40;
const EVERY_MS = 75;
const FLASH = ["ring-2", "ring-rust/60", "ring-offset-2", "ring-offset-graphite"];

/** True when the address names one of these sections ("#sign-in-options"). */
export function hashNames(hash: string, ids: string[]): string | null {
  const id = decodeURIComponent((hash ?? "").replace(/^#/, ""));
  return id && ids.includes(id) ? id : null;
}

// A link to a section of a page ("…?tab=settings#sign-in-options") lands ON that section (the audit, Nov 21: the browser's own jump often misses it, because Next.js renders the page after the
// jump, or the section sits in a tab that is still hidden). When the address names one of `ids`, this waits for the section to be on the page and visible, brings it into view and outlines
// it for a moment so the eye finds it. A later change of the address to another of them does the same. Draws nothing.
export function ScrollToHash({ ids, highlight = true }: { ids: string[]; highlight?: boolean }) {
  const key = ids.join(",");
  useEffect(() => {
    const list = key.split(",");
    let timer: ReturnType<typeof setTimeout> | null = null;
    const go = () => {
      if (timer) clearTimeout(timer);
      const id = hashNames(window.location.hash, list);
      if (!id) return;
      let tries = 0;
      const attempt = () => {
        const el = document.getElementById(id);
        // offsetParent is null while the section (or a tab around it) is hidden
        if (el && (el.offsetParent !== null || el.getClientRects().length > 0)) {
          el.scrollIntoView({ block: "start" });
          if (highlight) {
            el.classList.add(...FLASH);
            setTimeout(() => el.classList.remove(...FLASH), 2000);
          }
          return;
        }
        if (++tries < TRIES) timer = setTimeout(attempt, EVERY_MS);
      };
      attempt();
    };
    go();
    window.addEventListener("hashchange", go);
    return () => {
      window.removeEventListener("hashchange", go);
      if (timer) clearTimeout(timer);
    };
  }, [key, highlight]);
  return null;
}
