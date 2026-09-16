"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { BottomTabBar } from "@/components/athlete/bottom-tab-bar";
import { CoachMoreSheet } from "./coach-more-sheet";
import { SpotTriggerButton } from "./spot-trigger-button";
import { SpotNlBuilderSheet } from "./spot-nl-builder-sheet";

// Owns the "More" sheet's open/closed state — the only reason this needs
// to be a client component at all — so the actual Home content
// (coach-mobile-home.tsx) can stay a plain server component fetching
// real data, same split used throughout this app between data-fetching
// pages and small interactive wrappers.
//
// the_spot_dropdown_widget_redesign_sept16.md — mounting both Spot entry
// points here, not on any one page, is what makes them genuinely global
// ("it doesn't matter if you're logging a workout or in your profile or
// whatever you're doing") rather than screen-gated like the old View-as-
// Client button was (coach-mobile-home.tsx's header, Home only).
export function CoachMobileShell({
  groupId,
  groupName,
  activeOverride = "home",
  children,
}: {
  groupId: string;
  groupName: string;
  activeOverride?: "home" | "roster" | "messages" | "calendar";
  children: React.ReactNode;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  // Fast entry path #1 for the NL builder (from a specific client's own
  // row/profile, e.g. Clients page's "Build with AI" action) — a plain
  // query param, read once here rather than needing every page that
  // might link in to also thread props through this shell.
  const searchParams = useSearchParams();
  const spotBuilderAthleteId = searchParams.get("spotBuilder");
  const spotBuilderAthleteName = searchParams.get("spotBuilderName");

  return (
    <>
      {children}
      <SpotTriggerButton groupId={groupId} />
      <SpotNlBuilderSheet
        key={spotBuilderAthleteId ?? "none"}
        groupId={groupId}
        initialAthleteId={spotBuilderAthleteId}
        initialAthleteName={spotBuilderAthleteName}
      />
      <BottomTabBar
        groupId={groupId}
        variant="coach"
        activeOverride={activeOverride}
        onMoreClick={() => setMoreOpen(true)}
      />
      {moreOpen && <CoachMoreSheet groupId={groupId} groupName={groupName} onClose={() => setMoreOpen(false)} />}
    </>
  );
}
