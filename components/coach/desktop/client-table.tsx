"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import type { RosterMember } from "@/lib/types";

function daysSinceOf(lastWorkoutAt: string | null): number {
  // Never-logged clients need attention more than anyone with an actual
  // (however old) log, so they sort as "infinitely" quiet.
  if (!lastWorkoutAt) return Infinity;
  return Math.floor((Date.now() - new Date(lastWorkoutAt).getTime()) / (1000 * 60 * 60 * 24));
}

function statusLabel(lastWorkoutAt: string | null): { text: string; dotClass: string } {
  if (!lastWorkoutAt) {
    return { text: "No logs yet", dotClass: "bg-steel" };
  }
  const daysSince = daysSinceOf(lastWorkoutAt);
  if (daysSince === 0) return { text: "Logged today", dotClass: "bg-moss" };
  if (daysSince === 1) return { text: "Logged yesterday", dotClass: "bg-steel" };
  if (daysSince <= 3) return { text: `${daysSince} days quiet`, dotClass: "bg-steel" };
  return { text: `${daysSince} days quiet`, dotClass: "bg-rust" };
}

type SortMode = "attention" | "name";

function initialsOf(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function ClientTable({
  groupId,
  members,
  creditsByAthleteId,
}: {
  groupId: string;
  members: RosterMember[];
  creditsByAthleteId: Map<string, number>;
}) {
  const [rows, setRows] = useState(members);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>("attention");
  const router = useRouter();

  const isOnlyCoach = rows.filter((m) => m.role === "coach").length === 1;

  const sortedRows = [...rows].sort((a, b) => {
    if (sortMode === "name") return a.fullName.localeCompare(b.fullName);
    // Quietest first — the whole point of this view is surfacing clients
    // who need a check-in without scanning the full roster.
    return daysSinceOf(b.lastWorkoutAt) - daysSinceOf(a.lastWorkoutAt);
  });

  async function handleRoleToggle(member: RosterMember) {
    if (member.role === "coach" && isOnlyCoach) {
      setError("A group needs at least one coach.");
      return;
    }
    setBusyId(member.profileId);
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
      setBusyId(null);
      return;
    }
    router.refresh();
  }

  async function handleRemove(member: RosterMember) {
    if (member.role === "coach" && isOnlyCoach) {
      setError("A group needs at least one coach.");
      return;
    }
    if (!window.confirm(`Remove ${member.fullName} from the group?`)) return;

    setBusyId(member.profileId);
    setError(null);
    const supabase = createBrowserClient();
    const { error: deleteError } = await supabase
      .from("group_memberships")
      .delete()
      .eq("group_id", groupId)
      .eq("profile_id", member.profileId);

    if (deleteError) {
      setError("Couldn't remove member.");
      setBusyId(null);
      return;
    }
    setRows((prev) => prev.filter((m) => m.profileId !== member.profileId));
    router.refresh();
  }

  return (
    <div>
      {error && <p className="font-body text-sm text-rust mb-3">{error}</p>}

      <div className="flex items-center justify-end gap-2 mb-2">
        <span className="font-body text-xs text-steel uppercase tracking-wide">Sort</span>
        <button
          type="button"
          onClick={() => setSortMode("attention")}
          className={`font-body text-xs px-2 py-1 border ${
            sortMode === "attention"
              ? "text-rust border-rust"
              : "text-steel border-steel/30"
          }`}
        >
          Needs attention
        </button>
        <button
          type="button"
          onClick={() => setSortMode("name")}
          className={`font-body text-xs px-2 py-1 border ${
            sortMode === "name" ? "text-rust border-rust" : "text-steel border-steel/30"
          }`}
        >
          A–Z
        </button>
      </div>

      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-steel/20">
            <th className="text-left font-body text-xs text-steel uppercase tracking-wide font-medium py-2">
              Client
            </th>
            <th className="text-left font-body text-xs text-steel uppercase tracking-wide font-medium py-2">
              Status
            </th>
            <th className="text-left font-body text-xs text-steel uppercase tracking-wide font-medium py-2">
              Session Credits
            </th>
            <th className="text-right font-body text-xs text-steel uppercase tracking-wide font-medium py-2">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((member) => {
            const status = statusLabel(member.lastWorkoutAt);
            const credits = creditsByAthleteId.get(member.profileId) ?? 0;
            const busy = busyId === member.profileId;
            return (
              <tr key={member.profileId} className="border-b border-steel/15">
                <td className="py-3 pr-4">
                  <Link
                    href={`/groups/${groupId}/athletes/${member.profileId}`}
                    className="flex items-center gap-3 min-w-0 w-fit"
                  >
                    {member.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={member.avatarUrl}
                        alt=""
                        className="w-9 h-9 rounded-full object-cover shrink-0"
                      />
                    ) : (
                      <div className="w-9 h-9 rounded-full bg-surface border border-steel/30 flex items-center justify-center shrink-0">
                        <span className="font-display text-xs text-chalk">
                          {initialsOf(member.fullName)}
                        </span>
                      </div>
                    )}
                    <span className="font-body font-medium text-[15px] text-chalk">
                      {member.fullName}
                    </span>
                  </Link>
                </td>
                <td className="py-3 pr-4">
                  <span className="flex items-center gap-1.5">
                    <span className={`w-1.5 h-1.5 rounded-full ${status.dotClass}`} />
                    <span className="font-body text-xs text-steel">{status.text}</span>
                  </span>
                </td>
                <td className="py-3 pr-4">
                  <span className="font-body text-sm">{credits}</span>
                </td>
                <td className="py-3">
                  <div className="flex items-center justify-end gap-3">
                    <Link
                      href={`/groups/${groupId}/athletes/${member.profileId}/log`}
                      className="font-body text-xs text-rust"
                    >
                      Log
                    </Link>
                    <button
                      type="button"
                      onClick={() => handleRoleToggle(member)}
                      disabled={busy}
                      className="font-body text-xs text-steel active:text-rust transition-colors disabled:opacity-40"
                    >
                      Make coach
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemove(member)}
                      disabled={busy}
                      className="font-body text-xs text-steel active:text-rust transition-colors disabled:opacity-40"
                    >
                      Remove
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {rows.length === 0 && (
        <p className="font-body text-sm text-steel py-6">
          No athletes yet. Send an invite to get the first one training.
        </p>
      )}
    </div>
  );
}
