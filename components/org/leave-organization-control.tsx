"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { confirmDialog } from "@/components/shared/confirm-dialog";

// A coach or admin who is not the owner can leave the organization. The database function refuses for the owner and for a coach who is the only coach of a group that has clients, in plain words.
export function LeaveOrganizationControl({ organizationId, organizationName }: { organizationId: string; organizationName: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function leave() {
    if (!(await confirmDialog({ message: `Leave ${organizationName}? You lose coach access to its groups. Its clients stay with the organization.`, confirmLabel: "Leave" }))) return;
    setBusy(true);
    setError(null);
    const { error: rpcError } = await createBrowserClient({ crossOrg: true }).rpc("leave_organization", { p_org: organizationId });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    router.push("/choose-organization?next=/dashboard");
    router.refresh();
  }

  return (
    <div className="py-3">
      <p className="font-body text-sm text-chalk">You are part of {organizationName}.</p>
      {error && (
        <p className="font-body text-xs text-rust mt-1" role="alert">
          {error}
        </p>
      )}
      <button type="button" disabled={busy} onClick={leave} className="mt-2 min-h-11 border border-steel/40 px-4 font-body text-sm text-chalk disabled:opacity-40">
        {busy ? "Leaving…" : "Leave this organization"}
      </button>
    </div>
  );
}
