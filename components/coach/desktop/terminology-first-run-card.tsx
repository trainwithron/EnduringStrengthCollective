"use client";

import { useEffect, useState } from "react";
import { TerminologyChooser } from "@/components/coach/desktop/terminology-chooser";
import { useTerminology } from "@/components/coach/terminology-provider";
import { createBrowserClient } from "@/lib/supabase/client";

const DISMISSED_KEY = "terminology-first-run-dismissed";

// The one-time setup question on a coach's Home (Ron, Oct 6): "What do you call your people?". It is asked once, here, in plain buttons; the answer then reads
// as ordinary text everywhere, and can be changed any time in Settings. (The old nudge to rename words by clicking them is retired: no word is
// clickable any more.) Read/write of the dismissed flag happens after mount only, so a server-rendered first paint never flashes the card for a coach who
// already answered it.
//
// "Answered" is permanent, per coach, on the server (profiles.terminology_asked_at, migration 0336): picking ANY word (the default included) or pressing the X records it. The page tells this
// card what the server says (askedOnServer: true = never show it; null = the database does not have the column yet, so only this browser's memory is used). The browser's memory stays as
// a fast path so the card never flashes.
export async function markTerminologyAsked(): Promise<void> {
  try {
    const supabase = createBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from("profiles").update({ terminology_asked_at: new Date().toISOString() }).eq("id", user.id);
  } catch {
    // The browser's memory still holds it on this device; the next answer tries the server again.
  }
}

export function TerminologyFirstRunCard({ groupId, askedOnServer = null }: { groupId: string; askedOnServer?: boolean | null }) {
  const [dismissed, setDismissed] = useState(true);
  const [chosen, setChosen] = useState(false);
  const { overrides } = useTerminology();

  useEffect(() => {
    // Answered on the server (any browser, any device): never again. Remember it here too.
    if (askedOnServer === true) {
      setDismissed(true);
      try {
        window.localStorage.setItem(DISMISSED_KEY, "1");
      } catch {
        // Non-fatal.
      }
      return;
    }
    try {
      setDismissed(window.localStorage.getItem(DISMISSED_KEY) === "1");
    } catch {
      // Storage unavailable — default to dismissed rather than risk showing this every visit.
    }
  }, [askedOnServer]);

  function answered() {
    setChosen(true);
    try {
      window.localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // Non-fatal.
    }
    void markTerminologyAsked();
  }

  // Choosing a word counts as answering: the card says so, then goes away on its own next visit.
  const hasChoice = !!overrides.client;
  useEffect(() => {
    if (!dismissed && hasChoice && !chosen) answered();
    // answered() only reads state set above; it is not a trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dismissed, hasChoice]);

  function dismiss() {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // Non-fatal.
    }
    void markTerminologyAsked();
  }

  if (dismissed || askedOnServer === true) return null;

  return (
    <div className="mb-6 border border-rust/40 bg-surface/60 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <p className="font-body text-sm text-chalk font-medium">What do you call your people?</p>
          <p className="font-body text-xs text-steel mt-0.5 mb-3">Pick the word you use. It is used throughout your coach screens.</p>
          <TerminologyChooser groupId={groupId} moreHref={`/groups/${groupId}/branding?tab=terminology`} onChosen={answered} />
          {chosen && (
            <p className="font-body text-sm text-moss mt-3" role="status">
              Done. You can change this any time in Settings.
            </p>
          )}
        </div>
        <button type="button" onClick={dismiss} aria-label={chosen ? "Close" : "Keep the default and close"} className="font-body text-steel hover:text-chalk shrink-0 min-h-11 min-w-11">
          ✕
        </button>
      </div>
    </div>
  );
}
