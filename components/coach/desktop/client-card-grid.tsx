"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { CardSizeToggle } from "@/components/coach/desktop/card-size-toggle";
import { readCardSize, writeCardSize, type CardSize } from "@/lib/card-size";
import type { RosterMember, ClientTier } from "@/lib/types";
import { MoreVertical } from "lucide-react";

const TIER_LABELS: Record<NonNullable<ClientTier>, string> = {
  one_on_one: "1-on-1",
  online: "Online",
  group: "Group",
};

function daysSinceOf(lastWorkoutAt: string | null): number {
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

function initialsOf(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

type SortMode = "attention" | "name";

const STORAGE_KEY = "esc-card-size-clients";

const GRID_CLASS: Record<CardSize, string> = {
  small: "grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3",
  medium: "grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-4",
  large: "grid-cols-[repeat(auto-fill,minmax(270px,1fr))] gap-5",
};

const AVATAR_CLASS: Record<CardSize, string> = {
  small: "w-10 h-10 text-[11px]",
  medium: "w-14 h-14 text-sm",
  large: "w-[72px] h-[72px] text-base",
};

export function ClientCardGrid({
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
  // "Make coach" is a rare, higher-consequence action — tucked behind a
  // small overflow menu per card instead of sitting in the front-row
  // action bar next to Log/Remove, per direct feedback that it didn't
  // need to be front-and-center.
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>("attention");
  const [tierFilter, setTierFilter] = useState<ClientTier | "all">("all");
  const [size, setSize] = useState<CardSize>("medium");
  const router = useRouter();

  useEffect(() => {
    setSize(readCardSize(STORAGE_KEY));
  }, []);

  // useState(members) only seeds from the prop on first mount — a newly
  // added client (Add Client, an invite redeemed, etc.) updates the
  // server data and this component's own `members` prop via
  // router.refresh(), but without this, the already-mounted grid keeps
  // showing its original snapshot until a full page reload. Same class
  // of bug as FeedList's stale-channel fix earlier this session.
  useEffect(() => {
    setRows(members);
  }, [members]);

  function handleSizeChange(next: CardSize) {
    setSize(next);
    writeCardSize(STORAGE_KEY, next);
  }

  const isOnlyCoach = rows.filter((m) => m.role === "coach").length === 1;

  const filteredRows = tierFilter === "all" ? rows : rows.filter((m) => m.clientTier === tierFilter);

  const sortedRows = [...filteredRows].sort((a, b) => {
    if (sortMode === "name") return a.fullName.localeCompare(b.fullName);
    return daysSinceOf(b.lastWorkoutAt) - daysSinceOf(a.lastWorkoutAt);
  });

  async function handleTierChange(member: RosterMember, tier: ClientTier) {
    setRows((prev) =>
      prev.map((m) => (m.profileId === member.profileId ? { ...m, clientTier: tier } : m))
    );
    const supabase = createBrowserClient();
    await supabase
      .from("group_memberships")
      .update({ client_tier: tier })
      .eq("group_id", groupId)
      .eq("profile_id", member.profileId);
    router.refresh();
  }

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

      <div className="flex items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-2">
          <span className="font-body text-xs text-steel uppercase tracking-wide">Tier</span>
          {(["all", "one_on_one", "online", "group"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTierFilter(t)}
              className={`font-body text-xs px-2 py-1 border ${
                tierFilter === t ? "text-rust border-rust" : "text-steel border-steel/30"
              }`}
            >
              {t === "all" ? "All" : TIER_LABELS[t]}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="font-body text-xs text-steel uppercase tracking-wide">Sort</span>
            <button
              type="button"
              onClick={() => setSortMode("attention")}
              className={`font-body text-xs px-2 py-1 border ${
                sortMode === "attention" ? "text-rust border-rust" : "text-steel border-steel/30"
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
          <CardSizeToggle size={size} onChange={handleSizeChange} />
        </div>
      </div>

      {sortedRows.length === 0 ? (
        <p className="font-body text-sm text-steel py-6">
          No athletes yet. Send an invite to get the first one training.
        </p>
      ) : (
        <div className={`grid ${GRID_CLASS[size]}`}>
          {sortedRows.map((member) => {
            const status = statusLabel(member.lastWorkoutAt);
            const credits = creditsByAthleteId.get(member.profileId) ?? 0;
            const busy = busyId === member.profileId;
            return (
              <div
                key={member.profileId}
                className="border border-steel/20 bg-surface/40 p-4 flex flex-col items-center text-center gap-2"
              >
                <Link href={`/groups/${groupId}/athletes/${member.profileId}`} className="flex flex-col items-center gap-2">
                  {member.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={member.avatarUrl}
                      alt=""
                      className={`${AVATAR_CLASS[size]} rounded-full object-cover shrink-0`}
                    />
                  ) : (
                    <div
                      className={`${AVATAR_CLASS[size]} rounded-full bg-graphite border border-steel/30 flex items-center justify-center shrink-0`}
                    >
                      <span className="font-display text-chalk">{initialsOf(member.fullName)}</span>
                    </div>
                  )}
                  <span className="font-body font-medium text-[15px] text-chalk">{member.fullName}</span>
                </Link>

                <span className="flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full ${status.dotClass}`} />
                  <span className="font-body text-xs text-steel">{status.text}</span>
                </span>

                <div className="flex items-center gap-2 w-full justify-center mt-1">
                  <select
                    value={member.clientTier ?? ""}
                    onChange={(e) => handleTierChange(member, (e.target.value || null) as ClientTier)}
                    className="h-7 bg-graphite border border-steel/30 text-chalk px-1.5 font-body text-xs"
                  >
                    <option value="">No tier</option>
                    <option value="one_on_one">1-on-1</option>
                    <option value="online">Online</option>
                    <option value="group">Group</option>
                  </select>
                  <span className="font-body text-xs text-steel whitespace-nowrap">{credits} credits</span>
                </div>

                <div className="relative flex items-center justify-center gap-3 w-full pt-2 mt-1 border-t border-steel/15">
                  <Link
                    href={`/groups/${groupId}/athletes/${member.profileId}/log`}
                    className="font-body text-xs text-rust"
                  >
                    Log
                  </Link>
                  <button
                    type="button"
                    onClick={() => handleRemove(member)}
                    disabled={busy}
                    className="font-body text-xs text-steel active:text-rust transition-colors disabled:opacity-40"
                  >
                    Remove
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpenMenuId((id) => (id === member.profileId ? null : member.profileId))}
                    disabled={busy}
                    aria-label="More actions"
                    className="text-steel active:text-rust transition-colors disabled:opacity-40"
                  >
                    <MoreVertical className="w-3.5 h-3.5" />
                  </button>

                  {openMenuId === member.profileId && (
                    <div className="absolute right-0 bottom-full mb-1 bg-surface border border-steel/30 z-10 shadow-lg">
                      <button
                        type="button"
                        onClick={() => {
                          setOpenMenuId(null);
                          handleRoleToggle(member);
                        }}
                        disabled={busy}
                        className="whitespace-nowrap px-3 py-2 font-body text-xs text-chalk hover:bg-graphite/50 disabled:opacity-40"
                      >
                        {member.role === "coach" ? "Make athlete" : "Make coach"}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
