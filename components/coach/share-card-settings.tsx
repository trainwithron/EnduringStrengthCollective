"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { cleanInstagramHandle } from "@/lib/instagram-handle";

// What goes on clients' share pictures from the coach (lib/share-image.ts): their Instagram handle, and a QR code to their public page (on by default). Both live on the coach's public page
// row (coach_booking_pages, migration 0437), saved with the coach's own login: the switch as soon as it is flipped, the handle with Save.
export function ShareCardSettings({ coachId, initialHandle, initialQr }: { coachId: string; initialHandle: string | null; initialQr: boolean }) {
  const [handle, setHandle] = useState(initialHandle ?? "");
  const [savedHandle, setSavedHandle] = useState(initialHandle ?? "");
  const [qr, setQr] = useState(initialQr);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  async function save(patch: { instagram_handle?: string | null; share_card_qr?: boolean }): Promise<boolean> {
    setBusy(true);
    setMessage(null);
    const { data, error } = await createBrowserClient().from("coach_booking_pages").update({ ...patch, updated_at: new Date().toISOString() }).eq("coach_id", coachId).select("coach_id");
    setBusy(false);
    if (error || !data || data.length === 0) {
      setMessage({ text: "That didn't save. Try again.", error: true });
      return false;
    }
    return true;
  }

  async function saveHandle() {
    const cleaned = cleanInstagramHandle(handle);
    if ("error" in cleaned) {
      setMessage({ text: cleaned.error, error: true });
      return;
    }
    const next = cleaned.handle ?? "";
    setHandle(next);
    if (await save({ instagram_handle: cleaned.handle })) {
      setSavedHandle(next);
      setMessage({ text: cleaned.handle ? `Saved. @${cleaned.handle} goes on your clients' share pictures.` : "Saved. No handle on the pictures.", error: false });
    }
  }

  return (
    <section className="border border-steel/20 p-4 mb-6 max-w-2xl space-y-4" aria-labelledby="share-card-settings" data-share-card-settings>
      <h2 id="share-card-settings" className="font-display uppercase text-sm tracking-wide text-steel">
        Share pictures
      </h2>
      <div>
        <label htmlFor="instagram-handle" className="font-body text-xs text-steel uppercase tracking-wide block mb-1">
          Instagram handle
        </label>
        <div className="flex items-center gap-2">
          <span className="font-body text-sm text-steel shrink-0" aria-hidden="true">
            @
          </span>
          <input
            id="instagram-handle"
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            maxLength={120}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="yourname"
            className="flex-1 min-w-0 min-h-11 bg-surface border border-steel/30 text-chalk px-3 font-body text-base sm:text-sm focus:outline-none focus:border-rust"
          />
          <button type="button" onClick={() => void saveHandle()} disabled={busy || handle === savedHandle} className="min-h-11 px-4 border border-rust text-rust font-body text-sm disabled:opacity-50">
            Save
          </button>
        </div>
        <p className="font-body text-xs text-steel mt-1">Shown under your QR code on your clients&apos; share pictures. Leave it empty for none.</p>
      </div>
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          role="switch"
          checked={qr}
          disabled={busy}
          onChange={(e) => {
            const next = e.target.checked;
            setQr(next);
            void save({ share_card_qr: next }).then((ok) => {
              if (!ok) setQr(!next);
            });
          }}
          className="mt-1 accent-rust"
        />
        <span className="font-body text-sm text-chalk">Put a QR code to my public page on my clients&apos; share cards</span>
      </label>
      {message && (
        <p className={`font-body text-xs ${message.error ? "text-rust" : "text-steel"}`} role={message.error ? "alert" : "status"}>
          {message.text}
        </p>
      )}
    </section>
  );
}

