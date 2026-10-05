"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { daysLeft, groupInviteState, shouldListGroupInvite, type GroupInviteState } from "@/lib/invite-state";
import { appOriginBrowser } from "@/lib/app-url";

export interface GroupInviteRow {
  id: string;
  code: string;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
}

function randomCode(length = 10) {
  // Excludes look-alike characters (0/O, 1/l/I): these get read aloud and retyped.
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i++) out += chars[bytes[i] % chars.length];
  return out;
}

const STATE_LABEL: Record<GroupInviteState, string> = {
  live: "Works",
  expired: "Expired",
  revoked: "Cancelled",
};

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Every invite link this group has made: which still work, which ran out, which
// were cancelled. Cancelled and expired ones stay, greyed, for a week.
export function GroupInvitesPanel({
  groupId,
  createdBy,
  invites,
  oneOnOneClientName,
}: {
  groupId: string;
  createdBy: string;
  invites: GroupInviteRow[];
  // Set when this is a one-on-one group that already has its client: more links cannot be used.
  oneOnOneClientName: string | null;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const now = new Date();
  const visible = invites.filter((i) => shouldListGroupInvite({ expiresAt: i.expiresAt, revokedAt: i.revokedAt }, now));
  const liveCount = visible.filter((i) => groupInviteState({ expiresAt: i.expiresAt, revokedAt: i.revokedAt }, now) === "live").length;

  async function create() {
    setError(null);
    setCreating(true);
    const supabase = createBrowserClient();
    const { error: insertError } = await supabase.from("group_invites").insert({
      group_id: groupId,
      code: randomCode(),
      role: "athlete",
      created_by: createdBy,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    });
    setCreating(false);
    if (insertError) {
      setError("Couldn't create an invite link. Try again.");
      return;
    }
    router.refresh();
  }

  async function act(inviteId: string, action: "revoke" | "extend") {
    if (action === "revoke" && !window.confirm("Cancel this link? Anyone who has it will no longer be able to join with it.")) {
      return;
    }
    setError(null);
    setBusyId(inviteId);
    try {
      const res = await fetch("/api/invites/group", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, inviteId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "That didn't work. Try again.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work. Try again.");
    } finally {
      setBusyId(null);
    }
  }

  async function copy(invite: GroupInviteRow) {
    try {
      await navigator.clipboard.writeText(`${appOriginBrowser()}/invite/${invite.code}`);
      setCopiedId(invite.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      setError("Couldn't copy. Select the link and copy it by hand.");
    }
  }

  return (
    <section className="mb-8 border border-steel/20 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display uppercase text-sm tracking-wide text-steel">Invite links</h2>
        <span className="font-body text-xs text-steel">{liveCount} working</span>
      </div>
      {oneOnOneClientName && (
        <p className="font-body text-xs text-steel mt-2">
          This is a one-on-one group and {oneOnOneClientName} has already joined, so a new link can&apos;t be used to
          join it.
        </p>
      )}

      {visible.length === 0 ? (
        <p className="font-body text-sm text-steel mt-3">No invite links yet.</p>
      ) : (
        <ul className="mt-3 divide-y divide-steel/15">
          {visible.map((inv) => {
            const state = groupInviteState({ expiresAt: inv.expiresAt, revokedAt: inv.revokedAt }, now);
            const left = daysLeft(inv.expiresAt, now);
            const dead = state !== "live";
            return (
              <li key={inv.id} className={`py-3 ${dead ? "opacity-60" : ""}`}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span
                    className={`font-body text-xs uppercase tracking-wide ${
                      state === "live" ? "text-positive" : "text-steel"
                    }`}
                  >
                    {STATE_LABEL[state]}
                  </span>
                  <span className="font-body text-sm text-chalk">Made {formatDay(inv.createdAt)}</span>
                  <span className="font-body text-xs text-steel">
                    {state === "live"
                      ? left == null
                        ? "No expiry"
                        : `expires in ${left} ${left === 1 ? "day" : "days"}`
                      : state === "revoked" && inv.revokedAt
                      ? `cancelled ${formatDay(inv.revokedAt)}`
                      : inv.expiresAt
                      ? `ran out ${formatDay(inv.expiresAt)}`
                      : ""}
                  </span>
                </div>
                {!dead && (
                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    <button
                      type="button"
                      onClick={() => copy(inv)}
                      className="h-11 px-4 border border-rust text-rust font-body text-sm"
                    >
                      {copiedId === inv.id ? "Copied" : "Copy link"}
                    </button>
                    <button
                      type="button"
                      onClick={() => act(inv.id, "extend")}
                      disabled={busyId === inv.id}
                      className="h-11 px-4 border border-steel/30 text-steel font-body text-sm disabled:opacity-40"
                    >
                      Add 7 days
                    </button>
                    <button
                      type="button"
                      onClick={() => act(inv.id, "revoke")}
                      disabled={busyId === inv.id}
                      className="h-11 px-4 text-steel font-body text-sm underline underline-offset-2 disabled:opacity-40"
                    >
                      Cancel link
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <button
        type="button"
        onClick={create}
        disabled={creating}
        className="h-11 px-4 mt-3 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-50"
      >
        {creating ? "Creating…" : "New invite link"}
      </button>
      {error && (
        <p className="font-body text-xs text-rust mt-2" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
