"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { BottomTabBar } from "@/components/athlete/bottom-tab-bar";
import { CoachMoreDrawer } from "./coach-more-drawer";
import { SpotTriggerButton } from "./spot-trigger-button";

// Owns the "More" drawer's open-tiles counter — the only reason this
// needs to be a client component at all — so the actual Home content
// (coach-mobile-home.tsx) can stay a plain server component fetching
// real data, same split used throughout this app between data-fetching
// pages and small interactive wrappers.
//
// the_spot_dropdown_widget_redesign_sept16.md — mounting the Spot here,
// not on any one page, is what makes it genuinely global ("it doesn't
// matter if you're logging a workout or in your profile or whatever
// you're doing") rather than screen-gated like the old View-as-Client
// button was (coach-mobile-home.tsx's header, Home only). "REVISED
// 2026-09-19": one SpotTriggerButton now covers what used to be two
// separate mounted pieces (the business-glance dropdown and the NL-
// builder sheet) — SpotPanel's own swipeable structure holds both now.
// This is the existing quick-entry/NL program builder, explicitly
// untouched by the "More" drawer work below
// (mobile_more_tab_condensed_widget_hub_sept30.md) — it keeps working
// exactly as it already does.
//
// CoachMoreDrawer replaces the old CoachMoreSheet here — a Samsung
// Edge-Panel-style drawer (same mechanics as the desktop Ask Spot tab,
// which this absorbs as one of its tiles) instead of a left-side sheet.
// It's always mounted (not conditionally, like the old sheet) since its
// own collapsed "tab" state is a persistent, always-reachable UI
// element, not something that only exists while open.
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
  const [moreOpenSignal, setMoreOpenSignal] = useState(0);
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
      <SpotTriggerButton
        key={spotBuilderAthleteId ?? "none"}
        groupId={groupId}
        initialAthleteId={spotBuilderAthleteId}
        initialAthleteName={spotBuilderAthleteName}
      />
      <CoachMoreDrawer groupId={groupId} groupName={groupName} openSignal={moreOpenSignal} />
      <BottomTabBar
        groupId={groupId}
        variant="coach"
        activeOverride={activeOverride}
        onMoreClick={() => setMoreOpenSignal((v) => v + 1)}
      />
    </>
  );
}
