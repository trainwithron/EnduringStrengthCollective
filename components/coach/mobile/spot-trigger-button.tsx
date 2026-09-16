"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { SpotBusinessGlance } from "./spot-business-glance";

// the_spot_dropdown_widget_redesign_sept16.md — replaces the "View as
// Client" button as the coach's primary second access point. Ron's own
// words, locked: top-center placement, a dropdown (not an always-visible
// strip) with a see-through/translucent background, and available
// everywhere in the coaching app — "it doesn't matter if you're logging
// a workout or in your profile or whatever you're doing." Mounted once
// in CoachMobileShell so every coach mobile page gets it for free.
export function SpotTriggerButton({ groupId }: { groupId: string }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onPointerDown(e: PointerEvent) {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label="The Spot"
        className="fixed top-3 left-1/2 -translate-x-1/2 z-40 h-10 w-10 rounded-token-circle bg-graphite/90 border border-rust/50 flex items-center justify-center active:border-rust transition-colors shadow-lg"
      >
        <Sparkles className="w-5 h-5 text-rust" strokeWidth={2.25} />
      </button>

      {open && (
        <>
          {/* See-through/translucent background, per Ron's own words —
              the underlying page stays dimly visible, unlike a fully
              opaque modal overlay. */}
          <div className="fixed inset-0 z-30 bg-graphite/40 backdrop-blur-sm" aria-hidden="true" />
          <div
            ref={panelRef}
            id={panelId}
            role="dialog"
            aria-label="The Spot"
            className="fixed top-16 left-1/2 -translate-x-1/2 z-40 w-[92vw] max-w-md bg-graphite/95 backdrop-blur border border-steel/30 p-4 shadow-2xl"
          >
            <p className="font-body text-[10px] text-steel uppercase tracking-wide mb-2">
              The Spot — only you can see this
            </p>
            <SpotBusinessGlance groupId={groupId} onClose={() => setOpen(false)} />
          </div>
        </>
      )}
    </>
  );
}
