"use client";

import { useState } from "react";
import { sortPulseFirst } from "@/lib/pulse-sort";
import { RosterSection } from "@/components/coach/desktop/roster-section";
import { HomeClientCard, type HomeClientCardData } from "@/components/coach/desktop/home-client-card";
import { HomeGroupCard, type HomeGroupCardData } from "@/components/coach/desktop/home-group-card";
import { TeamPulseCard } from "@/components/coach/desktop/team-pulse-card";
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
  const [tab, setTab] = useState<"clients" | "groups">("clients");

  // "Notification-worthy" for a client: an unseen-activity dot, or a
  // quiet-tier flag — the two signals HomeClientCard already renders.
  // Not just "logged today" — that's the opposite of what needs a
  // coach's attention.
  const sortedClients = sortPulseFirst(clientCards, (c) => c.hasUnseenActivity || !!c.quietTier);
  const clientAttentionCount = clientCards.filter((c) => !!c.quietTier).length;

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
          Client Pulse
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
        {tab === "clients" ? (
          <RosterSection
            title="1-on-1 Clients"
            summary={
              clientCards.length === 0
                ? "No clients yet"
                : `${clientCards.length} client${clientCards.length === 1 ? "" : "s"}`
            }
            needsAttentionCount={clientAttentionCount}
            defaultExpanded
          >
            {sortedClients.length === 0 ? (
              <p className="font-body text-sm text-steel">No 1-on-1 clients yet.</p>
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
