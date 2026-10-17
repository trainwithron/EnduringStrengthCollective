"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { confirmDialog } from "@/components/shared/confirm-dialog";

// A coach or admin who is not the owner can leave the organization. A coach who is the only coach of clients chooses who takes over first (migration 0391); a client who keeps their records private from the
// organization leaves with that coach. The owner cannot leave (the database says so in plain words).
export function LeaveOrganizationControl({
  organizationId,
  organizationName,
  others = [],
  soleClients = 0,
  unknown = false,
}: {
  organizationId: string;
  organizationName: string;
  others?: { id: string; name: string }[];
  soleClients?: number;
  // The check of which clients only this coach has could not be made: Leave waits for a reload rather than guessing.
  unknown?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [handTo, setHandTo] = useState("");
  const needsHandOver = soleClients > 0;

  async function leave() {
    if (needsHandOver && !handTo) {
      setError(`Choose who takes over your ${soleClients} client${soleClients === 1 ? "" : "s"} first.`);
      return;
    }
    const takeover = others.find((o) => o.id === handTo)?.name;
    const message = needsHandOver
      ? `Leave ${organizationName}? You lose coach access to its groups. Your ${soleClients} client${soleClients === 1 ? "" : "s"} stay${soleClients === 1 ? "s" : ""} with ${organizationName} and ${takeover} takes over, with all history, programs and credits. A client who keeps their records private from the organization stays with you; you then choose whether to start your own account or export everything.`
      : `Leave ${organizationName}? You lose coach access to its groups. A client who keeps their records private from the organization stays with you; you then choose whether to start your own account or export everything.`;
    if (!(await confirmDialog({ message, confirmLabel: "Leave" }))) return;
    setBusy(true);
    setError(null);
    const { data, error: rpcError } = await createBrowserClient({ crossOrg: true }).rpc("leave_organization", { p_org: organizationId, p_hand_to: needsHandOver ? handTo : null });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    // Still coaching clients who are private from the organization: they land on their Home, where the two choices are.
    router.push((data as { leaving?: boolean } | null)?.leaving ? "/dashboard" : "/choose-organization?next=/dashboard");
    router.refresh();
  }

  return (
    <div className="py-3">
      <p className="font-body text-sm text-chalk">You are part of {organizationName}.</p>
      {needsHandOver && (
        <div className="mt-2">
          <label htmlFor="leave-hand-to" className="font-body text-xs text-steel">
            You are the only coach of {soleClients} client{soleClients === 1 ? "" : "s"}. Who takes over?
          </label>
          <select id="leave-hand-to" value={handTo} onChange={(e) => setHandTo(e.target.value)} className="w-full h-11 mt-1 bg-graphite border border-steel/30 text-chalk px-2.5 font-body text-base sm:text-sm">
            <option value="">Choose a coach…</option>
            {others.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {error && (
        <p className="font-body text-xs text-rust mt-1" role="alert">
          {error}
        </p>
      )}
      {unknown && (
        <p className="font-body text-xs text-rust mt-1" role="alert">
          We could not check which clients only you coach. Reload the page to leave.
        </p>
      )}
      <button type="button" disabled={busy || unknown} onClick={leave} className="mt-2 min-h-11 border border-steel/40 px-4 font-body text-sm text-chalk disabled:opacity-40">
        {busy ? "Leaving…" : "Leave this organization"}
      </button>
    </div>
  );
}
