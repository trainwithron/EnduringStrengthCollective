"use client";

import { useEffect, useRef, useState } from "react";

// Home's detailed panels (org notices, replies, late changes, schedule requests, expiring, inactive, quiet in chat, progress looks, payments) are what Needs you's "N more" opens
// (clutter audit DK5, Nov 21: Needs you is the one list on Home; these were a second, third and fourth copy of it, always open). They stay on the page, hidden, so a notice's link to
// one of them (/dashboard#late-changes, #schedule-requests, #expiring) still opens it.
export const NEEDS_STACK_EVENT = "needs-you-more";

/** Opening or closing Needs you's "N more" opens or closes the stack too. */
export function announceNeedsYouMore(open: boolean): void {
  try {
    window.dispatchEvent(new CustomEvent<boolean>(NEEDS_STACK_EVENT, { detail: open }));
  } catch {
    // no window (a test render): nothing to tell
  }
}

export function NeedsStackFold({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const fromHash = () => {
      const id = window.location.hash.slice(1);
      if (!id || !ref.current) return;
      const target = ref.current.querySelector(`[id="${CSS.escape(id)}"]`);
      if (!target) return;
      setOpen(true);
      requestAnimationFrame(() => target.scrollIntoView({ block: "start" }));
    };
    const onMore = (e: Event) => setOpen(!!(e as CustomEvent<boolean>).detail);
    fromHash();
    window.addEventListener("hashchange", fromHash);
    window.addEventListener(NEEDS_STACK_EVENT, onMore);
    return () => {
      window.removeEventListener("hashchange", fromHash);
      window.removeEventListener(NEEDS_STACK_EVENT, onMore);
    };
  }, []);

  return (
    <div ref={ref} id="needs-stack" hidden={!open} data-needs-stack={open ? "open" : "closed"}>
      {children}
    </div>
  );
}
