"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { confirmDialog } from "@/components/shared/confirm-dialog";

export interface FrontDeskPerson {
  profileId: string;
  fullName: string;
}

// The people invited only to check clients in (Release T1), shown apart from the coaches because they are not members of the organization. The owner or an admin can remove one; the rule is in the database
// (remove_front_desk). Everyone on this page can open the check-in screen, which is also what front-desk staff land on when they sign in.
export function FrontDeskList({
  organizationId,
  organizationName,
  people,
  canManage,
}: {
  organizationId: string;
  organizationName: string;
  people: FrontDeskPerson[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function remove(p: FrontDeskPerson) {
    if (!(await confirmDialog({ message: `Remove ${p.fullName} from the front desk of ${organizationName}? They can no longer check clients in.`, confirmLabel: "Remove", destructive: true }))) return;
    setBusy(p.profileId);
    setError(null);
    const { error: rpcError } = await createBrowserClient().rpc("remove_front_desk", { p_org: organizationId, p_profile: p.profileId });
    setBusy(null);
    if (rpcError) {
      setError("Couldn't remove them. Try again.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="mb-8">
      <p className="font-body text-xs text-steel uppercase tracking-wide mb-2">Front desk</p>
      {people.length === 0 ? (
        <p className="font-body text-sm text-steel mb-2">{canManage ? "Nobody yet. Invite someone below and choose Front desk." : "Nobody yet."}</p>
      ) : (
        <div className="border border-steel/20 divide-y divide-steel/15 mb-2">
          {people.map((p) => (
            <div key={p.profileId} className="p-3 flex flex-wrap items-center justify-between gap-2">
              <p className="font-body text-sm">{p.fullName}</p>
              {canManage && (
                <button type="button" onClick={() => remove(p)} disabled={busy === p.profileId} className="font-body text-xs text-rust disabled:opacity-40">
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {error && (
        <p className="font-body text-xs text-rust mb-2" role="alert">
          {error}
        </p>
      )}
      <Link href={`/front-desk?org=${organizationId}`} className="font-body text-xs text-rust">
        Open the check-in screen →
      </Link>
    </div>
  );
}
