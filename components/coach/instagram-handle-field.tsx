"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { cleanInstagramHandle, saveInstagramHandle } from "@/lib/instagram-handle";

// The coach's Instagram handle, typed once and used on their clients' share pictures. The same field in Settings (computer and phone) and under Booking page / Availability: one value
// (coach_profiles.instagram_handle), saved with Save; a pasted @name or instagram.com address is cleaned, and a bad one says what is allowed.
export function InstagramHandleField({ coachId, initialHandle, id = "instagram-handle" }: { coachId: string; initialHandle: string | null; id?: string }) {
  const [handle, setHandle] = useState(initialHandle ?? "");
  const [savedHandle, setSavedHandle] = useState(initialHandle ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  async function save() {
    const cleaned = cleanInstagramHandle(handle);
    if ("error" in cleaned) {
      setMessage({ text: cleaned.error, error: true });
      return;
    }
    const next = cleaned.handle ?? "";
    setHandle(next);
    setBusy(true);
    setMessage(null);
    const ok = await saveInstagramHandle(createBrowserClient(), coachId, cleaned.handle);
    setBusy(false);
    if (!ok) {
      setMessage({ text: "That didn't save. Try again.", error: true });
      return;
    }
    setSavedHandle(next);
    setMessage({ text: cleaned.handle ? `Saved. @${cleaned.handle} goes on your clients' share pictures.` : "Saved. No handle on the pictures.", error: false });
  }

  return (
    <div data-instagram-handle>
      <label htmlFor={id} className="font-body text-xs text-steel uppercase tracking-wide block mb-1">
        Instagram handle
      </label>
      <div className="flex items-center gap-2">
        <span className="font-body text-sm text-steel shrink-0" aria-hidden="true">
          @
        </span>
        <input
          id={id}
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          maxLength={120}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="yourname"
          className="flex-1 min-w-0 min-h-11 bg-surface border border-steel/30 text-chalk px-3 font-body text-base sm:text-sm focus:outline-none focus:border-rust"
        />
        <button type="button" onClick={() => void save()} disabled={busy || handle === savedHandle} className="min-h-11 px-4 border border-rust text-rust font-body text-sm disabled:opacity-50">
          Save
        </button>
      </div>
      <p className="font-body text-xs text-steel mt-1">Shown on your clients&apos; share pictures. Leave it empty for none.</p>
      {message && (
        <p className={`font-body text-xs mt-1 ${message.error ? "text-rust" : "text-steel"}`} role={message.error ? "alert" : "status"}>
          {message.text}
        </p>
      )}
    </div>
  );
}
