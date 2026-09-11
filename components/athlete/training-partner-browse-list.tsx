"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { notifyPush } from "@/lib/push-notify";
import { ReportUserButton } from "./report-user-button";

export interface BrowseProfile {
  athleteId: string;
  fullName: string;
  locationText: string | null;
  lookingFor: string | null;
}

export function TrainingPartnerBrowseList({
  profiles,
  myAthleteId,
}: {
  profiles: BrowseProfile[];
  myAthleteId: string;
}) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [openRequestFor, setOpenRequestFor] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  async function sendRequest(toAthleteId: string) {
    if (!message.trim() || sending) return;
    setSending(true);
    setError(null);
    const supabase = createBrowserClient();
    const { error: insertError } = await supabase.from("training_partner_requests").insert({
      from_athlete_id: myAthleteId,
      to_athlete_id: toAthleteId,
      message: message.trim(),
    });
    if (insertError) {
      setError(insertError.message);
      setSending(false);
      return;
    }
    notifyPush(toAthleteId, "New training partner request", "Someone wants to train with you", "/partners/requests");
    setSentTo((prev) => new Set(prev).add(toAthleteId));
    setOpenRequestFor(null);
    setMessage("");
    setSending(false);
  }

  async function block(athleteId: string) {
    const supabase = createBrowserClient();
    await supabase.from("training_partner_blocks").insert({
      blocker_id: myAthleteId,
      blocked_id: athleteId,
    });
    setHidden((prev) => new Set(prev).add(athleteId));
  }

  const visible = profiles.filter((p) => !hidden.has(p.athleteId));

  if (visible.length === 0) {
    return (
      <p className="font-body text-sm text-steel py-4">
        No one else is looking for a training partner right now — check back later.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {visible.map((p) => (
        <div key={p.athleteId} className="border border-steel/20 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-body font-medium text-sm">{p.fullName}</p>
              {p.locationText && (
                <p className="font-body text-xs text-steel mt-0.5">{p.locationText}</p>
              )}
              {p.lookingFor && (
                <p className="font-body text-sm text-chalk mt-2">{p.lookingFor}</p>
              )}
            </div>
          </div>

          {sentTo.has(p.athleteId) ? (
            <p className="font-body text-xs text-moss mt-3">Request sent ✓</p>
          ) : openRequestFor === p.athleteId ? (
            <div className="mt-3 space-y-2">
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={2}
                placeholder="Say hi, and share how they can reach you — a number, Instagram, or where to find you."
                className="w-full bg-graphite border border-steel/30 text-chalk px-2.5 py-2 font-body text-sm focus:outline-none focus:border-rust resize-none"
              />
              {error && (
                <p className="font-body text-xs text-rust" role="alert">
                  {error}
                </p>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => sendRequest(p.athleteId)}
                  disabled={!message.trim() || sending}
                  className="h-9 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40"
                >
                  {sending ? "Sending…" : "Send"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setOpenRequestFor(null);
                    setMessage("");
                    setError(null);
                  }}
                  className="h-9 px-4 border border-steel/30 text-steel font-body text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3 mt-3">
              <button
                type="button"
                onClick={() => setOpenRequestFor(p.athleteId)}
                className="h-9 px-4 bg-rust text-graphite font-body text-sm font-medium"
              >
                Send request
              </button>
              <button
                type="button"
                onClick={() => block(p.athleteId)}
                className="font-body text-xs text-steel"
              >
                Block
              </button>
              <ReportUserButton reportedId={p.athleteId} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
