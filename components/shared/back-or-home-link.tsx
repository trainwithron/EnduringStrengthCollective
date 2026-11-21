"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

// "← Back" that goes back to the page the person came from (audit C14, Nov 21: a client's message thread always went to Settings), and to `fallbackHref` (Home) when there is
// no page of this app to go back to (opened from a notification or a link).
export function cameFromThisApp(referrer: string, origin: string, historyLength: number): boolean {
  if (historyLength <= 1 || !referrer) return false;
  try {
    return new URL(referrer).origin === origin;
  } catch {
    return false;
  }
}

export function BackOrHomeLink({ fallbackHref, className, children }: { fallbackHref: string; className: string; children: React.ReactNode }) {
  const router = useRouter();
  return (
    <Link
      href={fallbackHref}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        if (!cameFromThisApp(document.referrer, window.location.origin, window.history.length)) return;
        e.preventDefault();
        router.back();
      }}
      className={className}
      data-back-or-home
    >
      {children}
    </Link>
  );
}
