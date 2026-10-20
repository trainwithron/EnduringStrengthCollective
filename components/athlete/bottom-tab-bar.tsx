"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, CalendarDays, MessagesSquare, Settings, Apple } from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/client";
import { hasSocialTabAccess } from "@/lib/social-access";
import { usePushStatus } from "@/lib/use-push-status";
import { mySpaceHref } from "@/lib/my-space-target";

// Home/Workout merge (mobile_home_workout_tab_merge_idea.md, locked
// 2026-09-14): Home itself is now today's workout — a hero CTA at the
// top of the Day view, with the existing widgets below it — so
// "workout" is no longer its own destination. That frees a slot,
// letting Calendar (previously absorbed into Home's own Day/Week/Month
// switcher) come back out as a real top-level tab, alongside Nutrition
// getting promoted the same way. Final locked order: Home / Calendar /
// Feed / Nutrition / Settings.
//
// "own" variant (Phone opens as the coach's own account, Release 2; Ron: "Is it immediately open to my account? And then the only difference will be that I have the spot button up top"): on a coach's
// phone, every coach page (Clients, Programs, a client's profile...) carries the SAME five tabs as their own client app, each opening that tab of their own app through /my-space (lib/my-space-target.ts).
// Clients, messages and the business side are in Spotlight. There is no coach bar and no More. A team-sport coach's team Home passes `homeHref` so Home stays the team Home.
type TabKey = "home" | "feed" | "calendar" | "nutrition" | "settings";

// The session page (`/sessions/[sessionId]`) has no groupId in its URL, so
// it can't be matched by pathname here — it passes `activeOverride`
// instead.
export function BottomTabBar({
  groupId,
  activeOverride,
  variant = "athlete",
  homeHref,
}: {
  groupId: string;
  // null: a coach page that is none of the five tabs (nothing lit).
  activeOverride?: TabKey | null;
  variant?: "athlete" | "own";
  homeHref?: string;
}) {
  const pathname = usePathname();
  // A small dot on Settings while notifications could be switched on but aren't — the way to
  // reach the toggle is right there. Not shown where the device can't do push at all.
  const { state: pushState } = usePushStatus();

  // social_only_group_membership_idea.md — real rewire, 2026-09-16:
  // Feed used to hide based only on the CURRENT group's own
  // client_tier, which never accounted for a client who could hold a
  // second, different-kind membership elsewhere (a real 1-on-1 client
  // added to a team group for social access only). The real signal is
  // across ALL of this athlete's memberships, not just the one they
  // happen to be viewing right now: do they have at least one
  // membership that's either a genuine team/social group
  // (group_kind !== 'one_on_one') or explicitly flagged
  // membership_type = 'social_only'? A solo 1-on-1 client with no such
  // membership never sees Feed; the moment a coach adds either kind,
  // it appears — everywhere in the app, not just on whichever group's
  // page they're currently on. Replaces the old single-group
  // client_tier check entirely rather than running both.
  const [hideFeed, setHideFeed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    async function run() {
      const supabase = createBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from("group_memberships")
        .select("membership_type, groups ( group_kind )")
        .eq("profile_id", user.id);
      const memberships = (data ?? []).map((m: any) => ({
        membershipType: m.membership_type as string | null,
        groupKind: m.groups?.group_kind as string | null,
      }));
      if (!cancelled) setHideFeed(!hasSocialTabAccess(memberships));
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [variant]);

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

  const athleteTabs: { key: TabKey; label: string; href: string; icon: typeof Home }[] = [
    { key: "home", label: "Home", href: `/groups/${groupId}`, icon: Home },
    { key: "calendar", label: "Calendar", href: `/groups/${groupId}/calendar`, icon: CalendarDays },
    ...(hideFeed
      ? []
      : [{ key: "feed" as const, label: "Feed", href: `/groups/${groupId}/feed`, icon: MessagesSquare }]),
    { key: "nutrition", label: "Nutrition", href: `/groups/${groupId}/nutrition`, icon: Apple },
    { key: "settings", label: "Settings", href: `/groups/${groupId}/settings`, icon: Settings },
  ];

  // The same five, opening the coach's OWN app from wherever they are.
  const ownTabs: { key: TabKey; label: string; href: string; icon: typeof Home }[] = [
    { key: "home", label: "Home", href: homeHref ?? mySpaceHref(null), icon: Home },
    { key: "calendar", label: "Calendar", href: mySpaceHref("calendar"), icon: CalendarDays },
    ...(hideFeed ? [] : [{ key: "feed" as const, label: "Feed", href: mySpaceHref("feed"), icon: MessagesSquare }]),
    { key: "nutrition", label: "Nutrition", href: mySpaceHref("nutrition"), icon: Apple },
    { key: "settings", label: "Settings", href: mySpaceHref("settings"), icon: Settings },
  ];

  const tabs = variant === "own" ? ownTabs : athleteTabs;
  const resolvedActive: TabKey | null = variant === "own" ? null : resolvedActiveAthlete;

  // A tapped tab wins over the (still-stale) pathname until the route
  // commits; `activeOverride` still wins over both, since a page that
  // declares its own tab knows better than either signal.
  const active: TabKey | null = activeOverride !== undefined ? activeOverride ?? pendingTab : pendingTab ?? resolvedActive;

  return (
    <nav className="fixed bottom-0 left-0 right-0 h-16 bg-graphite border-t border-steel/20 flex z-20">
      {tabs.map((tab) => {
        const isActive = active === tab.key;
        const Icon = tab.icon;
        const content = (
          <>
            <span className="relative">
              <Icon
                className={`w-5 h-5 ${isActive ? "text-rust" : "text-steel"}`}
                strokeWidth={2.5}
              />
              {tab.key === "settings" && pushState === "off" && (
                <span
                  aria-label="Notifications are off"
                  className="absolute -top-0.5 -right-1 w-2.5 h-2.5 rounded-full bg-amber border border-graphite"
                />
              )}
            </span>
            <span
              className={`font-body text-xs uppercase tracking-wide ${
                isActive ? "text-rust" : "text-steel"
              }`}
            >
              {tab.label}
            </span>
          </>
        );
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
