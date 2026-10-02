"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  LayoutGrid,
  Dumbbell,
  ChefHat,
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
} from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/client";
import { SignOutButton } from "@/components/group/sign-out-button";
import { DownloadAppButton } from "@/components/coach/desktop/download-app-button";
import { ViewModeToggle } from "@/components/coach/view-mode-toggle";
import { GroupSwitcher } from "@/components/coach/desktop/group-switcher";

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
      <p className="font-body text-[10px] text-steel uppercase tracking-wide">{label}</p>
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

export function CoachNavLinksList({ groupId, groupName }: { groupId: string; groupName: string }) {
  const [teamMode, setTeamMode] = useState(false);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const supabase = createBrowserClient();
      const [{ data: group }, { data: userData }] = await Promise.all([
        supabase.from("groups").select("team_mode").eq("id", groupId).maybeSingle(),
        supabase.auth.getUser(),
      ]);
      if (cancelled) return;
      setTeamMode(group?.team_mode ?? false);
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
      <div className="px-5 pt-4">
        <GroupSwitcher groupId={groupId} groupName={groupName} />
      </div>

      <GroupHeader label="Build" icon={LayoutGrid} />
      <Item href={`/groups/${groupId}/programs`} label="Programs" icon={LayoutGrid} />
      <Item href={`/groups/${groupId}/exercise-library`} label="Exercise Library" icon={Dumbbell} />
      <Item href={`/groups/${groupId}/recipes`} label="Recipe Hub" icon={ChefHat} />
      <Item href={`/groups/${groupId}/nutrition`} label="Meal Plans" icon={Salad} />
      {teamMode && (
        <>
          <Item href={`/groups/${groupId}/team`} label="Depth Chart" icon={ClipboardList} />
          <Item href={`/groups/${groupId}/team/calendar`} label="Team Calendar" icon={CalendarDays} />
        </>
      )}

      <GroupHeader label="Business" icon={TrendingUp} />
      <Item href={`/groups/${groupId}/business`} label="Overview" icon={TrendingUp} />
      <Item href={`/groups/${groupId}/business/packages`} label="Packages" icon={Layers} />
      <Item href={`/groups/${groupId}/business/waiver`} label="Waiver" icon={ClipboardList} />
      <Item href={`/groups/${groupId}/availability`} label="Availability" icon={CalendarClock} />
      <Item href={`/groups/${groupId}/business/support`} label="Support" icon={HeartHandshake} />
      <Item href={`/groups/${groupId}/business/leads`} label="Leads" icon={UserPlus} />
      <Item href={`/groups/${groupId}/business/sms-settings`} label="SMS Notifications" icon={MessageCircle} />
      <Item href={`/groups/${groupId}/business/zapier`} label="Zapier" icon={Zap} />
      <Item href={`/groups/${groupId}/business/session-ledger`} label="Session Ledger" icon={Wallet} />
      <Item href={`/groups/${groupId}/business/session-types`} label="Session Types" icon={Tag} />
      <Item href={`/groups/${groupId}/branding`} label="Organization" icon={Palette} />

      <GroupHeader label="Engage" icon={Flag} />
      <Item href={`/groups/${groupId}/feed`} label="Team Feed" icon={MessagesSquare} />
      <Item href={`/groups/${groupId}/challenges`} label="Challenges" icon={Flag} />
      <Item href={`/groups/${groupId}/records`} label="Hall of Fame" icon={Trophy} />
      <Item href={`/groups/${groupId}/resources`} label="Resources" icon={HeartHandshake} />

      <GroupHeader label="Account" icon={MonitorPlay} />
      <a
        href={`/groups/${groupId}/display`}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-3 h-11 px-5 font-body text-sm text-chalk active:text-rust"
      >
        <MonitorPlay className="w-4 h-4 shrink-0 text-steel" strokeWidth={2.25} />
        Display Mode
      </a>
      <div className="px-5 py-1.5">
        <ViewModeToggle targetMode="mobile" label="Client-Facing Mode" groupId={groupId} />
      </div>
      {isPlatformAdmin && (
        <>
          <Item href="/admin/organizations" label="Organizations" icon={Building2} />
          <Item href="/admin/support" label="Support Inbox" icon={HeartHandshake} />
        </>
      )}
      <div className="px-5 py-2">
        <DownloadAppButton />
      </div>
      <div className="px-5 py-4 border-t border-steel/20 mt-auto">
        <SignOutButton />
      </div>
    </>
  );
}
