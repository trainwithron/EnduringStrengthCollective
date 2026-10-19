"use client";

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

// A tap always shows that something is happening (Ron, Oct 19: "you'll tap something and you'll just assume it's unresponsive because nothing happens"). A click on a link to another page of
// the app shows a thin bar at the top until the new page is there (the address changes) or 15 seconds pass. It keeps clear of the split screen's left half (--split-reserved).
// Not shown for a click with a modifier key, a new tab, a download, a jump within the page, or the page already open.
export function NavProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [active, setActive] = useState(false);

  useEffect(() => {
    setActive(false);
  }, [pathname, searchParams]);

  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => setActive(false), 15000);
    return () => clearTimeout(t);
  }, [active]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a");
      if (!a || !(a instanceof HTMLAnchorElement)) return;
      if (a.target && a.target !== "_self") return;
      if (a.hasAttribute("download")) return;
      const href = a.getAttribute("href");
      if (!href || href.startsWith("#")) return;
      let url: URL;
      try {
        url = new URL(a.href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      setActive(true);
    }
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  if (!active) return null;
  return (
    <div
      aria-hidden="true"
      data-nav-progress
      className="fixed top-0 right-0 z-[60] h-[3px] overflow-hidden"
      style={{ left: "var(--split-reserved, 0px)" }}
    >
      <div className="h-full w-full animate-pulse" style={{ background: "rgb(var(--rust))" }} />
    </div>
  );
}
