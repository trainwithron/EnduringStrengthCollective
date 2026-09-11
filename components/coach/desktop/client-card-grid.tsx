"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { CardSizeToggle } from "@/components/coach/desktop/card-size-toggle";
import { readCardSize, writeCardSize, type CardSize } from "@/lib/card-size";
import { isLowReadiness } from "@/lib/wellness";
import { getIntegrityRollupForGroup, type AthleteIntegrityResult } from "@/lib/session-integrity-data";
import type { RosterMember, ClientTier } from "@/lib/types";
import { MoreVertical, ChevronLeft, ChevronRight } from "lucide-react";

// A real page of cards, not the whole roster — a stress-test pass found
// the old unpaginated page taking 18.5s and shipping 1.1MB at 500
// athletes, with every card's credits/wellness/integrity precomputed and
// rendered into the DOM at once regardless of roster size.
const PAGE_SIZE = 40;

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

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
    .map((p) => Array.from(p)[0] ?? "")
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
}: {
  groupId: string;
  members: RosterMember[];
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
  const [page, setPage] = useState(0);
  const router = useRouter();

  // Credits/wellness/integrity are each a heavier per-athlete lookup
  // (integrity especially — a session/set join) that used to be
  // precomputed server-side for the ENTIRE roster on every page load.
  // Fetched here instead, client-side, scoped to just the athlete ids on
  // the currently-visible PAGE — the actual fix for the stress-test
  // finding, not just a rendering optimization.
  const [creditsByAthleteId, setCreditsByAthleteId] = useState<Map<string, number>>(new Map());
  const [lowReadinessAthleteIds, setLowReadinessAthleteIds] = useState<Set<string>>(new Set());
  const [integrityByAthleteId, setIntegrityByAthleteId] = useState<Map<string, AthleteIntegrityResult>>(
    new Map()
  );

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

  const sortedRows = useMemo(
    () =>
      [...filteredRows].sort((a, b) => {
        if (sortMode === "name") return a.fullName.localeCompare(b.fullName);
        return daysSinceOf(b.lastWorkoutAt) - daysSinceOf(a.lastWorkoutAt);
      }),
    [filteredRows, sortMode]
  );

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE));
  const clampedPage = Math.min(page, totalPages - 1);
  const pageRows = sortedRows.slice(clampedPage * PAGE_SIZE, (clampedPage + 1) * PAGE_SIZE);
  const pageIdsKey = pageRows.map((m) => m.profileId).join(",");

  // Sort/filter changing the composition of "what page 0 even means"
  // resets back to the first page rather than leaving the viewer on a
  // now-mismatched page number.
  useEffect(() => {
    setPage(0);
  }, [sortMode, tierFilter]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const pageIds = pageIdsKey ? pageIdsKey.split(",") : [];
      if (pageIds.length === 0) {
        setCreditsByAthleteId(new Map());
        setLowReadinessAthleteIds(new Set());
        setIntegrityByAthleteId(new Map());
        return;
      }
      const supabase = createBrowserClient();
      const [creditsResult, wellnessResult, integrityResult] = await Promise.all([
        supabase
          .from("session_credits")
          .select("athlete_id, balance")
          .eq("group_id", groupId)
          .in("athlete_id", pageIds),
        supabase
          .from("wellness_checkins")
          .select("athlete_id, sleep_quality, soreness, energy")
          .eq("group_id", groupId)
          .eq("log_date", todayIso())
          .in("athlete_id", pageIds),
        getIntegrityRollupForGroup(supabase, groupId, pageIds),
      ]);
      if (cancelled) return;

      const credits = new Map<string, number>();
      for (const row of creditsResult.data ?? []) {
        credits.set(row.athlete_id, row.balance);
      }
      setCreditsByAthleteId(credits);

      const lowReadiness = new Set<string>();
      for (const row of wellnessResult.data ?? []) {
        if (isLowReadiness({ sleepQuality: row.sleep_quality, soreness: row.soreness, energy: row.energy })) {
          lowReadiness.add(row.athlete_id);
        }
      }
      setLowReadinessAthleteIds(lowReadiness);

      setIntegrityByAthleteId(integrityResult);
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [groupId, pageIdsKey]);

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
          {pageRows.map((member) => {
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

                {lowReadinessAthleteIds?.has(member.profileId) && (
                  <span className="font-body text-[11px] text-amber-400 bg-amber-400/10 border border-amber-400/30 px-1.5 py-0.5">
                    ⚠ Low readiness
                  </span>
                )}

                {(() => {
                  const integrity = integrityByAthleteId?.get(member.profileId);
                  if (!integrity || integrity.level === "none") return null;
                  // A lone fast session is a quiet, easy-to-dismiss
                  // anomaly (genuinely fast athlete, a partial
                  // coach-logged session) — a repeated pattern is the
                  // real signal worth a conversation, so it gets
                  // stronger visual weight (rust, not just steel/amber),
                  // same escalation shape as the readiness flag above.
                  return integrity.level === "pattern" ? (
                    <span
                      title={`${integrity.flaggedCount} of ${integrity.totalSessions} recent sessions logged implausibly fast`}
                      className="font-body text-[11px] text-rust bg-rust/10 border border-rust/40 px-1.5 py-0.5"
                    >
                      ⏱ Fast sessions ({integrity.flaggedCount})
                    </span>
                  ) : (
                    <span
                      title="One recent session was logged faster than the prescribed sets/rest would realistically take"
                      className="font-body text-[11px] text-steel bg-steel/10 border border-steel/30 px-1.5 py-0.5"
                    >
                      ⏱ Fast session
                    </span>
                  );
                })()}

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

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-4 mt-6 pt-4 border-t border-steel/15">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={clampedPage === 0}
            aria-label="Previous page"
            className="flex items-center gap-1 font-body text-xs text-steel active:text-rust transition-colors disabled:opacity-30"
          >
            <ChevronLeft className="w-4 h-4" />
            Prev
          </button>
          <span className="font-body text-xs text-steel">
            Page {clampedPage + 1} of {totalPages} &middot; {sortedRows.length}{" "}
            {sortedRows.length === 1 ? "client" : "clients"}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={clampedPage >= totalPages - 1}
            aria-label="Next page"
            className="flex items-center gap-1 font-body text-xs text-steel active:text-rust transition-colors disabled:opacity-30"
          >
            Next
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
