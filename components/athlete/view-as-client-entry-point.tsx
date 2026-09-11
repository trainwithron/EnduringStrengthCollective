"use client";

import { useState } from "react";
import Link from "next/link";
import { Eye, LayoutGrid } from "lucide-react";
import { ViewAsClientPicker } from "./view-as-client-picker";

// The coach-only jump into a real client's own mobile experience — pick a
// client, and every following page (Home, Workout, Settings) renders as
// if that client were signed in, with a persistent banner and one tap out.
// Kept as two separate, single-purpose buttons rather than one combined
// dropdown — "view a client" and "see my groups" are different intents,
// and this stays uncrowded without adding a settings toggle just to pick
// between them.
export function ViewAsClientEntryPoint() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center gap-1.5 h-9 px-3 border border-steel/30 text-chalk active:border-rust active:text-rust transition-colors"
        >
          <Eye className="w-4 h-4 shrink-0" strokeWidth={2.25} />
          <span className="font-body text-sm">View as Client</span>
        </button>
        <Link
          href="/dashboard"
          className="flex items-center gap-1.5 h-9 px-3 border border-steel/30 text-chalk active:border-rust active:text-rust transition-colors"
        >
          <LayoutGrid className="w-4 h-4 shrink-0" strokeWidth={2.25} />
          <span className="font-body text-sm">My Groups</span>
        </Link>
      </div>
      {open && <ViewAsClientPicker onClose={() => setOpen(false)} />}
    </>
  );
}
