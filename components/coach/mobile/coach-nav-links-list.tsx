"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  LayoutGrid,
  Dumbbell,
  ChefHat,
  ChevronDown,
  Salad,
  ClipboardList,
  CalendarDays,
  TrendingUp,
  Layers,
  CalendarClock,
  HeartHandshake,
  Palette,
  Flag,
  Trophy,
  MessagesSquare,
  MonitorPlay,
  Building2,
  UserPlus,
  MessageCircle,
  Zap,
  Wallet,
  Tag,
  Settings,
  Calculator,
  Link2,
  Users2,
  Lightbulb,
} from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/client";
import { SignOutButton } from "@/components/group/sign-out-button";
import { DownloadAppButton } from "@/components/coach/desktop/download-app-button";
import { ViewModeToggle } from "@/components/coach/view-mode-toggle";

// The actual nav-link content shared by two different overlay shells:
// CoachMoreSheet (CoachDesktopShell's own narrow-width "More" fallback,
// unchanged) and CoachMoreDrawer (the mobile "More" tab's edge drawer,
// mobile_more_tab_condensed_widget_hub_sept30.md). Extracted so these
// genuine full-page navigation destinations — Settings-style rows, not
// inline-expandable tiles — exist in exactly one place rather than two
// copies drifting apart.
function GroupHeader({ label, icon: Icon }: { label: string; icon: typeof LayoutGrid }) {
  return (
    <div className="flex items-center gap-2 px-5 pt-4 pb-1.5">
      <Icon className="w-3.5 h-3.5 text-steel" strokeWidth={2.25} />
      <p className="font-body text-xs text-steel uppercase tracking-wide">{label}</p>
    </div>
  );
}

function Item({ href, label, icon: Icon }: { href: string; label: string; icon: typeof LayoutGrid }) {
  return (
    <Link href={href} className="flex items-center gap-3 h-11 px-5 font-body text-sm text-chalk active:text-rust">
      <Icon className="w-4 h-4 shrink-0 text-steel" strokeWidth={2.25} />
      {label}
    </Link>
  );
}

// The phone More list. Short on purpose: the things a coach reaches for every day sit in the open list, and everything
// else is one tap away under "More tools" (closed until opened, and only shown once the coach has a client). The group
// switcher is not here: Spotlight > Clients and groups already switches and creates groups, and Clients, Messages and Calendar
// are coach-level pages that show every client no matter which group the coach last looked at.
export function CoachNavLinksList({ groupId }: { groupId: string; groupName?: string }) {
  const [teamMode, setTeamMode] = useState(false);
  // A one-on-one space has no team feed, so the entry is hidden there (the desktop menu does the same).
  const [groupKind, setGroupKind] = useState<string | null>(null);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [hasClients, setHasClients] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const supabase = createBrowserClient();
      const [{ data: group }, { data: userData }, { count: clientCount }] = await Promise.all([
        supabase.from("groups").select("team_mode, group_kind").eq("id", groupId).maybeSingle(),
        supabase.auth.getUser(),
        supabase.from("group_memberships").select("profile_id", { count: "exact", head: true }).eq("role", "athlete"),
      ]);
      if (cancelled) return;
      setTeamMode(group?.team_mode ?? false);
      setGroupKind((group as { group_kind?: string } | null)?.group_kind ?? null);
      setHasClients((clientCount ?? 0) > 0);
      if (userData.user) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("is_platform_admin")
          .eq("id", userData.user.id)
          .maybeSingle();
        if (!cancelled) setIsPlatformAdmin(profile?.is_platform_admin ?? false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [groupId]);

  return (
    <>
      <div className="pt-3">
        <Item href={`/groups/${groupId}/programs`} label="Programs" icon={LayoutGrid} />
        <Item href={`/groups/${groupId}/exercise-library`} label="Exercise library" icon={Dumbbell} />
        <Item href={`/groups/${groupId}/recipes`} label="Recipe hub" icon={ChefHat} />
        <Item href={`/groups/${groupId}/nutrition`} label="Meal plans" icon={Salad} />
        <Item href={`/groups/${groupId}/tools/macro-calculator`} label="Macro calculator" icon={Calculator} />
        <Item href={`/groups/${groupId}/availability`} label="Availability" icon={CalendarClock} />
        <Item href={`/groups/${groupId}/business`} label="Business overview" icon={TrendingUp} />
        <Item href={`/groups/${groupId}/settings`} label="Settings" icon={Settings} />
        <div className="flex items-center h-11 px-5 [&_button]:text-sm [&_button]:text-chalk [&_button]:gap-3 [&_svg]:w-4 [&_svg]:h-4 [&_svg]:text-steel">
          <ViewModeToggle targetMode="desktop" label="Desktop mode" groupId={groupId} />
        </div>
        <div className="px-5 py-1">
          <DownloadAppButton />
        </div>
      </div>

      {hasClients && (
        <details className="group mt-2 border-t border-steel/20">
          <summary className="flex items-center justify-between h-12 px-5 font-body text-sm text-steel cursor-pointer list-none [&::-webkit-details-marker]:hidden">
            More tools
            <ChevronDown className="w-4 h-4 transition-transform group-open:rotate-180" strokeWidth={2.25} />
          </summary>
          <div className="pb-2">
            <GroupHeader label="Clients and sessions" icon={Users2} />
            <Item href={`/groups/${groupId}/business/booking-page`} label="Booking page" icon={Link2} />
            <Item href={`/groups/${groupId}/group-sessions`} label="Group sessions" icon={Users2} />
            <Item href={`/groups/${groupId}/business/session-types`} label="Session types" icon={Tag} />
            <Item href={`/groups/${groupId}/business/session-ledger`} label="Session ledger" icon={Wallet} />
            <Item href={`/groups/${groupId}/business/leads`} label="Leads" icon={UserPlus} />

            <GroupHeader label="Business" icon={TrendingUp} />
            <Item href={`/groups/${groupId}/business/packages`} label="Packages" icon={Layers} />
            <Item href={`/groups/${groupId}/business/waiver`} label="Waiver" icon={ClipboardList} />
            <Item href={`/groups/${groupId}/business/sms-settings`} label="SMS notifications" icon={MessageCircle} />
            <Item href={`/groups/${groupId}/business/zapier`} label="Zapier" icon={Zap} />
            <Item href={`/groups/${groupId}/branding`} label="Organization settings" icon={Palette} />

            <GroupHeader label="Community" icon={Flag} />
            {groupKind !== "one_on_one" && <Item href={`/groups/${groupId}/feed`} label="Team feed" icon={MessagesSquare} />}
            <Item href={`/groups/${groupId}/challenges`} label="Challenges" icon={Flag} />
            <Item href={`/groups/${groupId}/records`} label="Hall of fame" icon={Trophy} />
            <Item href={`/groups/${groupId}/resources`} label="Resources" icon={HeartHandshake} />
            <Item href={`/groups/${groupId}/quick-tips`} label="Quick tips" icon={Lightbulb} />
            {teamMode && (
              <>
                <Item href={`/groups/${groupId}/team`} label="Depth chart" icon={ClipboardList} />
                <Item href={`/groups/${groupId}/team/calendar`} label="Team calendar" icon={CalendarDays} />
              </>
            )}

            <GroupHeader label="Other" icon={MonitorPlay} />
            <a
              href={`/groups/${groupId}/display`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 h-11 px-5 font-body text-sm text-chalk active:text-rust"
            >
              <MonitorPlay className="w-4 h-4 shrink-0 text-steel" strokeWidth={2.25} />
              Kiosk display
            </a>
            <Item href={`/groups/${groupId}/business/support`} label="Support" icon={HeartHandshake} />
            {isPlatformAdmin && (
              <>
                <Item href="/admin/support" label="Support inbox" icon={HeartHandshake} />
                <Item href="/admin/organizations" label="Organizations" icon={Building2} />
              </>
            )}
          </div>
        </details>
      )}

      <div className="px-5 py-4 border-t border-steel/20 mt-auto">
        <SignOutButton />
      </div>
    </>
  );
}
