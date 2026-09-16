"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { CardSizeToggle } from "@/components/coach/desktop/card-size-toggle";
import { readCardSize, writeCardSize, type CardSize } from "@/lib/card-size";
import { isLowReadiness } from "@/lib/wellness";
import { daysSinceOf, clientActivityStatus } from "@/lib/client-activity-status";
import { initialsOf } from "@/lib/initials";
import { getIntegrityRollupForGroup, type AthleteIntegrityResult } from "@/lib/session-integrity-data";
import type { RosterMember, ClientTier } from "@/lib/types";
import { MoreVertical, ChevronLeft, ChevronRight } from "lucide-react";
import {
  computeNutritionWeeklySeries,
  type NutritionPhase,
  type NutritionWeeklySeries,
} from "@/lib/nutrition-trend-classifier";
import { ClientCardNutritionSparkline } from "@/components/coach/desktop/client-card-nutrition-sparkline";

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

const GOAL_LABELS: Record<NonNullable<NutritionPhase>, string> = {
  reverse_diet: "Reverse diet",
  cut: "Cut",
  bulk: "Bulk",
};

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
  positions = [],
}: {
  groupId: string;
  members: RosterMember[];
  // team_sports_expansion_scoping.md — a football/team roster is
  // 40-100+ athletes, where scanning card-by-card for one player or
  // scrolling to bulk-manage a whole position group stops working.
  // Empty for any non-team-mode group (the page never fetches it) —
  // the filter/search stay exactly as useful as before for those.
  positions?: { id: string; name: string }[];
}) {
  const [rows, setRows] = useState(members);
  const [error, setError] = useState<string | null>(null);
  // "Make coach" is a rare, higher-consequence action — tucked behind a
  // small overflow menu per card instead of sitting in the front-row
  // action bar next to Log/Remove, per direct feedback that it didn't
  // need to be front-and-center.
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>("attention");
  const [tierFilter, setTierFilter] = useState<ClientTier | "all">("all");
  const [goalFilter, setGoalFilter] = useState<NutritionPhase | "all">("all");
  const [positionFilter, setPositionFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [size, setSize] = useState<CardSize>("medium");
  const [page, setPage] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkTier, setBulkTier] = useState<ClientTier>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
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
  // Milestone Celebrations, Category 2 — the trend-line sparkline itself
  // needs the underlying macro/weight time series (heavier than a plain
  // phase tag), so it's fetched here client-side, scoped to just the
  // currently-visible page's TAGGED athletes — same cost discipline as
  // credits/wellness/integrity above.
  const [nutritionSeriesByAthleteId, setNutritionSeriesByAthleteId] = useState<
    Map<string, NutritionWeeklySeries>
  >(new Map());

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

  const trimmedSearch = search.trim().toLowerCase();
  const filteredRows = rows
    .filter((m) => tierFilter === "all" || m.clientTier === tierFilter)
    .filter((m) => goalFilter === "all" || m.nutritionPhase === goalFilter)
    .filter((m) => positionFilter === "all" || m.positionId === positionFilter)
    .filter((m) => !trimmedSearch || m.fullName.toLowerCase().includes(trimmedSearch));

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
  const taggedPageIdsKey = pageRows
    .filter((m) => m.nutritionPhase)
    .map((m) => m.profileId)
    .join(",");

  // Sort/filter changing the composition of "what page 0 even means"
  // resets back to the first page rather than leaving the viewer on a
  // now-mismatched page number.
  useEffect(() => {
    setPage(0);
  }, [sortMode, tierFilter, goalFilter, positionFilter, trimmedSearch]);

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

  // Milestone Celebrations, Category 2 sparkline — a separate, smaller
  // fetch scoped to just this page's TAGGED athletes (usually a small
  // subset of the page, often zero), since the underlying six-week
  // macro/weight series is heavier than the plain phase tag already on
  // `rows`.
  useEffect(() => {
    let cancelled = false;
    async function run() {
      const taggedIds = taggedPageIdsKey ? taggedPageIdsKey.split(",") : [];
      if (taggedIds.length === 0) {
        setNutritionSeriesByAthleteId(new Map());
        return;
      }
      const sixWeeksAgo = new Date();
      sixWeeksAgo.setDate(sixWeeksAgo.getDate() - 42);
      const supabase = createBrowserClient();
      const [macroResult, weightResult] = await Promise.all([
        supabase
          .from("daily_macros")
          .select("athlete_id, log_date, calories")
          .eq("group_id", groupId)
          .in("athlete_id", taggedIds)
          .gte("log_date", sixWeeksAgo.toISOString().slice(0, 10)),
        supabase
          .from("body_weight_logs")
          .select("athlete_id, logged_date, weight")
          .eq("group_id", groupId)
          .in("athlete_id", taggedIds)
          .gte("logged_date", sixWeeksAgo.toISOString().slice(0, 10)),
      ]);
      if (cancelled) return;

      const calorieRowsByAthlete = new Map<string, { date: string; value: number }[]>();
      for (const row of macroResult.data ?? []) {
        if (row.calories == null) continue;
        const list = calorieRowsByAthlete.get(row.athlete_id) ?? [];
        list.push({ date: row.log_date, value: row.calories });
        calorieRowsByAthlete.set(row.athlete_id, list);
      }
      const weightRowsByAthlete = new Map<string, { date: string; value: number }[]>();
      for (const row of weightResult.data ?? []) {
        const list = weightRowsByAthlete.get(row.athlete_id) ?? [];
        list.push({ date: row.logged_date, value: row.weight });
        weightRowsByAthlete.set(row.athlete_id, list);
      }

      const series = new Map<string, NutritionWeeklySeries>();
      const now = new Date();
      for (const athleteId of taggedIds) {
        series.set(
          athleteId,
          computeNutritionWeeklySeries(
            calorieRowsByAthlete.get(athleteId) ?? [],
            weightRowsByAthlete.get(athleteId) ?? [],
            now
          )
        );
      }
      setNutritionSeriesByAthleteId(series);
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [groupId, taggedPageIdsKey]);

  function handleTierChange(member: RosterMember, tier: ClientTier) {
    setRows((prev) =>
      prev.map((m) => (m.profileId === member.profileId ? { ...m, clientTier: tier } : m))
    );
    const supabase = createBrowserClient();
    supabase
      .from("group_memberships")
      .update({ client_tier: tier })
      .eq("group_id", groupId)
      .eq("profile_id", member.profileId)
      .then(() => router.refresh());
  }

  function handleRoleToggle(member: RosterMember) {
    if (member.role === "coach" && isOnlyCoach) {
      setError("A group needs at least one coach.");
      return;
    }
    setError(null);
    const nextRole = member.role === "coach" ? "athlete" : "coach";
    // Flip the row's role instantly — the mutation confirms in the
    // background instead of the label waiting on a full page refresh.
    setRows((prev) =>
      prev.map((m) => (m.profileId === member.profileId ? { ...m, role: nextRole } : m))
    );

    const supabase = createBrowserClient();
    supabase
      .from("group_memberships")
      .update({ role: nextRole })
      .eq("group_id", groupId)
      .eq("profile_id", member.profileId)
      .then(({ error: updateError }) => {
        if (updateError) {
          setRows((prev) =>
            prev.map((m) => (m.profileId === member.profileId ? { ...m, role: member.role } : m))
          );
          setError("Couldn't update role.");
          return;
        }
        router.refresh();
      });
  }

  function handleRemove(member: RosterMember) {
    if (member.role === "coach" && isOnlyCoach) {
      setError("A group needs at least one coach.");
      return;
    }
    if (!window.confirm(`Remove ${member.fullName} from the group?`)) return;

    setError(null);
    // Drop the card immediately rather than waiting for the delete + a
    // full page refresh before it disappears.
    setRows((prev) => prev.filter((m) => m.profileId !== member.profileId));

    const supabase = createBrowserClient();
    supabase
      .from("group_memberships")
      .delete()
      .eq("group_id", groupId)
      .eq("profile_id", member.profileId)
      .then(({ error: deleteError }) => {
        if (deleteError) {
          setRows((prev) => {
            if (prev.some((m) => m.profileId === member.profileId)) return prev;
            return [...prev, member];
          });
          setError("Couldn't remove member.");
          return;
        }
        router.refresh();
      });
  }

  function toggleSelected(profileId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(profileId)) next.delete(profileId);
      else next.add(profileId);
      return next;
    });
  }

  const pageSelectedCount = pageRows.filter((m) => selectedIds.has(m.profileId)).length;
  const allPageSelected = pageRows.length > 0 && pageSelectedCount === pageRows.length;

  function toggleSelectAllOnPage() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allPageSelected) {
        for (const m of pageRows) next.delete(m.profileId);
      } else {
        for (const m of pageRows) next.add(m.profileId);
      }
      return next;
    });
  }

  // team_sports_expansion_scoping.md — the actual reason bulk-select
  // earns its keep at 40-100+ athletes: setting a whole position group's
  // tier, or clearing out a batch of former roster members, one card at
  // a time doesn't scale. Reuses the exact same write each per-card
  // action already makes, just looped across the selection.
  async function handleBulkSetTier() {
    if (selectedIds.size === 0 || bulkBusy) return;
    setBulkBusy(true);
    const ids = [...selectedIds];
    setRows((prev) => prev.map((m) => (selectedIds.has(m.profileId) ? { ...m, clientTier: bulkTier } : m)));
    const supabase = createBrowserClient();
    const { error: updateError } = await supabase
      .from("group_memberships")
      .update({ client_tier: bulkTier })
      .eq("group_id", groupId)
      .in("profile_id", ids);
    setBulkBusy(false);
    if (updateError) {
      setError("Couldn't update tier for the selected athletes.");
      return;
    }
    setSelectedIds(new Set());
    router.refresh();
  }

  async function handleBulkRemove() {
    if (selectedIds.size === 0 || bulkBusy) return;
    const targets = rows.filter((m) => selectedIds.has(m.profileId));
    if (targets.some((m) => m.role === "coach") && isOnlyCoach) {
      setError("A group needs at least one coach — deselect the coach before removing.");
      return;
    }
    if (!window.confirm(`Remove ${targets.length} selected ${targets.length === 1 ? "athlete" : "athletes"} from the group?`)) {
      return;
    }
    setBulkBusy(true);
    const ids = [...selectedIds];
    setRows((prev) => prev.filter((m) => !selectedIds.has(m.profileId)));
    const supabase = createBrowserClient();
    const { error: deleteError } = await supabase
      .from("group_memberships")
      .delete()
      .eq("group_id", groupId)
      .in("profile_id", ids);
    setBulkBusy(false);
    if (deleteError) {
      setError("Couldn't remove the selected athletes.");
      setRows(members);
      return;
    }
    setSelectedIds(new Set());
    router.refresh();
  }

  return (
    <div>
      {error && <p className="font-body text-sm text-rust mb-3">{error}</p>}

      <div className="mb-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name…"
          className="h-9 w-64 bg-graphite border border-steel/30 text-chalk px-3 font-body text-sm focus:outline-none focus:border-rust"
        />
      </div>

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

      {rows.some((m) => m.nutritionPhase) && (
        <div className="flex items-center gap-2 mb-4">
          <span className="font-body text-xs text-steel uppercase tracking-wide">Goal</span>
          {(["all", "reverse_diet", "cut", "bulk"] as const).map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setGoalFilter(g)}
              className={`font-body text-xs px-2 py-1 border ${
                goalFilter === g ? "text-rust border-rust" : "text-steel border-steel/30"
              }`}
            >
              {g === "all" ? "All" : GOAL_LABELS[g]}
            </button>
          ))}
        </div>
      )}

      {positions.length > 0 && (
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <span className="font-body text-xs text-steel uppercase tracking-wide">Position</span>
          <button
            type="button"
            onClick={() => setPositionFilter("all")}
            className={`font-body text-xs px-2 py-1 border ${
              positionFilter === "all" ? "text-rust border-rust" : "text-steel border-steel/30"
            }`}
          >
            All
          </button>
          {positions.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPositionFilter(p.id)}
              className={`font-body text-xs px-2 py-1 border ${
                positionFilter === p.id ? "text-rust border-rust" : "text-steel border-steel/30"
              }`}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}

      {pageRows.length > 0 && (
        <div className="flex items-center justify-between gap-3 mb-3 pb-3 border-b border-steel/15">
          <label className="flex items-center gap-2 font-body text-xs text-steel">
            <input
              type="checkbox"
              checked={allPageSelected}
              onChange={toggleSelectAllOnPage}
              className="accent-rust"
            />
            Select all on this page
          </label>

          {selectedIds.size > 0 && (
            <div className="flex items-center gap-2">
              <span className="font-body text-xs text-steel">{selectedIds.size} selected</span>
              <select
                value={bulkTier ?? ""}
                onChange={(e) => setBulkTier((e.target.value || null) as ClientTier)}
                className="h-8 bg-graphite border border-steel/30 text-chalk px-2 font-body text-xs"
              >
                <option value="">No tier</option>
                <option value="one_on_one">1-on-1</option>
                <option value="online">Online</option>
                <option value="group">Group</option>
              </select>
              <button
                type="button"
                onClick={handleBulkSetTier}
                disabled={bulkBusy}
                className="h-8 px-3 bg-rust text-graphite font-body text-xs font-medium disabled:opacity-40"
              >
                Set tier
              </button>
              <button
                type="button"
                onClick={handleBulkRemove}
                disabled={bulkBusy}
                className="h-8 px-3 border border-steel/30 text-steel font-body text-xs disabled:opacity-40"
              >
                Remove selected
              </button>
            </div>
          )}
        </div>
      )}

      {sortedRows.length === 0 ? (
        <p className="font-body text-sm text-steel py-6">
          No athletes yet. Send an invite to get the first one training.
        </p>
      ) : (
        <div className={`grid ${GRID_CLASS[size]}`}>
          {pageRows.map((member) => {
            const status = clientActivityStatus(member.lastWorkoutAt);
            const credits = creditsByAthleteId.get(member.profileId) ?? 0;
            return (
              <div
                key={member.profileId}
                className="relative border border-steel/20 bg-surface/40 rounded-token-lg p-4 flex flex-col items-center text-center gap-2"
              >
                <input
                  type="checkbox"
                  checked={selectedIds.has(member.profileId)}
                  onChange={() => toggleSelected(member.profileId)}
                  aria-label={`Select ${member.fullName}`}
                  className="absolute top-2 left-2 accent-rust"
                />
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
                  {member.positionName && (
                    <span className="font-body text-[11px] text-steel -mt-1.5">{member.positionName}</span>
                  )}
                </Link>

                <span className="flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full ${status.dotClass}`} />
                  <span className="font-body text-xs text-steel">{status.text}</span>
                </span>

                {lowReadinessAthleteIds?.has(member.profileId) && (
                  <span className="font-body text-[11px] text-amber-400 bg-amber-400/10 border border-amber-400/30 rounded-token-pill px-1.5 py-0.5">
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
                      className="font-body text-[11px] text-rust bg-rust/10 border border-rust/40 rounded-token-pill px-1.5 py-0.5"
                    >
                      ⏱ Fast sessions ({integrity.flaggedCount})
                    </span>
                  ) : (
                    <span
                      title="One recent session was logged faster than the prescribed sets/rest would realistically take"
                      className="font-body text-[11px] text-steel bg-steel/10 border border-steel/30 rounded-token-pill px-1.5 py-0.5"
                    >
                      ⏱ Fast session
                    </span>
                  );
                })()}

                {member.nutritionPhase && nutritionSeriesByAthleteId.has(member.profileId) && (
                  <ClientCardNutritionSparkline
                    phase={member.nutritionPhase}
                    series={nutritionSeriesByAthleteId.get(member.profileId)!}
                  />
                )}

                <div className="flex items-center gap-2 w-full justify-center mt-1">
                  <select
                    value={member.clientTier ?? ""}
                    onChange={(e) => handleTierChange(member, (e.target.value || null) as ClientTier)}
                    className="h-7 bg-graphite border border-steel/30 rounded-token-sm text-chalk px-1.5 font-body text-xs"
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
                    className="font-body text-xs text-steel active:text-rust transition-colors disabled:opacity-40"
                  >
                    Remove
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpenMenuId((id) => (id === member.profileId ? null : member.profileId))}
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
