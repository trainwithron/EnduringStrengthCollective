"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { ClientFinder } from "@/components/coach/desktop/client-finder";
import { ExitDesktopModeButton } from "@/components/coach/exit-desktop-mode-button";
import { DownloadAppButton } from "@/components/coach/desktop/download-app-button";
import { SignOutButton } from "@/components/group/sign-out-button";

// The phone's version of the coach Home sidebar: everything the sidebar holds (find a client, Notifications, leave desktop mode, install the app, sign out) behind one menu button in the top bar, so nothing
// is unreachable on a narrow screen. The sidebar itself returns from the lg breakpoint.
export function CoachHomeMobileMenu() {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  // Escape closes the menu and puts focus back on its button.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="coach-home-menu"
        aria-label={open ? "Close menu" : "Open menu"}
        className="w-11 h-11 flex items-center justify-center text-chalk"
      >
        {open ? <X className="w-5 h-5" strokeWidth={2.25} /> : <Menu className="w-5 h-5" strokeWidth={2.25} />}
      </button>
      {open && (
        <div id="coach-home-menu" className="absolute right-0 top-12 z-40 w-72 max-w-[85vw] bg-surface border border-steel/30 shadow-lg p-3 space-y-3">
          <ClientFinder currentGroupId={null} align="right" />
          <Link href="/notifications" onClick={() => setOpen(false)} className="flex items-center min-h-11 font-body text-sm text-chalk">
            Notifications
          </Link>
          <ExitDesktopModeButton />
          <DownloadAppButton />
          <div className="[&_button]:min-h-11 [&_button]:text-sm">
            <SignOutButton />
          </div>
        </div>
      )}
    </div>
  );
}
