"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Dumbbell, MessagesSquare, Settings, Calendar } from "lucide-react";

type TabKey = "home" | "workout" | "feed" | "calendar" | "settings";

// The session page (`/sessions/[sessionId]`) has no groupId in its URL, so
// it can't be matched by pathname here — it passes `activeOverride`
// instead.
export function BottomTabBar({
  groupId,
  activeOverride,
}: {
  groupId: string;
  activeOverride?: TabKey;
}) {
  const pathname = usePathname();

  // Every one of these destinations is server-rendered on demand, so a tap
  // costs a round trip before the new route commits and `pathname` updates.
  // Without this, the tapped tab stays unlit for that whole window and the
  // tap reads as ignored. Light it immediately, then let the real pathname
  // take over once the navigation lands.
  const [pendingTab, setPendingTab] = useState<TabKey | null>(null);
  useEffect(() => {
    setPendingTab(null);
  }, [pathname]);

  const resolvedActive: TabKey =
    activeOverride ??
    (pathname === `/groups/${groupId}`
      ? "home"
      : pathname.startsWith(`/groups/${groupId}/workouts`) ||
        pathname.startsWith(`/groups/${groupId}/today`)
      ? "workout"
      : pathname.startsWith(`/groups/${groupId}/feed`)
      ? "feed"
      : pathname.startsWith(`/groups/${groupId}/calendar`) || pathname.includes("/calendar")
      ? "calendar"
      : pathname.startsWith(`/groups/${groupId}/settings`)
      ? "settings"
      : "home");

  const tabs: { key: TabKey; label: string; href: string; icon: typeof Home }[] = [
    { key: "home", label: "Home", href: `/groups/${groupId}`, icon: Home },
    { key: "workout", label: "Workout", href: `/groups/${groupId}/today`, icon: Dumbbell },
    { key: "feed", label: "Feed", href: `/groups/${groupId}/feed`, icon: MessagesSquare },
    { key: "calendar", label: "Calendar", href: `/groups/${groupId}/calendar`, icon: Calendar },
    { key: "settings", label: "Settings", href: `/groups/${groupId}/settings`, icon: Settings },
  ];

  // A tapped tab wins over the (still-stale) pathname until the route
  // commits; `activeOverride` still wins over both, since a page that
  // declares its own tab knows better than either signal.
  const active: TabKey = activeOverride ?? pendingTab ?? resolvedActive;

  return (
    <nav className="fixed bottom-0 left-0 right-0 h-16 bg-graphite border-t border-steel/20 flex z-20">
      {tabs.map((tab) => {
        const isActive = active === tab.key;
        const Icon = tab.icon;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            onClick={() => setPendingTab(tab.key)}
            className="flex-1 flex flex-col items-center justify-center gap-0.5 active:opacity-60 transition-opacity"
          >
            <Icon
              className={`w-5 h-5 ${isActive ? "text-rust" : "text-steel"}`}
              strokeWidth={2.5}
            />
            <span
              className={`font-body text-[10px] uppercase tracking-wide ${
                isActive ? "text-rust" : "text-steel"
              }`}
            >
              {tab.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
