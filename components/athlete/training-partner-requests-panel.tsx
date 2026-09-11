"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { notifyPush } from "@/lib/push-notify";
import { ReportUserButton } from "./report-user-button";

export interface PartnerRequestRow {
  id: string;
  fromAthleteId: string;
  toAthleteId: string;
  fromName: string;
  toName: string;
  status: "pending" | "accepted" | "declined";
  message: string;
  responseMessage: string | null;
}

export function TrainingPartnerRequestsPanel({
  myAthleteId,
  incoming,
  outgoing,
  matched,
}: {
  myAthleteId: string;
  incoming: PartnerRequestRow[];
  outgoing: PartnerRequestRow[];
  matched: PartnerRequestRow[];
}) {
  const [resolved, setResolved] = useState<Record<string, "accepted" | "declined">>({});
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [responseDraft, setResponseDraft] = useState("");

  async function decline(row: PartnerRequestRow) {
    const supabase = createBrowserClient();
    const { error } = await supabase
      .from("training_partner_requests")
      .update({ status: "declined", updated_at: new Date().toISOString() })
      .eq("id", row.id);
    if (!error) setResolved((prev) => ({ ...prev, [row.id]: "declined" }));
  }

  async function accept(row: PartnerRequestRow) {
    if (!responseDraft.trim()) return;
    const supabase = createBrowserClient();
    const { error } = await supabase
      .from("training_partner_requests")
      .update({
        status: "accepted",
        response_message: responseDraft.trim(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    if (!error) {
      setResolved((prev) => ({ ...prev, [row.id]: "accepted" }));
      setAcceptingId(null);
      setResponseDraft("");
      notifyPush(
        row.fromAthleteId,
        "Training partner request accepted",
        `${row.toName} accepted your request`,
        "/partners/requests"
      );
    }
  }

  const pendingIncoming = incoming.filter((r) => !resolved[r.id]);

  return (
    <div className="space-y-8">
      <section>
        <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-2">
          Incoming requests
        </h2>
        {pendingIncoming.length === 0 ? (
          <p className="font-body text-sm text-steel">No pending requests.</p>
        ) : (
          <div className="space-y-3">
            {pendingIncoming.map((r) => (
              <div key={r.id} className="border border-steel/20 p-4">
                <p className="font-body font-medium text-sm">{r.fromName}</p>
                <p className="font-body text-sm text-chalk mt-1">{r.message}</p>
                {acceptingId === r.id ? (
                  <div className="mt-3 space-y-2">
                    <textarea
                      value={responseDraft}
                      onChange={(e) => setResponseDraft(e.target.value)}
                      rows={2}
                      placeholder="Share how they can reach you — a number, Instagram, or where to find you."
                      className="w-full bg-graphite border border-steel/30 text-chalk px-2.5 py-2 font-body text-sm focus:outline-none focus:border-rust resize-none"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => accept(r)}
                        disabled={!responseDraft.trim()}
                        className="h-9 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40"
                      >
                        Confirm accept
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setAcceptingId(null);
                          setResponseDraft("");
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
                      onClick={() => setAcceptingId(r.id)}
                      className="h-9 px-4 bg-rust text-graphite font-body text-sm font-medium"
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      onClick={() => decline(r)}
                      className="h-9 px-4 border border-steel/30 text-steel font-body text-sm"
                    >
                      Decline
                    </button>
                    <ReportUserButton reportedId={r.fromAthleteId} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-2">
          Sent requests
        </h2>
        {outgoing.length === 0 ? (
          <p className="font-body text-sm text-steel">No requests sent yet.</p>
        ) : (
          <div className="space-y-2">
            {outgoing.map((r) => (
              <div key={r.id} className="border border-steel/20 p-3 flex items-center justify-between">
                <span className="font-body text-sm">{r.toName}</span>
                <span className="font-body text-xs text-steel uppercase tracking-wide">
                  {r.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-2">
          Matched
        </h2>
        {matched.length === 0 ? (
          <p className="font-body text-sm text-steel">No matches yet.</p>
        ) : (
          <div className="space-y-3">
            {matched.map((r) => {
              const iAmRequester = r.fromAthleteId === myAthleteId;
              const otherName = iAmRequester ? r.toName : r.fromName;
              const otherId = iAmRequester ? r.toAthleteId : r.fromAthleteId;
              // Whichever message is theirs, not mine.
              const theirMessage = iAmRequester ? r.responseMessage : r.message;
              return (
                <div key={r.id} className="border border-moss/40 p-4">
                  <p className="font-body font-medium text-sm">{otherName}</p>
                  {theirMessage && (
                    <p className="font-body text-sm text-chalk mt-1">{theirMessage}</p>
                  )}
                  <div className="mt-3">
                    <ReportUserButton reportedId={otherId} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
