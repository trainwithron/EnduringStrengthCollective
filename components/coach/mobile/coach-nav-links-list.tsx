"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LayoutGrid, ChevronDown, Salad, ClipboardList, CalendarDays, HeartHandshake, MessagesSquare, Building2, Settings } from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/client";
import { SignOutButton } from "@/components/group/sign-out-button";
import { DownloadAppButton } from "@/components/coach/desktop/download-app-button";
import { isTeamSportGroup, teamSportMenu } from "@/lib/team-sport";
import { phoneCoachRedirect } from "@/lib/phone-coach-routes";
import { TabletLayoutSwitch } from "@/components/coach/tablet-layout-switch";

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

// The phone More list: only the phone app's own places (lib/phone-coach-routes.ts; Ron, Oct 19: one real phone app, not the computer pages squeezed onto a phone). Every link here is a page that stays a
// page on the phone (a test checks none of them is redirected), there is no button to switch to the computer layout, and "More tools" holds only the team pages. The group switcher is not here: Spotlight > Clients and groups
// already switches and creates groups, and Clients, Messages and Calendar are coach-level pages that show every client no matter which group the coach last looked at.
export function CoachNavLinksList({ groupId }: { groupId: string; groupName?: string }) {
  const [teamMode, setTeamMode] = useState(false);
  // A one-on-one space has no team feed, so the entry is hidden there (the desktop menu does the same).
  const [groupKind, setGroupKind] = useState<string | null>(null);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [hasClients, setHasClients] = useState(false);
  const teamSport = isTeamSportGroup(teamMode);

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

  const showFeed = !teamSport && groupKind !== "one_on_one";
  const showTeamCalendar = teamMode && !teamSport;
  const hasMoreTools = (hasClients && (showFeed || showTeamCalendar)) || isPlatformAdmin;

  return (
    <>
      <div className="pt-3">
        {/* A team-sport group: its team pages first (only the ones that are pages on the phone). */}
        {teamSport &&
          teamSportMenu(groupId)
            .filter((m) => m.key !== "members" && m.key !== "messages" && phoneCoachRedirect(m.href) === null)
            .map((m) => <Item key={m.key} href={m.href} label={m.label} icon={m.key === "team-calendar" ? CalendarDays : m.key === "feed" ? MessagesSquare : ClipboardList} />)}
        {/* The organization the coach is working in (the coach-level page), never the group this page happens to belong to: on the coach's own space that group is their personal one. */}
        <Item href="/programs" label="Programs" icon={LayoutGrid} />
        <Item href={`/groups/${groupId}/nutrition`} label="Nutrition" icon={Salad} />
        <Item href={`/groups/${groupId}/settings`} label="Settings" icon={Settings} />
        {/* Only on a tablet (Ron: "tab should be able to switch between both"); a phone never sees it. */}
        <TabletLayoutSwitch to="desktop" />
        <div className="px-5 py-1">
          <DownloadAppButton />
        </div>
      </div>

      {hasMoreTools && (
        <details className="group mt-2 border-t border-steel/20">
          <summary className="flex items-center justify-between h-12 px-5 font-body text-sm text-steel cursor-pointer list-none [&::-webkit-details-marker]:hidden">
            More tools
            <ChevronDown className="w-4 h-4 transition-transform group-open:rotate-180" strokeWidth={2.25} />
          </summary>
          <div className="pb-2">
            {hasClients && showFeed && <Item href={`/groups/${groupId}/feed`} label="Team feed" icon={MessagesSquare} />}
            {hasClients && showTeamCalendar && <Item href={`/groups/${groupId}/team/calendar`} label="Team calendar" icon={CalendarDays} />}
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
