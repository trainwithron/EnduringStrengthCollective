"use client";

import { useEffect, useRef, useState } from "react";
import { subscribeSaveToast } from "@/lib/save-toast";

// Real feedback from Ron: "I don't see a save button for my programs, I
// want it to autosave and I want a save button." Investigated first —
// every editable field in this builder already auto-persists on
// blur/change (day-card.tsx, week-grid.tsx, exercise-builder-card.tsx
// all call flashSaved()/flashSaveError()) and already has a status
// signal via lib/save-toast.ts. The real gap was discoverability: that
// signal only ever showed as <SaveToast/>, a small corner flash that
// disappears in 1.4s — easy to miss, and doubly so from inside the
// embedded copy in ShellListPanel's resizable side panel, where it still
// renders fixed to the whole browser window's corner, far from where a
// coach is actually looking. This is a persistent, always-visible
// companion sitting right next to the program name in both the full
// page and the embedded copy (same component, `program-builder-
// desktop.tsx` renders both) — not a replacement for the toast, an
// addition, since the toast's brief pulse is still a fine extra signal.
export function SaveStatusBar() {
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const revertTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return subscribeSaveToast((event) => {
      if (revertTimer.current) clearTimeout(revertTimer.current);
      if (event.kind === "error") {
        // Stays up until the next real save event, not on a timer — a
        // silently-lost edit shouldn't be able to quietly disappear.
        setStatus("error");
        setErrorMessage(event.message);
        return;
      }
      setStatus("saved");
      setErrorMessage(null);
      revertTimer.current = setTimeout(() => setStatus("idle"), 2500);
    });
  }, []);

  // Every field here already writes on its own blur/change — there's no
  // batched "pending" state a Save button could flush. What a real click
  // CAN honestly do: commit whatever the coach is still actively typing
  // into right now, instead of waiting for them to click elsewhere first
  // (the same blur that already triggers that field's own auto-persist).
  function handleSaveClick() {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={handleSaveClick}
        className="h-8 px-3 border border-steel/30 text-chalk font-body text-xs font-medium active:border-rust active:text-rust transition-colors"
      >
        Save
      </button>
      <span
        className={`font-body text-xs ${
          status === "error" ? "text-rust" : status === "saved" ? "text-positive" : "text-steel"
        }`}
        role={status === "error" ? "alert" : undefined}
      >
        {status === "error"
          ? (errorMessage ?? "Couldn't save that change.")
          : status === "saved"
            ? "Saved ✓"
            : "Autosaves as you go"}
      </span>
    </div>
  );
}
