"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { appOriginBrowser } from "@/lib/app-url";

// The one block in Calendar > Availability for the coach's public page: anyone can book a consultation on the coach's calendar (on by default), the link to share, and whether people may ask to train with the coach.
// No address to pick and nothing to set up: the page was made for the coach automatically. The existing Booking page screen is the advanced one.
export function ConsultationLinkBlock({ coachId, slug, enabled: initialEnabled, acceptsRequests: initialAccepts, hasOpenHours }: { coachId: string; slug: string; enabled: boolean; acceptsRequests: boolean; hasOpenHours: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [accepts, setAccepts] = useState(initialAccepts);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const link = `${appOriginBrowser()}/c/${slug}`;

  async function save(patch: { enabled?: boolean; accepts_requests?: boolean }, undo: () => void) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const { data, error: saveError } = await createBrowserClient().from("coach_booking_pages").update({ ...patch, updated_at: new Date().toISOString() }).eq("coach_id", coachId).select("coach_id");
    setBusy(false);
    if (saveError || !data || data.length === 0) {
      undo();
      setError("That didn't save. Try again.");
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Couldn't copy. Select the link and copy it by hand.");
    }
  }

  return (
    <section className="border border-steel/20 p-4 mb-6 max-w-2xl space-y-4" aria-label="Your public link" data-consultation-block>
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          role="switch"
          checked={enabled}
          disabled={busy}
          onChange={(e) => {
            const next = e.target.checked;
            setEnabled(next);
            void save({ enabled: next }, () => setEnabled(!next));
          }}
          className="mt-1 accent-rust"
        />
        <span>
          <span className="font-body text-sm text-chalk block">Anyone can book a consultation with me</span>
          <span className="font-body text-xs text-steel block mt-0.5">
            {enabled ? "On. They pick one of your open times; it lands on your calendar like any session." : "Off. Your link shows a plain \"not available\" page."}
          </span>
        </span>
      </label>

      <div>
        <p className="font-body text-xs text-steel uppercase tracking-wide mb-1">Your link</p>
        <p className="font-body text-sm break-all">
          <span className="text-chalk select-all">{link}</span>{" "}
          <button type="button" onClick={copy} className="underline text-chalk ml-1 min-h-11">
            {copied ? "Copied" : "Copy"}
          </button>
        </p>
        {enabled && !hasOpenHours && <p className="font-body text-xs text-steel mt-1">Add your open hours below so people have times to pick.</p>}
      </div>

      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          role="switch"
          checked={accepts}
          disabled={busy || !enabled}
          onChange={(e) => {
            const next = e.target.checked;
            setAccepts(next);
            void save({ accepts_requests: next }, () => setAccepts(!next));
          }}
          className="mt-1 accent-rust"
        />
        <span>
          <span className="font-body text-sm text-chalk block">Let people ask to train with me</span>
          <span className="font-body text-xs text-steel block mt-0.5">A button on your page. You decide each request; nothing starts until you approve it.</span>
        </span>
      </label>
      {error && (
        <p className="font-body text-xs text-rust" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
