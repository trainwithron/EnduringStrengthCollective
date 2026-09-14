"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, CalendarDays, MessagesSquare, Settings, Apple, Users, Menu } from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/client";

// Home/Workout merge (mobile_home_workout_tab_merge_idea.md, locked
// 2026-09-14): Home itself is now today's workout — a hero CTA at the
// top of the Day view, with the existing widgets below it — so
// "workout" is no longer its own destination. That frees a slot,
// letting Calendar (previously absorbed into Home's own Day/Week/Month
// switcher) come back out as a real top-level tab, alongside Nutrition
// getting promoted the same way. Final locked order: Home / Calendar /
// Feed / Nutrition / Settings.
//
// Coach variant (coach_mobile_app_redesign_plan.md, locked 2026-09-14):
// Home / Roster / Messages / Calendar / More — reuses this same
// component with `variant="coach"` rather than a sibling component,
// since the active-state/optimistic-highlight machinery below is
// identical either way. "More" isn't a route (it opens a bottom sheet),
// so it's driven by `onMoreClick` instead of an href.
type TabKey = "home" | "feed" | "calendar" | "nutrition" | "settings" | "roster" | "messages" | "more";

// The session page (`/sessions/[sessionId]`) has no groupId in its URL, so
// it can't be matched by pathname here — it passes `activeOverride`
// instead.
export function BottomTabBar({
  groupId,
  activeOverride,
  variant = "athlete",
  onMoreClick,
}: {
  groupId: string;
  activeOverride?: TabKey;
  variant?: "athlete" | "coach";
  onMoreClick?: () => void;
}) {
  const pathname = usePathname();

  // A 1-on-1 client (group_memberships.client_tier = 'one_on_one') has no
  // team to see or be seen by — Team Feed (and everything social that
  // hangs off it) is hidden for them, reusing the tier field that already
  // exists rather than needing a personal group per client.
  const [hideFeed, setHideFeed] = useState(false);
  useEffect(() => {
    if (variant === "coach") return;
    let cancelled = false;
    async function run() {
      const supabase = createBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from("group_memberships")
        .select("client_tier")
        .eq("group_id", groupId)
        .eq("profile_id", user.id)
        .maybeSingle();
      if (!cancelled) setHideFeed(data?.client_tier === "one_on_one");
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [groupId, variant]);

  // Every one of these destinations is server-rendered on demand, so a tap
  // costs a round trip before the new route commits and `pathname` updates.
  // Without this, the tapped tab stays unlit for that whole window and the
  // tap reads as ignored. Light it immediately, then let the real pathname
  // take over once the navigation lands.
  const [pendingTab, setPendingTab] = useState<TabKey | null>(null);
  useEffect(() => {
    setPendingTab(null);
  }, [pathname]);

  const resolvedActiveAthlete: TabKey =
    pathname === `/groups/${groupId}`
      ? "home"
      : pathname.startsWith(`/groups/${groupId}/workouts`) ||
        pathname.startsWith(`/groups/${groupId}/today`)
      ? "home"
      : pathname.startsWith(`/groups/${groupId}/feed`)
      ? "feed"
      : pathname.startsWith(`/groups/${groupId}/calendar`) || pathname.includes("/calendar")
      ? "calendar"
      : pathname.startsWith(`/groups/${groupId}/settings`)
      ? "settings"
      : pathname.startsWith(`/groups/${groupId}/nutrition`)
      ? "nutrition"
      : "home";

  // The coach variant covers ~40 existing coach routes — rather than
  // reimplement that whole pathname map here, every coach page that
  // renders this bar already knows its own section (the `active` prop
  // CoachDesktopShell already takes) and passes it in as activeOverride.
  const resolvedActiveCoach: TabKey = pathname.startsWith(`/groups/${groupId}/clients`)
    ? "roster"
    : pathname.startsWith(`/groups/${groupId}/messages`)
    ? "messages"
    : pathname.startsWith(`/groups/${groupId}/calendar`)
    ? "calendar"
    : "home";

  const resolvedActive = variant === "coach" ? resolvedActiveCoach : resolvedActiveAthlete;

  const athleteTabs: { key: TabKey; label: string; href: string; icon: typeof Home }[] = [
    { key: "home", label: "Home", href: `/groups/${groupId}`, icon: Home },
    { key: "calendar", label: "Calendar", href: `/groups/${groupId}/calendar`, icon: CalendarDays },
    ...(hideFeed
      ? []
      : [{ key: "feed" as const, label: "Feed", href: `/groups/${groupId}/feed`, icon: MessagesSquare }]),
    { key: "nutrition", label: "Nutrition", href: `/groups/${groupId}/nutrition`, icon: Apple },
    { key: "settings", label: "Settings", href: `/groups/${groupId}/settings`, icon: Settings },
  ];

  const coachTabs: { key: TabKey; label: string; href: string | null; icon: typeof Home }[] = [
    { key: "home", label: "Home", href: `/groups/${groupId}`, icon: Home },
    { key: "roster", label: "Roster", href: `/groups/${groupId}/clients`, icon: Users },
    { key: "messages", label: "Messages", href: `/groups/${groupId}/messages`, icon: MessagesSquare },
    { key: "calendar", label: "Calendar", href: `/groups/${groupId}/calendar`, icon: CalendarDays },
    { key: "more", label: "More", href: null, icon: Menu },
  ];

  const tabs = variant === "coach" ? coachTabs : athleteTabs;

  // A tapped tab wins over the (still-stale) pathname until the route
  // commits; `activeOverride` still wins over both, since a page that
  // declares its own tab knows better than either signal.
  const active: TabKey = activeOverride ?? pendingTab ?? resolvedActive;

  return (
    <nav className="fixed bottom-0 left-0 right-0 h-16 bg-graphite border-t border-steel/20 flex z-20">
      {tabs.map((tab) => {
        const isActive = active === tab.key;
        const Icon = tab.icon;
        const content = (
          <>
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
          </>
        );
        if (tab.href === null) {
          return (
            <button
              key={tab.key}
              type="button"
              onClick={onMoreClick}
              className="flex-1 flex flex-col items-center justify-center gap-0.5 active:opacity-60 transition-opacity"
            >
              {content}
            </button>
          );
        }
        return (
          <Link
            key={tab.key}
            href={tab.href}
            onClick={() => setPendingTab(tab.key)}
            className="flex-1 flex flex-col items-center justify-center gap-0.5 active:opacity-60 transition-opacity"
          >
            {content}
          </Link>
        );
      })}
    </nav>
  );
}
