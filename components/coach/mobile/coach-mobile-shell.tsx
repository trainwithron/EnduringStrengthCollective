"use client";

import { useSearchParams } from "next/navigation";
import { BottomTabBar } from "@/components/athlete/bottom-tab-bar";
import { CoachSpotHub } from "./coach-spot-hub";
import { TerminologyProvider } from "@/components/coach/terminology-provider";

// Mobile coach chrome: the Spotlight hub (top-center button: Clients, Messages, Business, Program, Ask Spot) and the coach's OWN app's five tabs at the bottom (Release 2: the phone is the coach's own
// account; Ron: "the only difference will be that I have the spot button up top"). Mounted by the coach pages that render the mobile experience directly; CoachDesktopShell mounts the same two
// pieces for every other coach page at phone widths. `homeHref`: the team Home keeps Home on itself (a team-sport coach keeps their team Home).
export function CoachMobileShell({
  groupId,
  groupName,
  activeOverride = null,
  homeHref,
  children,
}: {
  groupId: string;
  groupName: string;
  // Which of the five tabs this page is (most coach pages are none of them).
  activeOverride?: "home" | "calendar" | "feed" | "nutrition" | "settings" | null;
  homeHref?: string;
  children: React.ReactNode;
}) {
  // Fast entry path for the NL builder (from a specific client's own
  // row/profile, e.g. Clients page's "Build with AI" action) — a plain
  // query param, read once here rather than needing every page that
  // might link in to also thread props through this shell.
  const searchParams = useSearchParams();
  const spotBuilderAthleteId = searchParams.get("spotBuilder");
  const spotBuilderAthleteName = searchParams.get("spotBuilderName");

  return (
    <TerminologyProvider groupId={groupId}>
      {children}
      <CoachSpotHub
        key={spotBuilderAthleteId ?? "none"}
        groupId={groupId}
        initialAthleteId={spotBuilderAthleteId}
        initialAthleteName={spotBuilderAthleteName}
      />
      <BottomTabBar groupId={groupId} variant="own" activeOverride={activeOverride} homeHref={homeHref} />
    </TerminologyProvider>
  );
}
