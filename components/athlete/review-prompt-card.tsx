"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

// The one small, ignorable review card. Whatever the client does with it, it is recorded as shown and never comes back. The review goes to the coach only; it can be shared publicly ONLY if the client
// ticked the box, and even then only when the coach chooses to put it on their page.
export function ReviewPromptCard({ groupId, athleteId, coachId, coachName, firstName }: { groupId: string; athleteId: string; coachId: string; coachName: string; firstName: string }) {
  const [open, setOpen] = useState(true);
  const [quote, setQuote] = useState("");
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [thanks, setThanks] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function record(outcome: "quote" | "not_now") {
    await createBrowserClient().from("review_prompts_shown").upsert({ athlete_id: athleteId, group_id: groupId, outcome }, { onConflict: "athlete_id,group_id" });
  }

  async function send() {
    const body = quote.trim();
    if (!body || busy) return;
    setBusy(true);
    setError(null);
    const { error: insertError } = await createBrowserClient().from("client_quotes").insert({ athlete_id: athleteId, group_id: groupId, coach_id: coachId, body: body.slice(0, 240), first_name: firstName.slice(0, 30) || null, share_publicly: agree });
    if (insertError) {
      setBusy(false);
      setError("That didn't send. Try again, or skip it.");
      return;
    }
    await record("quote");
    setBusy(false);
    setThanks(true);
  }

  if (!open) return null;
  if (thanks) {
    return (
      <section className="border border-steel/20 p-4" role="status">
        <p className="font-body text-sm text-chalk">Thank you. {coachName} will see it.</p>
      </section>
    );
  }

  return (
    <section className="border border-steel/20 p-4" aria-label="A small favour">
      <p className="font-body text-sm text-chalk">Enjoying training with {coachName}? Leave a review.</p>
      <div className="mt-3 space-y-2">
        <textarea value={quote} maxLength={240} rows={3} onChange={(e) => setQuote(e.target.value)} aria-label="Your review" placeholder="One or two sentences" className="w-full bg-graphite border border-steel/30 text-chalk px-2 py-2 font-body text-base sm:text-sm" />
        <label className="flex min-h-11 items-start gap-2 font-body text-sm text-chalk cursor-pointer">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-[#D2703B]" />
          <span>I agree {coachName} may share this publicly, for example on their website.</span>
        </label>
        {error && (
          <p className="font-body text-xs text-rust" role="alert">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy || !quote.trim()} onClick={send} className="min-h-11 bg-rust text-graphite font-display font-bold uppercase tracking-wide px-4 disabled:opacity-40">
            {busy ? "Sending…" : "Send"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              void record("not_now");
              setOpen(false);
            }}
            className="min-h-11 px-3 font-body text-sm text-steel"
          >
            Not now
          </button>
        </div>
      </div>
    </section>
  );
}
