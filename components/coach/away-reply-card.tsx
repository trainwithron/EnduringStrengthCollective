"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { awayReplyState, DEFAULT_AWAY_REPLY, MAX_AWAY_REPLY, readableDay } from "@/lib/away-reply";

export interface AwayReplySetting {
  enabled: boolean;
  message: string;
  endsOn: string | null;
}

// The coach's "I'm away" preset reply (migration 0315). They write the reply once and turn it on, with a last day if they know it. While it is on, each message a client sends them
// gets this reply back in the thread; the coach still gets the usual notice for the client's message. A plain ON bar with one tap to turn it off, so it is never left on by accident.
export function AwayReplyCard({ coachId, initial, today }: { coachId: string; initial: AwayReplySetting | null; today: string }) {
  const [setting, setSetting] = useState<AwayReplySetting | null>(initial);
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState(initial?.message?.trim() ? initial.message : DEFAULT_AWAY_REPLY);
  // An away reply that has ended starts the form with no last day (the old one is in the past and would be refused).
  const [endsOn, setEndsOn] = useState(awayReplyState(initial, today) === "ended" ? "" : initial?.endsOn ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const state = awayReplyState(setting, today);

  async function save(next: AwayReplySetting): Promise<boolean> {
    setSaving(true);
    setError(null);
    const supabase = createBrowserClient();
    const { error: saveError } = await supabase
      .from("coach_away_replies")
      .upsert({ coach_id: coachId, enabled: next.enabled, message: next.message, ends_on: next.endsOn, updated_at: new Date().toISOString() }, { onConflict: "coach_id" });
    setSaving(false);
    if (saveError) {
      setError("That didn't save. Check your connection and try again.");
      return false;
    }
    setSetting(next);
    return true;
  }

  async function turnOn() {
    const text = message.trim();
    if (!text) {
      setError("Write the reply first.");
      return;
    }
    if (endsOn && endsOn < today) {
      setError("The last day has already passed. Pick today or a later day, or leave it empty.");
      return;
    }
    if (await save({ enabled: true, message: text, endsOn: endsOn || null })) setEditing(false);
  }

  async function turnOff() {
    await save({ enabled: false, message: setting?.message ?? message.trim(), endsOn: setting?.endsOn ?? null });
  }

  const form = (
    <div className="space-y-2 mt-3">
      <label className="block font-body text-xs text-steel" htmlFor="away-reply-text">
        Your reply (sent back to each client who messages you)
      </label>
      <textarea
        id="away-reply-text"
        value={message}
        onChange={(e) => setMessage(e.target.value.slice(0, MAX_AWAY_REPLY))}
        rows={4}
        className="w-full bg-graphite border border-steel/40 p-2 font-body text-sm text-chalk"
      />
      <label className="flex items-center gap-2 font-body text-xs text-steel" htmlFor="away-reply-end">
        Last day away (optional)
        <input
          id="away-reply-end"
          type="date"
          value={endsOn}
          min={today}
          onChange={(e) => setEndsOn(e.target.value)}
          className="min-h-[44px] sm:min-h-0 sm:h-8 bg-graphite border border-steel/40 px-2 font-body text-xs text-chalk"
        />
      </label>
      <p className="font-body text-xs text-steel">
        Each client message gets this reply. Nothing reads what the client wrote, and you still get the normal notice for their message. Turn it off any time.
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={saving} onClick={() => void turnOn()} className="min-h-[44px] sm:min-h-0 sm:h-9 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40">
          {state === "on" ? "Save changes" : "Turn on"}
        </button>
        <button type="button" disabled={saving} onClick={() => setEditing(false)} className="min-h-[44px] sm:min-h-0 sm:h-9 px-4 border border-steel/40 text-steel font-body text-sm">
          Cancel
        </button>
      </div>
    </div>
  );

  return (
    <section
      aria-label="Away reply"
      className={`mb-4 border px-4 py-3 ${state === "on" ? "border-rust bg-rust/10" : "border-steel/20"}`}
    >
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div className="min-w-0">
          <p className="font-body text-sm text-chalk">
            {state === "on" ? (
              <>
                <span className="font-bold text-rust">Away reply is ON</span>
                {setting?.endsOn ? ` until ${readableDay(setting.endsOn)}` : ""}. Clients who message you get your reply.
              </>
            ) : state === "ended" ? (
              <>Away reply ended on {setting?.endsOn ? readableDay(setting.endsOn) : "its last day"}. It is off.</>
            ) : (
              <>Away reply is off.</>
            )}
          </p>
          {state === "on" && setting && <p className="font-body text-xs text-steel mt-1 whitespace-pre-wrap break-words">{setting.message}</p>}
        </div>
        <div className="flex gap-2 shrink-0">
          {state === "on" ? (
            <>
              <button type="button" disabled={saving} onClick={() => void turnOff()} className="min-h-[44px] sm:min-h-0 sm:h-9 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40">
                Turn off
              </button>
              {!editing && (
                <button type="button" onClick={() => setEditing(true)} className="min-h-[44px] sm:min-h-0 sm:h-9 px-3 border border-steel/40 text-steel font-body text-sm">
                  Edit
                </button>
              )}
            </>
          ) : (
            !editing && (
              <button type="button" onClick={() => setEditing(true)} className="min-h-[44px] sm:min-h-0 sm:h-9 px-4 border border-rust/40 text-rust font-body text-sm">
                {state === "ended" ? "Turn on again" : "I'm away"}
              </button>
            )
          )}
        </div>
      </div>
      {editing && form}
      {error && (
        <p className="font-body text-xs text-rust mt-2" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
