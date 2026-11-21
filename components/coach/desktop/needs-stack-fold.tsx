"use client";

import { useEffect, useRef, useState } from "react";

// Home's detailed panels (org notices, replies, late changes, schedule requests, expiring, inactive, quiet in chat, progress looks, payments) are folded away (clutter audit DK5,
// Nov 21: Needs you is the one list on Home; these were a second, third and fourth copy of it, always open). They stay on the page, hidden, and open three ways: Needs you's
// "N more", a notice's link to one of them (/dashboard#late-changes, #schedule-requests, #expiring), and this fold's own "Show everything else", shown whenever any panel in it has
// something (so nothing is out of reach on a day Needs you has no "N more").
export const NEEDS_STACK_EVENT = "needs-you-more";
export const SHOW_STACK_LABEL = "Show everything else";
export const HIDE_STACK_LABEL = "Hide everything else";

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
  // Whether any panel drew anything (most draw nothing when they have nothing; several load after the page). Hidden content still counts.
  const [hasContent, setHasContent] = useState(false);

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
    const measure = () => setHasContent(!!ref.current && (ref.current.textContent ?? "").trim().length > 0);
    fromHash();
    measure();
    const observer = new MutationObserver(measure);
    if (ref.current) observer.observe(ref.current, { childList: true, subtree: true, characterData: true });
    window.addEventListener("hashchange", fromHash);
    window.addEventListener(NEEDS_STACK_EVENT, onMore);
    return () => {
      observer.disconnect();
      window.removeEventListener("hashchange", fromHash);
      window.removeEventListener(NEEDS_STACK_EVENT, onMore);
    };
  }, []);

  return (
    <>
      {hasContent && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="needs-stack"
          className="inline-flex items-center gap-1.5 min-h-11 mb-2 font-body text-sm font-semibold text-steel hover:text-chalk"
          data-needs-stack-toggle
        >
          <span aria-hidden="true">{open ? "▾" : "▸"}</span>
          {open ? HIDE_STACK_LABEL : SHOW_STACK_LABEL}
        </button>
      )}
      <div ref={ref} id="needs-stack" hidden={!open} data-needs-stack={open ? "open" : "closed"}>
        {children}
      </div>
    </>
  );
}
