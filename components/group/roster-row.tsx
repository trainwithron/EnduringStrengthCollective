"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import type { RosterMember } from "@/lib/types";
import { clientActivityStatus } from "@/lib/client-activity-status";

export function RosterRow({
  member,
  groupId,
  viewerIsCoach,
  isViewer,
  isOnlyCoach,
}: {
  member: RosterMember;
  groupId: string;
  viewerIsCoach: boolean;
  isViewer: boolean;
  isOnlyCoach: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [optimisticRole, setOptimisticRole] = useState(member.role);
  const [removed, setRemoved] = useState(false);
  const router = useRouter();

  const status = clientActivityStatus(member.lastWorkoutAt);
  const initials = member.fullName
    .split(" ")
    .map((p) => Array.from(p)[0] ?? "")
    .slice(0, 2)
    .join("")
    .toUpperCase();

  function handleRoleToggle() {
    if (optimisticRole === "coach" && isOnlyCoach) {
      setError("A group needs at least one coach.");
      return;
    }
    setError(null);
    const previousRole = optimisticRole;
    const nextRole = previousRole === "coach" ? "athlete" : "coach";
    // Flip the label instantly; the mutation runs in the background so the
    // click doesn't feel like it's waiting on a server round-trip.
    setOptimisticRole(nextRole);

    const supabase = createBrowserClient();
    supabase
      .from("group_memberships")
      .update({ role: nextRole })
      .eq("group_id", groupId)
      .eq("profile_id", member.profileId)
      .then(({ error: updateError }) => {
        if (updateError) {
          setOptimisticRole(previousRole);
          setError("Couldn't update role.");
          return;
        }
        router.refresh();
      });
  }

  function handleRemove() {
    if (optimisticRole === "coach" && isOnlyCoach) {
      setError("A group needs at least one coach.");
      return;
    }
    if (!window.confirm(`Remove ${member.fullName} from the group?`)) return;

    setError(null);
    setBusy(true);
    // Hide the row immediately rather than waiting for the delete + a full
    // page refresh before anything visually changes.
    setRemoved(true);

    const supabase = createBrowserClient();
    supabase
      .from("group_memberships")
      .delete()
      .eq("group_id", groupId)
      .eq("profile_id", member.profileId)
      .then(({ error: deleteError }) => {
        if (deleteError) {
          setRemoved(false);
          setBusy(false);
          setError("Couldn't remove member.");
          return;
        }
        router.refresh();
      });
  }

  if (removed) return null;

  const linkToProfile = viewerIsCoach && optimisticRole === "athlete";

  const avatarAndName = (
    <>
      {member.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={member.avatarUrl}
          alt=""
          className="w-11 h-11 rounded-full object-cover shrink-0"
        />
      ) : (
        <div className="w-11 h-11 rounded-full bg-surface border border-steel/30 flex items-center justify-center shrink-0">
          <span className="font-display text-sm text-chalk">{initials}</span>
        </div>
      )}

      <div className="flex-1 min-w-0">
        <p className="font-body font-medium text-[15px] truncate">
          {member.fullName}
        </p>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className={`w-1.5 h-1.5 rounded-full ${status.dotClass}`} />
          <span className="font-body text-xs text-steel">{status.text}</span>
        </div>
      </div>
    </>
  );

  return (
    <div className="py-3 -mx-1 px-1">
      <div className="flex items-center gap-3 min-h-[56px]">
        {linkToProfile ? (
          <Link
            href={`/groups/${groupId}/athletes/${member.profileId}`}
            className="flex items-center gap-3 flex-1 min-w-0 active:opacity-70 transition-opacity"
          >
            {avatarAndName}
          </Link>
        ) : (
          avatarAndName
        )}

        {optimisticRole === "coach" && (
          <span className="font-body text-[11px] tracking-wide text-rust shrink-0">
            Coach
          </span>
        )}

        {viewerIsCoach && !isViewer && (
          <div className="flex items-center gap-3 shrink-0">
            {optimisticRole === "athlete" && (
              <Link
                href={`/groups/${groupId}/athletes/${member.profileId}/log`}
                className="font-body text-xs text-rust"
              >
                Log
              </Link>
            )}
            <button
              type="button"
              onClick={handleRoleToggle}
              disabled={busy}
              className="font-body text-xs text-steel active:text-rust transition-colors disabled:opacity-40"
            >
              {optimisticRole === "coach" ? "Make athlete" : "Make coach"}
            </button>
            <button
              type="button"
              onClick={handleRemove}
              disabled={busy}
              className="font-body text-xs text-steel active:text-rust transition-colors disabled:opacity-40"
            >
              Remove
            </button>
          </div>
        )}
      </div>

      {error && <p className="font-body text-xs text-rust mt-1">{error}</p>}
    </div>
  );
}
