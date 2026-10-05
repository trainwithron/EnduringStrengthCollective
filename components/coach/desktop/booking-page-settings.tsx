"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { appOriginBrowser } from "@/lib/app-url";
import { normalizeSlug, slugProblem } from "@/lib/public-booking";

export interface BookingPageRow {
  slug: string;
  enabled: boolean;
  headline: string;
  intro: string;
  showPrices: boolean;
}

const input = "w-full bg-surface border border-steel/30 text-chalk px-3 py-2 font-body text-sm focus:outline-none focus:border-rust";

// The coach's public booking page: its address, on/off, a headline and intro, and whether prices show. Off until the coach turns
// it on. Saved with the coach's own login; the address is unique across all coaches.
export function BookingPageSettings({
  coachId,
  initial,
  suggestedSlug,
}: {
  coachId: string;
  initial: BookingPageRow | null;
  suggestedSlug: string;
}) {
  const [slug, setSlug] = useState(initial?.slug ?? suggestedSlug);
  const [enabled, setEnabled] = useState(initial?.enabled ?? false);
  const [headline, setHeadline] = useState(initial?.headline ?? "");
  const [intro, setIntro] = useState(initial?.intro ?? "");
  const [showPrices, setShowPrices] = useState(initial?.showPrices ?? false);
  const [saved, setSaved] = useState<BookingPageRow | null>(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [copied, setCopied] = useState(false);

  const problem = slug ? slugProblem(slug) : "Choose an address.";
  const link = saved ? `${appOriginBrowser()}/book/${saved.slug}` : null;
  const dirty =
    !saved || saved.slug !== slug || saved.enabled !== enabled || saved.headline !== headline || saved.intro !== intro || saved.showPrices !== showPrices;

  async function save() {
    if (problem || busy) return;
    setBusy(true);
    setMessage(null);
    const supabase = createBrowserClient();
    const { error } = await supabase.from("coach_booking_pages").upsert(
      {
        coach_id: coachId,
        slug,
        enabled,
        headline: headline.trim() || null,
        intro: intro.trim() || null,
        show_prices: showPrices,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "coach_id" }
    );
    setBusy(false);
    if (error) {
      const taken = error.code === "23505" || /duplicate|unique/i.test(error.message);
      setMessage({ text: taken ? "That address is taken. Try another." : "That didn't save. Try again.", error: true });
      return;
    }
    setSaved({ slug, enabled, headline: headline.trim(), intro: intro.trim(), showPrices });
    setMessage({ text: enabled ? "Saved. Your page is live." : "Saved. Your page is off.", error: false });
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // The link is shown on the page to copy by hand.
    }
  }

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <label className="font-body text-xs text-steel uppercase tracking-wide block mb-1" htmlFor="booking-slug">
          Your address
        </label>
        <div className="flex items-center gap-2">
          <span className="font-body text-sm text-steel shrink-0">/book/</span>
          <input
            id="booking-slug"
            className={input}
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase())}
            onBlur={() => setSlug((s) => normalizeSlug(s))}
            maxLength={40}
            autoComplete="off"
          />
        </div>
        {problem && slug && (
          <p className="font-body text-xs text-rust mt-1" role="alert">
            {problem}
          </p>
        )}
        {link && (
          <p className="font-body text-xs text-steel mt-2 break-all">
            Share this link: <span className="text-chalk select-all">{link}</span>{" "}
            <button type="button" onClick={copy} className="underline text-chalk ml-1">
              {copied ? "Copied" : "Copy"}
            </button>
          </p>
        )}
      </div>

      <label className="flex items-start gap-3 cursor-pointer">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="mt-1 accent-rust" />
        <span>
          <span className="font-body text-sm text-chalk block">Take bookings on this page</span>
          <span className="font-body text-xs text-steel block mt-0.5">
            Off until you turn it on. Visitors only see the session types you mark as public below, and only times you are free.
          </span>
        </span>
      </label>

      <div>
        <label className="font-body text-xs text-steel uppercase tracking-wide block mb-1" htmlFor="booking-headline">
          Headline (optional)
        </label>
        <input id="booking-headline" className={input} value={headline} onChange={(e) => setHeadline(e.target.value)} maxLength={80} placeholder="Train with me" />
      </div>

      <div>
        <label className="font-body text-xs text-steel uppercase tracking-wide block mb-1" htmlFor="booking-intro">
          Introduction (optional)
        </label>
        <textarea
          id="booking-intro"
          className={input}
          rows={3}
          value={intro}
          onChange={(e) => setIntro(e.target.value)}
          maxLength={600}
          placeholder="A line or two about you and how a session works."
        />
      </div>

      <label className="flex items-start gap-3 cursor-pointer">
        <input type="checkbox" checked={showPrices} onChange={(e) => setShowPrices(e.target.checked)} className="mt-1 accent-rust" />
        <span>
          <span className="font-body text-sm text-chalk block">Show prices</span>
          <span className="font-body text-xs text-steel block mt-0.5">
            Off by default. Prices are for display only; nothing is charged on this page. A session type shows a price only when you set one.
          </span>
        </span>
      </label>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={busy || !!problem || !dirty}
          className="bg-rust text-graphite font-display font-bold uppercase tracking-wide px-4 py-2 disabled:opacity-40"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        {message && (
          <p className={`font-body text-sm ${message.error ? "text-rust" : "text-chalk"}`} role={message.error ? "alert" : "status"}>
            {message.text}
          </p>
        )}
      </div>
    </div>
  );
}
