"use client";

import { useState } from "react";
import { BottomTabBar } from "@/components/athlete/bottom-tab-bar";
import { CoachMoreSheet } from "./coach-more-sheet";

// Owns the "More" sheet's open/closed state — the only reason this needs
// to be a client component at all — so the actual Home content
// (coach-mobile-home.tsx) can stay a plain server component fetching
// real data, same split used throughout this app between data-fetching
// pages and small interactive wrappers.
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

  return (
    <>
      {children}
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
