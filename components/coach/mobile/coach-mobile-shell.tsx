"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { BottomTabBar } from "@/components/athlete/bottom-tab-bar";
import { CoachMoreSheet } from "./coach-more-sheet";
import { CoachSpotHub } from "./coach-spot-hub";

// Mobile coach chrome: the Spotlight hub (top-center button, the single
// entry for Clients / Business / Calendar / Program / Ask Spot / Quick
// payment) and the bottom tab bar, whose "More" tab opens the plain list
// of pages. Mounted by the coach pages that render the mobile experience
// directly; CoachDesktopShell mounts the same two pieces for every other
// coach page at phone widths, so the hub is on every coach mobile page.
//
// Client component only because it owns the More sheet's open state, so
// the actual Home content (coach-mobile-home.tsx) can stay a plain server
// component fetching real data.
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
  // Fast entry path for the NL builder (from a specific client's own
  // row/profile, e.g. Clients page's "Build with AI" action) — a plain
  // query param, read once here rather than needing every page that
  // might link in to also thread props through this shell.
  const searchParams = useSearchParams();
  const spotBuilderAthleteId = searchParams.get("spotBuilder");
  const spotBuilderAthleteName = searchParams.get("spotBuilderName");

  return (
    <>
      {children}
      <CoachSpotHub
        key={spotBuilderAthleteId ?? "none"}
        groupId={groupId}
        initialAthleteId={spotBuilderAthleteId}
        initialAthleteName={spotBuilderAthleteName}
      />
      {moreOpen && <CoachMoreSheet groupId={groupId} groupName={groupName} onClose={() => setMoreOpen(false)} />}
      <BottomTabBar
        groupId={groupId}
        variant="coach"
        activeOverride={activeOverride}
        onMoreClick={() => setMoreOpen(true)}
      />
    </>
  );
}
