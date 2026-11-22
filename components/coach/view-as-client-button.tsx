"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTerm } from "@/components/coach/terminology-provider";

// "View as client" on a phone (Nov 21, PH11): it used to sit on every Spotlight client row; it now lives once, on the client's Profile page. This starts real account impersonation (the
// coach sees and writes as this client until they exit), so it asks first, with the same words the row used. Phone only: the computer has no act-as (Oct 5, 3a34e6d4); there the profile's
// Program tab keeps its read-only "View as client" preview.
export function ViewAsClientButton({ athleteId, groupId, name }: { athleteId: string; groupId: string; name: string }) {
  const router = useRouter();
  // The coach's own word ("client", "athlete", "member"...), as the computer's View-as link uses.
  const term = useTerm();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  async function confirm() {
    if (busy) return;
    setBusy(true);
    await fetch("/api/coach/act-as", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ athleteId, groupId }) });
    router.push(`/groups/${groupId}`);
    router.refresh();
  }

  if (!asking) {
    return (
      <button type="button" onClick={() => setAsking(true)} className="min-h-11 px-4 border border-steel/30 text-steel font-body text-xs active:border-rust/50" data-view-as-client>
        View as {term("client")}
      </button>
    );
  }

  return (
    <div className="w-full border border-steel/20 p-3" data-view-as-confirm>
      <p className="font-body text-sm text-chalk mb-1">View as {name}?</p>
      <p className="font-body text-xs text-steel mb-3">
        You&apos;ll see their real data, and anything you log from here on is attributed to them — until you exit this view.
      </p>
      <div className="flex items-center gap-3">
        <button type="button" disabled={busy} onClick={confirm} className="min-h-11 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-50">
          View as {name}
        </button>
        <button type="button" disabled={busy} onClick={() => setAsking(false)} className="min-h-11 px-2 font-body text-sm text-steel disabled:opacity-50">
          Cancel
        </button>
      </div>
    </div>
  );
}
