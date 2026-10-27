"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { InstagramHandleField } from "@/components/coach/instagram-handle-field";

// What goes on clients' share pictures from the coach (lib/share-image.ts): their Instagram handle (the same field and the same value as in Settings: coach_profiles, 0438) and a QR code to
// their public page (on by default; the switch lives on the public page row, coach_booking_pages.share_card_qr, 0437). The switch saves as soon as it is flipped, the handle with Save.
export function ShareCardSettings({ coachId, initialHandle, initialQr }: { coachId: string; initialHandle: string | null; initialQr: boolean }) {
  const [qr, setQr] = useState(initialQr);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function saveQr(next: boolean) {
    setBusy(true);
    setError(null);
    const { data, error: saveError } = await createBrowserClient().from("coach_booking_pages").update({ share_card_qr: next, updated_at: new Date().toISOString() }).eq("coach_id", coachId).select("coach_id");
    setBusy(false);
    if (saveError || !data || data.length === 0) {
      setQr(!next);
      setError("That didn't save. Try again.");
    }
  }

  return (
    <section className="border border-steel/20 p-4 mb-6 max-w-2xl space-y-4" aria-labelledby="share-card-settings" data-share-card-settings>
      <h2 id="share-card-settings" className="font-display uppercase text-sm tracking-wide text-steel">
        Share pictures
      </h2>
      <InstagramHandleField coachId={coachId} initialHandle={initialHandle} id="share-card-instagram-handle" />
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          role="switch"
          checked={qr}
          disabled={busy}
          onChange={(e) => {
            const next = e.target.checked;
            setQr(next);
            void saveQr(next);
          }}
          className="mt-1 accent-rust"
        />
        <span className="font-body text-sm text-chalk">Put a QR code to my public page on my clients&apos; share cards</span>
      </label>
      {error && (
        <p className="font-body text-xs text-rust" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
