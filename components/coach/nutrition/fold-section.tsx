"use client";

import { useEffect, useRef, type ReactNode } from "react";

// One folding section of a client's Nutrition page (Ron, Nov 19 revamp: This week / Targets / Meal plan / About). A link to it (#targets, "Suggestion waiting") opens it.
export function FoldSection({ id, title, note, flag, defaultOpen = false, children }: { id: string; title: string; note?: string; flag?: string | null; defaultOpen?: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const openIfAsked = () => {
      if (window.location.hash === `#${id}` && ref.current && !ref.current.open) {
        ref.current.open = true;
        ref.current.scrollIntoView({ block: "start" });
      }
    };
    openIfAsked();
    window.addEventListener("hashchange", openIfAsked);
    // Audit P33 (Nov 21): a tap on a link to this section opens it even when the address already ends in #id (no hashchange then: the second tap did nothing).
    const onClick = (e: MouseEvent) => {
      const link = e.target instanceof Element ? e.target.closest("a[href]") : null;
      const href = link?.getAttribute("href") ?? "";
      if (!href.endsWith(`#${id}`) || !ref.current) return;
      const path = href.slice(0, href.length - id.length - 1);
      if (path && path !== window.location.pathname) return; // a link to another page
      ref.current.open = true;
      ref.current.scrollIntoView({ block: "start" });
    };
    document.addEventListener("click", onClick);
    return () => {
      window.removeEventListener("hashchange", openIfAsked);
      document.removeEventListener("click", onClick);
    };
  }, [id]);
  return (
    <details ref={ref} id={id} open={defaultOpen} className="group border-t border-steel/20 scroll-mt-24" data-fold-section={id}>
      <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden flex items-center justify-between gap-3 min-h-14 py-2">
        <span className="min-w-0">
          <span className="block font-display font-bold text-xl uppercase leading-none">{title}</span>
          {note && <span className="block font-body text-xs text-steel mt-1 max-w-[70ch]">{note}</span>}
        </span>
        <span className="flex items-center gap-3 shrink-0">
          {flag && <span className="font-body text-xs text-chalk bg-rust px-2 py-0.5">{flag}</span>}
          <span aria-hidden="true" className="font-body text-sm text-steel group-open:rotate-90 transition-transform">
            ▸
          </span>
        </span>
      </summary>
      <div className="pb-8 pt-2 space-y-8">{children}</div>
    </details>
  );
}
