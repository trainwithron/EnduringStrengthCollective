"use client";

import { useEffect, useState } from "react";
import { clearSaveFailed, subscribeSaveFailed, SAVE_FAILED_SECONDS } from "@/lib/save-failed";

// The shared "That didn't save" bar (lib/save-failed.ts). Sits above the bottom tab bar on a phone.
export function SaveFailedToast() {
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => subscribeSaveFailed(setMessage), []);
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(clearSaveFailed, SAVE_FAILED_SECONDS * 1000);
    return () => clearTimeout(t);
  }, [message]);
  if (!message) return null;
  return (
    <div role="alert" className="fixed left-1/2 -translate-x-1/2 bottom-20 sm:bottom-6 z-[60] max-w-[calc(100vw-2rem)] flex items-center gap-3 border border-rust bg-graphite px-4 py-2.5 shadow-xl">
      <span className="font-body text-sm text-chalk">{message}</span>
      <button type="button" onClick={clearSaveFailed} className="min-h-11 px-3 font-body text-sm text-rust underline underline-offset-2">
        Dismiss
      </button>
    </div>
  );
}
