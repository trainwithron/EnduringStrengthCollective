"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MouseEvent, ReactNode } from "react";

/**
 * Whether a tap on Back can go one step back inside the app. Where the browser says (the Navigation API lists only this site's own steps), that answer; otherwise there is a
 * step and the page was reached from this site.
 */
export function canGoBackInApp(historyLength: number, referrer: string, origin: string, navigationCanGoBack?: boolean): boolean {
  if (typeof navigationCanGoBack === "boolean") return navigationCanGoBack;
  if (historyLength < 2 || !referrer) return false;
  try {
    return new URL(referrer).origin === origin;
  } catch {
    return false;
  }
}

// "← Back" that returns where the coach came from (clutter pass, Nov 21: the client profile's Back always went to the Clients page, even from Spotlight or the calendar).
// Opened straight from a link, a notice or a new tab, it goes to `fallbackHref` instead.
export function BackLink({ fallbackHref, className, children }: { fallbackHref: string; className?: string; children: ReactNode }) {
  const router = useRouter();
  function onClick(e: MouseEvent<HTMLAnchorElement>) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    try {
      const nav = (window as unknown as { navigation?: { canGoBack?: unknown } }).navigation;
      const navCanGoBack = typeof nav?.canGoBack === "boolean" ? nav.canGoBack : undefined;
      if (!canGoBackInApp(window.history.length, document.referrer, window.location.origin, navCanGoBack)) return;
    } catch {
      return;
    }
    e.preventDefault();
    router.back();
  }
  return (
    <Link href={fallbackHref} onClick={onClick} className={className} data-back-link>
      {children}
    </Link>
  );
}
