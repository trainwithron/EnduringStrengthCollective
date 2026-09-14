"use client";

import { useState } from "react";
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

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="text-left w-full">
        {trigger}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end">
          <div
            className="absolute inset-0 bg-graphite/80"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div className="relative w-full bg-graphite border-t border-steel/20 max-h-[70vh] overflow-y-auto">
            <div className="flex items-center justify-between px-5 h-12 border-b border-steel/20">
              <p className="font-display uppercase text-sm tracking-wide text-chalk">{title}</p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="w-8 h-8 flex items-center justify-center text-steel"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-5 py-4">{children(() => setOpen(false))}</div>
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
