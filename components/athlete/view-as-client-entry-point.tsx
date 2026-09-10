"use client";

import { useState } from "react";
import { Eye } from "lucide-react";
import { ViewAsClientPicker } from "./view-as-client-picker";

// The coach-only jump into a real client's own mobile experience — pick a
// client, and every following page (Home, Workout, Settings) renders as
// if that client were signed in, with a persistent banner and one tap out.
export function ViewAsClientEntryPoint() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 h-9 px-3 border border-steel/30 text-chalk active:border-rust active:text-rust transition-colors"
      >
        <Eye className="w-4 h-4 shrink-0" strokeWidth={2.25} />
        <span className="font-body text-sm">View as Client</span>
      </button>
      {open && <ViewAsClientPicker onClose={() => setOpen(false)} />}
    </>
  );
}
