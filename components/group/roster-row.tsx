"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import type { RosterMember } from "@/lib/types";

function statusLabel(lastWorkoutAt: string | null): {
  text: string;
  dotClass: string;
} {
  if (!lastWorkoutAt) {
    return { text: "No logs yet", dotClass: "bg-steel" };
  }

  const daysSince = Math.floor(
    (Date.now() - new Date(lastWorkoutAt).getTime()) / (1000 * 60 * 60 * 24)
  );

  if (daysSince === 0) return { text: "Logged today", dotClass: "bg-moss" };
  if (daysSince === 1) return { text: "Logged yesterday", dotClass: "bg-steel" };
  if (daysSince <= 3)
    return { text: `${daysSince} days quiet`, dotClass: "bg-steel" };
  return { text: `${daysSince} days quiet`, dotClass: "bg-rust" };
}

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
  const router = useRouter();

  const status = statusLabel(member.lastWorkoutAt);
  const initials = member.fullName
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  async function handleRoleToggle() {
    if (member.role === "coach" && isOnlyCoach) {
      setError("A group needs at least one coach.");
      return;
    }
    setBusy(true);
    setError(null);

    const supabase = createBrowserClient();
    const nextRole = member.role === "coach" ? "athlete" : "coach";
    const { error: updateError } = await supabase
      .from("group_memberships")
      .update({ role: nextRole })
      .eq("group_id", groupId)
      .eq("profile_id", member.profileId);

    if (updateError) {
      setError("Couldn't update role.");
      setBusy(false);
      return;
    }

    router.refresh();
  }

  async function handleRemove() {
    if (member.role === "coach" && isOnlyCoach) {
      setError("A group needs at least one coach.");
      return;
    }
    if (!window.confirm(`Remove ${member.fullName} from the group?`)) return;

    setBusy(true);
    setError(null);

    const supabase = createBrowserClient();
    const { error: deleteError } = await supabase
      .from("group_memberships")
      .delete()
      .eq("group_id", groupId)
      .eq("profile_id", member.profileId);

    if (deleteError) {
      setError("Couldn't remove member.");
      setBusy(false);
      return;
    }

    router.refresh();
  }

  const linkToProfile = viewerIsCoach && member.role === "athlete";

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

        {member.role === "coach" && (
          <span className="font-body text-[11px] tracking-wide text-rust shrink-0">
            Coach
          </span>
        )}

        {viewerIsCoach && !isViewer && (
          <div className="flex items-center gap-3 shrink-0">
            {member.role === "athlete" && (
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
              {member.role === "coach" ? "Make athlete" : "Make coach"}
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
