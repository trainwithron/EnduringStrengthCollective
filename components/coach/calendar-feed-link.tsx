"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { confirmDialog } from "@/components/shared/confirm-dialog";

// Apple Calendar, Outlook or any calendar app (Ron, Nov 20, wave 3 C8): a private link the coach's calendar subscribes to, read only, with their sessions and calls (first names
// only). "Make a new link" ends the old one at once (for a link that was shared by mistake); "Turn off" removes it. Next to Google Calendar in Settings.
export function CalendarFeedLink() {
  const [token, setToken] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      // before the database step the table is not there: the box offers to make a link, which then says it isn't available yet
      const { data } = await supabase.from("coach_calendar_feeds").select("token").eq("coach_id", user.id).maybeSingle();
      if (!cancelled) {
        setToken((data as { token?: string } | null)?.token ?? null);
        setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const url = token && typeof window !== "undefined" ? `${window.location.origin}/api/calendar-feed/${token}.ics` : null;
  const webcal = url ? url.replace(/^https?:\/\//, "webcal://") : null;

  async function makeLink(replacing: boolean) {
    if (replacing && !(await confirmDialog({ message: "Make a new link? The old one stops working, so any calendar using it stops updating until you add the new one.", confirmLabel: "Make a new link" }))) return;
    setBusy(true);
    setError(null);
    setCopied(false);
    const { data, error: rpcError } = await createBrowserClient().rpc("new_calendar_feed_link");
    setBusy(false);
    if (rpcError || typeof data !== "string") {
      setError("That didn't work. Nothing was changed. Try again.");
      return;
    }
    setToken(data);
  }

  async function turnOff() {
    if (!(await confirmDialog({ message: "Turn off the calendar link? Any calendar using it stops updating.", confirmLabel: "Turn off" }))) return;
    setBusy(true);
    setError(null);
    const { error: rpcError } = await createBrowserClient().rpc("turn_off_calendar_feed");
    setBusy(false);
    if (rpcError) {
      setError("That didn't work. Nothing was changed. Try again.");
      return;
    }
    setToken(null);
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setError("Couldn't copy. Press and hold the link to copy it.");
    }
  }

  return (
    <div className="mt-3 bg-surface rounded-card p-3" data-calendar-feed>
      <p className="font-body text-sm text-chalk">Apple Calendar, Outlook or any calendar</p>
      <p className="font-body text-xs text-steel mt-0.5">
        A private link your calendar app subscribes to. It shows your sessions and calls with first names only, nothing else, and updates on its own. Anyone with the link can see
        those times, so keep it to yourself.
      </p>
      {!loaded ? null : url ? (
        <div className="mt-2 flex flex-col gap-2">
          <input readOnly value={url} aria-label="Your calendar link" onFocus={(e) => e.currentTarget.select()} className="w-full h-11 rounded-row bg-surface-2 border border-steel/30 px-3 font-body text-xs text-chalk" />
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => void copy()} className="min-h-11 px-4 rounded-token-pill bg-rust text-graphite font-body text-sm font-semibold">
              {copied ? "Copied" : "Copy link"}
            </button>
            {webcal && (
              <a href={webcal} className="min-h-11 px-4 inline-flex items-center rounded-token-pill border border-steel/40 text-chalk font-body text-sm">
                Add to Apple Calendar
              </a>
            )}
            <button type="button" onClick={() => void makeLink(true)} disabled={busy} className="min-h-11 px-3 font-body text-sm text-steel underline underline-offset-2 disabled:opacity-40">
              Make a new link
            </button>
            <button type="button" onClick={() => void turnOff()} disabled={busy} className="min-h-11 px-3 font-body text-sm text-steel underline underline-offset-2 disabled:opacity-40">
              Turn off
            </button>
          </div>
          <p className="font-body text-xs text-steel">In Outlook: Add calendar, then Subscribe from web, and paste the link.</p>
        </div>
      ) : (
        <button type="button" onClick={() => void makeLink(false)} disabled={busy} className="mt-2 min-h-11 px-4 rounded-token-pill border border-steel/40 text-chalk font-body text-sm disabled:opacity-40">
          {busy ? "Making your link…" : "Get my calendar link"}
        </button>
      )}
      {error && (
        <p className="font-body text-xs text-rust-ink mt-2" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
