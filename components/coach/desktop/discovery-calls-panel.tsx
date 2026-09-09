"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

export interface DiscoveryCallRow {
  id: string;
  startAt: string;
  prospectName: string;
  prospectEmail: string;
  prospectPhone: string | null;
  message: string | null;
}

// The coach-facing half of prospect self-booking: the shareable public
// link (same copy-link pattern as InviteAthleteButton), and the list of
// what's actually been booked through it — full contact info, since this
// is the coach's own row now, not the anon-facing side.
export function DiscoveryCallsPanel({
  coachId,
  initialCalls,
}: {
  coachId: string;
  initialCalls: DiscoveryCallRow[];
}) {
  const [calls, setCalls] = useState(initialCalls);
  const [copied, setCopied] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const link = typeof window !== "undefined" ? `${window.location.origin}/book/${coachId}` : "";

  async function handleCopy() {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleCancel(id: string) {
    if (!window.confirm("Cancel this discovery call?")) return;
    setBusyId(id);
    setError(null);
    const supabase = createBrowserClient();
    const { error: updateError } = await supabase
      .from("discovery_bookings")
      .update({ status: "cancelled" })
      .eq("id", id);
    setBusyId(null);
    if (updateError) {
      setError("Couldn't cancel that call — try again.");
      return;
    }
    setCalls((prev) => prev.filter((c) => c.id !== id));
  }

  return (
    <div className="border-t border-steel/20 pt-6 mt-6">
      <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-2">
        Discovery Calls
      </h2>
      <p className="font-body text-sm text-steel mb-3 max-w-[65ch]">
        Share this link anywhere — your bio, website, a text — and anyone
        can book an open slot from your recurring hours above, no account
        needed.
      </p>
      <div className="flex items-center gap-2 max-w-md mb-6">
        <input
          readOnly
          value={link}
          onFocus={(e) => e.target.select()}
          className="flex-1 h-10 min-w-0 bg-surface border border-steel/30 text-chalk px-2 font-body text-xs focus:outline-none"
        />
        <button
          type="button"
          onClick={handleCopy}
          className="h-10 px-3 border border-rust text-rust font-body text-xs shrink-0"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      {error && <p className="font-body text-xs text-rust mb-2">{error}</p>}

      {calls.length === 0 ? (
        <p className="font-body text-sm text-steel">No discovery calls booked yet.</p>
      ) : (
        <div className="divide-y divide-steel/15 max-w-2xl">
          {calls.map((call) => (
            <div key={call.id} className="py-3 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="font-body text-sm font-medium">
                  {call.prospectName}{" "}
                  <span className="text-steel font-normal">
                    &middot; {new Date(call.startAt).toLocaleString(undefined, {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </span>
                </p>
                <p className="font-body text-xs text-steel mt-0.5">
                  {call.prospectEmail}
                  {call.prospectPhone ? ` · ${call.prospectPhone}` : ""}
                </p>
                {call.message && (
                  <p className="font-body text-xs text-chalk mt-1 max-w-md">{call.message}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => handleCancel(call.id)}
                disabled={busyId === call.id}
                className="font-body text-xs text-steel active:text-rust transition-colors shrink-0 disabled:opacity-40"
              >
                Cancel
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
