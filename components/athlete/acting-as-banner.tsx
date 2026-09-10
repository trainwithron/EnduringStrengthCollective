"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { ViewAsClientPicker } from "./view-as-client-picker";

// Persistent, unmissable — the coach is standing in a client's real
// mobile experience (their name, their data, their write attribution),
// not just previewing it. "Change" reopens the picker without exiting
// first; the ✕ clears the cookie and returns to the coach's own hub.
export function ActingAsBanner({ athleteFullName, groupId }: { athleteFullName: string; groupId: string }) {
  const router = useRouter();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [exiting, setExiting] = useState(false);

  async function exit() {
    setExiting(true);
    await fetch("/api/coach/act-as", { method: "DELETE" });
    router.push(`/groups/${groupId}`);
    router.refresh();
  }

  return (
    <>
      <div className="relative z-30 bg-rust text-graphite px-5 py-2.5 flex items-center justify-between gap-3">
        <p className="font-body text-xs font-medium truncate">
          Viewing as {athleteFullName}
        </p>
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="font-body text-xs uppercase tracking-wide underline underline-offset-2"
          >
            Change
          </button>
          <button
            type="button"
            onClick={exit}
            disabled={exiting}
            aria-label="Stop viewing as client"
            className="disabled:opacity-50"
          >
            <X className="w-4 h-4" strokeWidth={2.5} />
          </button>
        </div>
      </div>

      {pickerOpen && (
        <ViewAsClientPicker onClose={() => setPickerOpen(false)} />
      )}
    </>
  );
}
