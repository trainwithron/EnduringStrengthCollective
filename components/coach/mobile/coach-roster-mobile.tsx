"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createBrowserClient } from "@/lib/supabase/client";
import { clientActivityStatus } from "@/lib/client-activity-status";
import { computeQuietTier, QUIET_TIER_LABEL, type QuietTier } from "@/lib/quiet-client-tier";
import { initialsOf } from "@/lib/initials";
import { QuickViewBubble } from "./quick-view-bubble";
import type { RosterMember } from "@/lib/types";

// iOS Contacts' sticky-letter-header + right-edge scrubber, layered with
// Discord's "status group first, alphabetical only within a group" sort
// (coach_mobile_v2_feature_spec.md item 1). Replaces the old pinch-zoom
// roster button — browsing (A-Z) and finding are now two entry points
// into the same tap-to-expand interaction (QuickViewBubble, reused
// verbatim per its own header comment), not competing features.
// Mobile-only sibling of desktop's ClientCardGrid, which is untouched —
// same split as coach-mobile-home.tsx vs. the desktop dashboard.
export function CoachRosterMobile({
  groupId,
  members,
}: {
  groupId: string;
  members: RosterMember[];
}) {
  const [trainingDaysByAthleteId, setTrainingDaysByAthleteId] = useState<Map<string, number[] | null>>(
    new Map()
  );

  const athleteIdsKey = members.map((m) => m.profileId).join(",");

  // computeQuietTier needs each athlete's own active program's schedule
  // to normalize against (same input Dashboard/Calendar already fetch
  // for the same function) — one query for the whole visible roster,
  // not per-athlete, same cost discipline as ClientCardGrid's own
  // client-side supplementary fetches.
  useEffect(() => {
    let cancelled = false;
    async function run() {
      const ids = athleteIdsKey ? athleteIdsKey.split(",") : [];
      if (ids.length === 0) {
        setTrainingDaysByAthleteId(new Map());
        return;
      }
      const supabase = createBrowserClient();
      const { data } = await supabase
        .from("programs")
        .select("athlete_id, training_days")
        .eq("group_id", groupId)
        .eq("is_active", true)
        .in("athlete_id", ids);
      if (cancelled) return;
      const map = new Map<string, number[] | null>();
      for (const row of data ?? []) {
        map.set(row.athlete_id, row.training_days ?? null);
      }
      setTrainingDaysByAthleteId(map);
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [groupId, athleteIdsKey]);

  const withTier = useMemo(() => {
    const now = new Date();
    return members.map((m) => ({
      member: m,
      tier: computeQuietTier({
        lastLoggedAt: m.lastWorkoutAt ? new Date(m.lastWorkoutAt) : null,
        now,
        trainingDays: trainingDaysByAthleteId.get(m.profileId) ?? null,
      }),
    }));
  }, [members, trainingDaysByAthleteId]);

  // Needs-attention cluster stays deliberately unsorted-by-letter — just
  // severity-first (strong before mild) — per the spec's own wording.
  // Everything else is the plain A-Z list below it.
  const needsAttention = withTier
    .filter((x) => x.tier !== "none")
    .sort((a, b) => (a.tier === b.tier ? 0 : a.tier === "strong" ? -1 : 1));

  const rest = withTier
    .filter((x) => x.tier === "none")
    .sort((a, b) => a.member.fullName.localeCompare(b.member.fullName));

  const groupedByLetter = useMemo(() => {
    const groups = new Map<string, typeof rest>();
    for (const entry of rest) {
      const first = entry.member.fullName.trim()[0]?.toUpperCase() ?? "#";
      const key = /[A-Z]/.test(first) ? first : "#";
      const list = groups.get(key) ?? [];
      list.push(entry);
      groups.set(key, list);
    }
    return groups;
  }, [rest]);

  const letters = Array.from(groupedByLetter.keys()).sort();

  function scrollToLetter(letter: string) {
    document.getElementById(`roster-letter-${letter}`)?.scrollIntoView({ block: "start" });
  }

  if (members.length === 0) {
    return (
      <p className="font-body text-sm text-steel py-6">
        No athletes yet. Send an invite to get the first one training.
      </p>
    );
  }

  return (
    <div className="relative">
      {needsAttention.length > 0 && (
        <div className="mb-4">
          <p className="font-body text-[11px] text-rust uppercase tracking-wide font-bold px-1 mb-1.5">
            Needs attention
          </p>
          <div className="divide-y divide-steel/15 border border-steel/20 rounded-token-lg overflow-hidden">
            {needsAttention.map(({ member, tier }) => (
              <RosterRow key={member.profileId} groupId={groupId} member={member} tier={tier} />
            ))}
          </div>
        </div>
      )}

      <div className="divide-y divide-steel/15 border border-steel/20 rounded-token-lg overflow-hidden pr-6">
        {letters.map((letter) => (
          <div key={letter} id={`roster-letter-${letter}`}>
            <p className="font-display text-[11px] text-steel uppercase tracking-wide bg-graphite/60 px-3 py-1 sticky top-0">
              {letter}
            </p>
            {groupedByLetter.get(letter)!.map(({ member, tier }) => (
              <RosterRow key={member.profileId} groupId={groupId} member={member} tier={tier} />
            ))}
          </div>
        ))}
      </div>

      {letters.length > 3 && (
        <div className="fixed right-1 top-1/2 -translate-y-1/2 flex flex-col items-center gap-0.5 z-10">
          {letters.map((letter) => (
            <button
              key={letter}
              type="button"
              onClick={() => scrollToLetter(letter)}
              aria-label={`Jump to ${letter}`}
              className="font-body text-[9px] text-steel active:text-rust w-4 h-4 flex items-center justify-center"
            >
              {letter}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function RosterRow({
  groupId,
  member,
  tier,
}: {
  groupId: string;
  member: RosterMember;
  tier: QuietTier;
}) {
  const status = clientActivityStatus(member.lastWorkoutAt);
  return (
    <QuickViewBubble
      title={member.fullName}
      deeperHref={`/groups/${groupId}/athletes/${member.profileId}`}
      deeperLabel="Open full profile"
      trigger={
        <div className="flex items-center gap-3 px-3 py-2.5 active:bg-surface/40">
          {member.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={member.avatarUrl} alt="" className="w-9 h-9 rounded-full object-cover shrink-0" />
          ) : (
            <div className="w-9 h-9 rounded-full bg-graphite border border-steel/30 flex items-center justify-center shrink-0">
              <span className="font-display text-xs text-chalk">{initialsOf(member.fullName)}</span>
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="font-body text-sm text-chalk truncate">{member.fullName}</p>
            <p className="font-body text-xs text-steel flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${status.dotClass}`} />
              {tier !== "none" ? QUIET_TIER_LABEL[tier] : status.text}
            </p>
          </div>
        </div>
      }
    >
      {(close) => (
        <div className="space-y-3">
          <p className="font-display font-bold text-lg uppercase">{member.fullName}</p>
          <p className="font-body text-sm text-steel">
            {tier !== "none" ? QUIET_TIER_LABEL[tier] : status.text}
          </p>
          <div className="flex items-center gap-4 pt-2">
            <Link
              href={`/groups/${groupId}/athletes/${member.profileId}/log`}
              onClick={close}
              className="font-body text-sm text-rust"
            >
              Log a session
            </Link>
            <Link
              href={`/groups/${groupId}/messages/${member.profileId}`}
              onClick={close}
              className="font-body text-sm text-rust"
            >
              Message
            </Link>
            <Link
              href={`/groups/${groupId}/clients?spotBuilder=${member.profileId}&spotBuilderName=${encodeURIComponent(member.fullName)}`}
              onClick={close}
              className="font-body text-sm text-rust"
            >
              Build with AI
            </Link>
          </div>
        </div>
      )}
    </QuickViewBubble>
  );
}
