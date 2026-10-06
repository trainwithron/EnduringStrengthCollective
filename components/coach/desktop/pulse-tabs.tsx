"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createBrowserClient } from "@/lib/supabase/client";
import { QUIET_SNOOZE_DAYS, QUIET_SNOOZE_KIND, quietSnoozeKey, snoozedQuietKeys } from "@/lib/quiet-snooze";
import { sortPulseFirst } from "@/lib/pulse-sort";
import { RosterSection } from "@/components/coach/desktop/roster-section";
import { HomeClientCard, type HomeClientCardData } from "@/components/coach/desktop/home-client-card";
import { HomeGroupCard, type HomeGroupCardData } from "@/components/coach/desktop/home-group-card";
import { TeamPulseCard } from "@/components/coach/desktop/team-pulse-card";
import { SwappableTerm } from "@/components/coach/swappable-term";
import { useTerm } from "@/components/coach/terminology-provider";
import type { TeamPulseResult } from "@/lib/dashboard-data";

// Replaces the old team-mode-only side column (home_dashboard_merge_and_
// pulse_tabs_redesign.md) — every relationship type now gets the same
// pulse treatment, not just team-kind groups. Two tabs instead of one
// mixed list: a 1-on-1 client and a group aren't the same kind of card,
// and a coach with a lot of one but not much of the other shouldn't have
// to scroll past a wall of the wrong kind to find what they're looking
// for.
export function PulseTabs({
  clientCards,
  teamPulses,
  teamCards,
  socialCards,
}: {
  clientCards: HomeClientCardData[];
  teamPulses: TeamPulseResult[];
  teamCards: HomeGroupCardData[];
  socialCards: HomeGroupCardData[];
}) {
  const t = useTerm();
  const [tab, setTab] = useState<"clients" | "groups">("clients");
  // Quiet-client flags the coach has snoozed (a week). Loaded after the page shows; if it cannot load, nothing is hidden.
  const [snoozed, setSnoozed] = useState<Set<string>>(new Set());
  const [attentionOpen, setAttentionOpen] = useState(false);
  const [coachId, setCoachId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const supabase = createBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      if (!cancelled) setCoachId(user.id);
      const { data } = await supabase
        .from("spotter_recommendation_feedback")
        .select("dismissal_key, created_at")
        .eq("coach_id", user.id)
        .eq("spotter_kind", QUIET_SNOOZE_KIND)
        .order("created_at", { ascending: false })
        .limit(1000);
      if (!cancelled) setSnoozed(snoozedQuietKeys((data ?? []) as { dismissal_key: string; created_at: string }[], new Date()));
    }
    load().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  async function snooze(list: HomeClientCardData[]) {
    if (!coachId || list.length === 0) return;
    setBusy(true);
    const supabase = createBrowserClient();
    const { error } = await supabase.from("spotter_recommendation_feedback").insert(
      list.map((c) => ({
        coach_id: coachId,
        spotter_kind: QUIET_SNOOZE_KIND,
        dismissal_key: quietSnoozeKey(c.athleteId, c.groupId),
        option_summary: `${c.fullName}: quiet client, snoozed ${QUIET_SNOOZE_DAYS} days`,
        action: "denied",
      }))
    );
    setBusy(false);
    if (error) return;
    setSnoozed((prev) => {
      const next = new Set(prev);
      for (const c of list) next.add(quietSnoozeKey(c.athleteId, c.groupId));
      return next;
    });
  }

  // "Notification-worthy" for a client: an unseen-activity dot, or a
  // quiet-tier flag — the two signals HomeClientCard already renders.
  // Not just "logged today" — that's the opposite of what needs a
  // coach's attention.
  // A snoozed client is not flagged for a week: no flag on the card, and not in the attention list or its count.
  const isSnoozed = (c: HomeClientCardData) => snoozed.has(quietSnoozeKey(c.athleteId, c.groupId));
  const visibleClients = clientCards.map((c) => (c.quietTier && isSnoozed(c) ? { ...c, quietTier: undefined } : c));
  const sortedClients = sortPulseFirst(visibleClients, (c) => c.hasUnseenActivity || !!c.quietTier);
  const attentionClients = visibleClients.filter((c) => !!c.quietTier);
  const clientAttentionCount = attentionClients.length;

  const groupCards = [...teamCards, ...socialCards];
  const sortedGroups = sortPulseFirst(groupCards, (g) => g.hasUnseenActivity);
  const groupAttentionCount = groupCards.filter((g) => g.hasUnseenActivity).length;

  return (
    <div className="border border-steel/30 bg-surface">
      <div className="flex border-b border-steel/20">
        <button
          type="button"
          onClick={() => setTab("clients")}
          className={`flex-1 font-display uppercase text-xs tracking-wide py-3 transition-colors ${
            tab === "clients" ? "text-chalk border-b-2 border-rust" : "text-steel"
          }`}
        >
          <SwappableTerm termKey="client" cap /> Pulse
          {clientAttentionCount > 0 && (
            <span className="ml-1.5 text-rust">({clientAttentionCount})</span>
          )}
        </button>
        <button
          type="button"
          onClick={() => setTab("groups")}
          className={`flex-1 font-display uppercase text-xs tracking-wide py-3 transition-colors ${
            tab === "groups" ? "text-chalk border-b-2 border-rust" : "text-steel"
          }`}
        >
          Group Pulse
          {groupAttentionCount > 0 && (
            <span className="ml-1.5 text-rust">({groupAttentionCount})</span>
          )}
        </button>
      </div>

      <div className="p-3">
        {tab === "clients" && clientAttentionCount > 0 && (
          <div className="mb-3 border border-rust/30 bg-rust/5">
            {/* Collapsed to a count until opened, so a long list never takes over Home. Each client can be snoozed for a week, or all at once. */}
            <div className="flex items-center justify-between gap-3 px-3 py-2">
              <button
                type="button"
                onClick={() => setAttentionOpen((o) => !o)}
                aria-expanded={attentionOpen}
                className="flex items-center gap-2 min-h-[32px] font-body text-sm text-chalk"
              >
                <span aria-hidden="true">{attentionOpen ? "▾" : "▸"}</span>
                {clientAttentionCount} {clientAttentionCount === 1 ? "needs" : "need"} attention
              </button>
              {attentionOpen && clientAttentionCount > 1 && (
                <button
                  type="button"
                  onClick={() => snooze(attentionClients)}
                  disabled={busy || !coachId}
                  className="font-body text-xs text-steel underline underline-offset-2 disabled:opacity-40"
                >
                  {busy ? "Clearing…" : `Clear all for ${QUIET_SNOOZE_DAYS} days`}
                </button>
              )}
            </div>
            {attentionOpen && (
              <ul className="divide-y divide-steel/15 border-t border-steel/15 px-3 max-h-72 overflow-y-auto">
                {attentionClients.map((c) => (
                  <li key={c.athleteId + c.groupId} className="py-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <Link href={`/groups/${c.groupId}/athletes/${c.athleteId}`} className="font-body text-sm text-chalk hover:text-rust flex-1 min-w-[8rem] truncate">
                      {c.fullName}
                    </Link>
                    <span className="font-body text-xs text-steel">{c.quietTier === "strong" ? "Quiet a while" : "Missing scheduled sessions"}</span>
                    <button
                      type="button"
                      onClick={() => snooze([c])}
                      disabled={busy || !coachId}
                      className="h-8 px-3 border border-steel/30 text-steel font-body text-xs disabled:opacity-40"
                    >
                      Snooze {QUIET_SNOOZE_DAYS} days
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {tab === "clients" ? (
          <RosterSection
            title={`1-on-1 ${t("client", "plural", { cap: true })}`}
            summary={
              clientCards.length === 0
                ? `No ${t("client", "plural")} yet`
                : `${clientCards.length} ${t("client", clientCards.length === 1 ? "singular" : "plural")}`
            }
            needsAttentionCount={clientAttentionCount}
            defaultExpanded={clientCards.length <= 6}
          >
            {sortedClients.length === 0 ? (
              <p className="font-body text-sm text-steel">No 1-on-1 {t("client", "plural")} yet.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {sortedClients.map((c) => (
                  <HomeClientCard key={c.athleteId} client={c} />
                ))}
              </div>
            )}
          </RosterSection>
        ) : (
          <div className="space-y-3">
            {teamPulses.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {teamPulses.map((team) => (
                  <TeamPulseCard key={team.groupId} team={team} />
                ))}
              </div>
            )}
            <RosterSection
              title="Groups"
              summary={
                groupCards.length === 0
                  ? "No groups yet"
                  : `${groupCards.length} group${groupCards.length === 1 ? "" : "s"}`
              }
              needsAttentionCount={groupAttentionCount}
              defaultExpanded
            >
              {sortedGroups.length === 0 ? (
                <p className="font-body text-sm text-steel">No groups yet.</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {sortedGroups.map((g) => (
                    <HomeGroupCard key={g.id} group={g} />
                  ))}
                </div>
              )}
            </RosterSection>
          </div>
        )}
      </div>
    </div>
  );
}
