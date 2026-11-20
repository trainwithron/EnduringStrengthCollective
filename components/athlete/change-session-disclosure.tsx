"use client";

import { useState } from "react";

// One "Change" button on a session card (Look Refresh, client Calendar, Ron Nov 20): it opens the actions that were always there (cancel, pick a different
// time, or message the coach when the coach does the scheduling). Nothing new happens here; it only folds them away until asked for.
export function ChangeSessionDisclosure({ children, tone = "checkin" }: { children: React.ReactNode; tone?: "checkin" | "plain" }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`min-h-11 px-4 rounded-token-pill border font-body text-sm text-chalk transition-colors ${tone === "checkin" ? "border-checkin/40 active:border-checkin" : "border-steel/40 active:border-rust"}`}
      >
        {open ? "Close" : "Change"}
      </button>
      {open && <div data-change-actions>{children}</div>}
    </div>
  );
}
