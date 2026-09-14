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
  X,
} from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/client";
import { SignOutButton } from "@/components/group/sign-out-button";
import { DownloadAppButton } from "@/components/coach/desktop/download-app-button";
import { ViewModeToggle } from "@/components/coach/view-mode-toggle";
import { GroupSwitcher } from "@/components/coach/desktop/group-switcher";

// The coach mobile "More" sheet (coach_mobile_app_redesign_plan.md,
// locked 2026-09-14) — everything the old flat drawer nav used to hold,
// minus the four destinations that are now real bottom tabs (Home,
// Roster, Messages, Calendar). Reorganized into the plan's own named
// groups (Build/Business/Engage/Account) rather than the desktop
// shell's Programming/Nutrition/Team/Business/Engage split, since this
// is a simpler, calmer surface by design. Self-contained (fetches its
// own team_mode/platform-admin/support-count state) so it can be
// rendered from both CoachDesktopShell's mobile drawer and the coach
// mobile Home, without prop-drilling between two different parents.
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

export function CoachMoreSheet({
  groupId,
  groupName,
  onClose,
}: {
  groupId: string;
  groupName: string;
  onClose: () => void;
}) {
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
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-graphite/80" onClick={onClose} aria-hidden="true" />
      <aside className="relative w-[280px] max-w-[85vw] h-full bg-graphite border-r border-steel/20 flex flex-col overflow-y-auto">
        <div className="flex items-center justify-between px-3 h-14 border-b border-steel/20 shrink-0">
          <p className="font-display uppercase text-sm tracking-wide text-chalk px-2">More</p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-9 h-9 flex items-center justify-center text-steel"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

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
          <ViewModeToggle targetMode="mobile" label="Client-Facing Mode" />
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
      </aside>
    </div>
  );
}
