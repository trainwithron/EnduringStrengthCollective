"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";

// The complications tap-to-expand mechanism (complications_on_workflow_
// screens_idea.md, locked 2026-09-14): a coach taps a preset tile and
// gets "a condensed, functional mini-version of the real page" — real
// inline actions wherever the underlying action is simple enough, not
// just a read-only glance. "Go deeper" is the escape hatch for anything
// bigger. This is the one shared, reusable version of that pattern —
// used verbatim everywhere a complication appears, per Ron's own
// scope-closing "that would be it."
//
// `children` is a render-prop so inline actions can call `close()` after
// acting (e.g. "Log now" both starts the log flow and dismisses the
// bubble) instead of leaving it open once its job is done.
//
// keyboard_screenreader_accessibility_audit_sept15.md — this was the
// highest-leverage single fix in that audit: every complication tile
// app-wide (the Spot rail, CoachHomeComplications, the hover-rail
// widgets) reuses this exact component, so real dialog semantics here
// propagate everywhere at once. A plain `fixed inset-0` div with no
// role/focus handling reads as invisible to a screen reader and traps
// nobody's keyboard focus — this makes it a real modal: labelled,
// focus-trapped, Escape-closable, and focus-restoring.
export function QuickViewBubble({
  trigger,
  title,
  deeperHref,
  deeperLabel,
  children,
}: {
  trigger: React.ReactNode;
  title: string;
  deeperHref?: string;
  deeperLabel?: string;
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  function close() {
    setOpen(false);
  }

  // Focus the close button the moment the modal renders (a stable,
  // always-present default target — the alternative, "first focusable
  // element," would jump around depending on what a given complication's
  // children happen to render), then hand focus back to the trigger the
  // moment it closes — regardless of which of the several close paths
  // (X button, backdrop click, Escape, a child's own `close()` call)
  // actually fired.
  useEffect(() => {
    if (open) {
      closeButtonRef.current?.focus();
    } else {
      triggerRef.current?.focus();
    }
  }, [open]);

  // Escape closes; Tab/Shift+Tab cycle strictly within the modal's own
  // focusable elements so keyboard focus can never reach the obscured
  // page behind it.
  useEffect(() => {
    if (!open) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }
      if (e.key !== "Tab" || !modalRef.current) return;

      const focusable = modalRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  return (
    <>
      <button type="button" ref={triggerRef} onClick={() => setOpen(true)} className="text-left w-full">
        {trigger}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end">
          <div className="absolute inset-0 bg-graphite/80" onClick={close} aria-hidden="true" />
          <div
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="relative w-full bg-graphite border-t border-steel/20 max-h-[70vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between px-5 h-12 border-b border-steel/20">
              <p id={titleId} className="font-display uppercase text-sm tracking-wide text-chalk">
                {title}
              </p>
              <button
                type="button"
                ref={closeButtonRef}
                onClick={close}
                aria-label="Close"
                className="w-8 h-8 flex items-center justify-center text-steel"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-5 py-4">{children(close)}</div>
            {deeperHref && (
              <div className="px-5 pb-5">
                <Link
                  href={deeperHref}
                  className="font-body text-xs text-rust underline underline-offset-2"
                >
                  {deeperLabel ?? "Open"}
                </Link>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
