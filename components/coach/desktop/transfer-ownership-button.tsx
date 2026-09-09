"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { Crown } from "lucide-react";

interface MemberOption {
  profileId: string;
  fullName: string;
}

// Owner-only. Hands full ownership of the organization to another
// existing member — never to an outsider, the RPC itself rejects a
// target who isn't already a member. The current owner becomes an
// admin rather than losing access outright.
export function TransferOwnershipButton({
  organizationId,
  candidates,
}: {
  organizationId: string;
  candidates: MemberOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(candidates[0]?.profileId ?? "");
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = candidates.find((c) => c.profileId === selectedId);

  async function handleTransfer() {
    if (!selectedId || submitting) return;
    setSubmitting(true);
    setError(null);
    const supabase = createBrowserClient();
    const { error: rpcError } = await supabase.rpc("transfer_organization_ownership", {
      p_organization_id: organizationId,
      p_new_owner_id: selectedId,
    });
    setSubmitting(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    router.refresh();
  }

  if (candidates.length === 0) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 h-11 px-4 border border-steel/30 text-steel font-body text-sm font-medium active:border-rust active:text-rust transition-colors"
      >
        <Crown className="w-4 h-4" strokeWidth={2.25} />
        Transfer ownership
      </button>
    );
  }

  return (
    <div className="border border-steel/30 p-4 max-w-sm bg-surface">
      <p className="font-body text-xs text-steel uppercase tracking-wide mb-3">
        Transfer organization ownership
      </p>

      {!confirming ? (
        <div className="space-y-3">
          <div>
            <label htmlFor="new-owner" className="font-body text-xs text-steel">
              New owner
            </label>
            <select
              id="new-owner"
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              className="w-full h-10 mt-1 bg-graphite border border-steel/30 text-chalk px-2.5 font-body text-sm focus:outline-none focus:border-rust"
            >
              {candidates.map((c) => (
                <option key={c.profileId} value={c.profileId}>
                  {c.fullName}
                </option>
              ))}
            </select>
          </div>
          <p className="font-body text-[11px] text-steel">
            You&apos;ll be moved from owner to admin — you keep access, but {selected?.fullName ?? "they"}{" "}
            becomes the organization&apos;s new owner.
          </p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="h-9 px-4 border border-rust text-rust font-body text-sm font-medium active:bg-rust active:text-graphite transition-colors"
            >
              Continue
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="font-body text-xs text-steel"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="font-body text-sm text-rust">
            Make {selected?.fullName} the owner of this organization? This can&apos;t be undone
            except by them transferring it back.
          </p>
          {error && (
            <p className="font-body text-xs text-rust" role="alert">
              {error}
            </p>
          )}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleTransfer}
              disabled={submitting}
              className="h-9 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40"
            >
              {submitting ? "Transferring…" : "Confirm transfer"}
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
                setOpen(false);
              }}
              disabled={submitting}
              className="font-body text-xs text-steel disabled:opacity-40"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
