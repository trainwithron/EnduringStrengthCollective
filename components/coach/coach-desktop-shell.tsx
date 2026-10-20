"use client";

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { homeOfPath, homeTabs, homeHref, HOMES, type HomeKey } from "@/lib/desktop-coach-homes";
import { HomeTabStrip } from "@/components/coach/desktop/home-tab-strip";
import Link from "next/link";
import {
  Dumbbell,
  ChevronRight,
  CalendarDays,
  Users2,
  UserRound,
  Home,
  Mail,
  Settings,
} from "lucide-react";
import { SignOutButton } from "@/components/group/sign-out-button";
import { DownloadAppButton } from "@/components/coach/desktop/download-app-button";
import { TabletLayoutSwitch } from "@/components/coach/tablet-layout-switch";
import { FeedbackButton } from "@/components/feedback/feedback-button";
import { ClientFinder } from "@/components/coach/desktop/client-finder";
import { HeaderNotificationBell } from "@/components/notifications/header-bell";
import { useCoachNavFacts } from "@/components/coach/use-coach-type";
import { useOnFrontDesk } from "@/components/front-desk/use-on-front-desk";
import { isTeamSportGroup, moneyHiddenFor, orgIsTeamOnly } from "@/lib/team-sport";
import { WorkspaceMenu } from "@/components/coach/desktop/workspace-menu";
import { createBrowserClient } from "@/lib/supabase/client";
import { bestEffort } from "@/lib/saved";
import { TerminologyProvider } from "@/components/coach/terminology-provider";
import { SwappableTerm } from "@/components/coach/swappable-term";
import { ShellRail, type RailIcon } from "@/components/coach/desktop/shell-rail";
import { ClientsRailWidget } from "@/components/coach/desktop/rail-widgets/clients-rail-widget";
import { MessagesRailWidget } from "@/components/coach/desktop/rail-widgets/messages-rail-widget";
import { FeedRailWidget } from "@/components/coach/desktop/rail-widgets/feed-rail-widget";
import { CalendarRailWidget } from "@/components/coach/desktop/rail-widgets/calendar-rail-widget";
import { TeamRailWidget } from "@/components/coach/desktop/rail-widgets/team-rail-widget";
import { BusinessRailWidget } from "@/components/coach/desktop/rail-widgets/business-rail-widget";
import { ShellListPanel } from "@/components/coach/desktop/shell-list-panel";
import { CollectiveIntelligenceChat } from "@/components/coach/desktop/collective-intelligence-chat";
import { useWorkspaceRegistration } from "@/components/coach/workspace/workspace-host";
import { WorkspaceRailButton } from "@/components/coach/workspace/workspace-rail-button";
import { EmbeddedActivityReporter } from "@/components/coach/workspace/embedded-activity-reporter";
import { BottomTabBar } from "@/components/athlete/bottom-tab-bar";
import { CoachSpotHub } from "@/components/coach/mobile/coach-spot-hub";
import { PendingNoticeFlusher } from "@/components/coach/pending-notice-flusher";
import { useEmbedded } from "@/components/shared/embedded-context";

type Active =
  | "home"
  | "front-desk"
  | "dashboard"
  | "programs"
  | "exercise-library"
  | "recipes"
  | "nutrition"
  | "tools"
  | "availability"
  | "calendar"
  | "feed"
  | "clients"
  | "members"
  | "branding"
  | "business"
  | "packages"
  | "waiver"
  | "support"
  | "leads"
  | "sms-settings"
  | "zapier"
  | "session-types"
  | "booking-page"
  | "group-sessions"
  | "group-calendar"
  | "session-ledger"
  | "resources"
  | "quick-tips"
  | "challenges"
  | "team"
  | "attendance"
  | "team-calendar"
  | "team-sheet"
  | "game-detail"
  | "team-performance"
  | "messages"
  | "records"
  | "kiosk"
  | "settings"
  | "display"
  | "admin-organizations"
  | "admin-support"
  | "admin-ranking"
  | "website";

// Phone speed (B4): the desktop-only parts (the side panel with Needs attention, the chat edge tab) and the reads that only feed them (the rail's badges, the platform admin's
// counts) wait until the screen is known to be a computer's; a phone never mounts or asks for them. Known once per page load and kept for the next page, so moving around on a
// computer never makes the panel pop in again.
const DESKTOP_QUERY = "(min-width: 1024px)";
let knownDesktop: boolean | null = null;
function useIsDesktop(): boolean | null {
  const [isDesktop, setIsDesktop] = useState<boolean | null>(knownDesktop);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      knownDesktop = true;
      setIsDesktop(true);
      return;
    }
    const mq = window.matchMedia(DESKTOP_QUERY);
    const update = () => {
      knownDesktop = mq.matches;
      setIsDesktop(mq.matches);
    };
    update();
    // A tablet turned sideways can cross the line.
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);
  return isDesktop;
}

function CoachDesktopShellFull({
  groupId,
  groupName,
  active,
  coachLevel = false,
  wide = false,
  children,
}: {
  groupId: string;
  groupName: string;
  active: Active;
  // Home and other coach-level pages: the page belongs to the coach, not to the group used to anchor the rail's links. The business name is shown
  // instead of the group's, and no client or group identity is badged.
  coachLevel?: boolean;
  // The page uses the full width of the screen instead of the usual 1400px column (the program builder, whose days sit side by side).
  wide?: boolean;
  children: React.ReactNode;
}) {
  const [feedUnread, setFeedUnread] = useState(0);
  const [clientsUnread, setClientsUnread] = useState(0);
  const [messagesUnread, setMessagesUnread] = useState(0);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [openSupportCount, setOpenSupportCount] = useState(0);
  const [teamMode, setTeamMode] = useState(false);
  // Every group of this organization is a team-sport group (read with the group below): no money numbers anywhere in this shell.
  const [orgTeamOnly, setOrgTeamOnly] = useState(false);
  const [groupKind, setGroupKind] = useState<"one_on_one" | "social" | "team" | null>(null);
  const [orgName, setOrgName] = useState<string | null>(null);
  // In a one-on-one space the name up top is the client: this is who, so the name can open their profile.
  const [soloClientId, setSoloClientId] = useState<string | null>(null);
  // Concept 8 "Familiar" shell redesign (coach_desktop_shell_identity_
  // redesign.md) — the rail + list panel need the viewer's own id for
  // the pinned Needs Attention strip's fetch.
  const [coachId, setCoachId] = useState<string | null>(null);
  const registerWorkspace = useWorkspaceRegistration();
  const isDesktop = useIsDesktop();

  // Team (position groups/depth chart) is an opt-in feature for coaches
  // running an actual team sport — most individual-training coaches never
  // want it in their nav. Hidden until the group's own team_mode flag is
  // turned on (from the Team page's own "Enable" button); a small
  // "Enable Team Sports" link takes its place in the nav until then, so
  // it's still discoverable without permanently cluttering everyone else's
  // sidebar. Also grabs group_kind here — same query, no extra round
  // trip — to badge the top-bar name as Client/Group/Social so it's never
  // ambiguous whether "Karina Ramirez" up top is a person or a team.
  useEffect(() => {
    let cancelled = false;
    // Moving to another space: the previous client's link must not stay on the new space's name while the new one loads.
    setSoloClientId(null);
    async function run() {
      const supabase = createBrowserClient();
      const { data } = await supabase
        .from("groups")
        .select("team_mode, group_kind, organization_id, organizations ( name )")
        .eq("id", groupId)
        .maybeSingle();
      if (!cancelled) {
        setTeamMode(data?.team_mode ?? false);
        setGroupKind((data?.group_kind as "one_on_one" | "social" | "team" | null) ?? "team");
        setOrgName((data as any)?.organizations?.name ?? null);
      }
      const orgId = (data as { organization_id?: string | null } | null)?.organization_id ?? null;
      if (orgId) {
        const { data: orgGroups, error: orgGroupsError } = await supabase.from("groups").select("team_mode").eq("organization_id", orgId).limit(500);
        if (!cancelled) setOrgTeamOnly(!orgGroupsError && orgIsTeamOnly((orgGroups ?? []) as { team_mode?: boolean | null }[]));
      } else if (!cancelled) {
        setOrgTeamOnly(false);
      }
      if (data?.group_kind === "one_on_one") {
        const { data: member } = await supabase.from("group_memberships").select("profile_id").eq("group_id", groupId).eq("role", "athlete").limit(1).maybeSingle();
        if (!cancelled) setSoloClientId((member as { profile_id?: string } | null)?.profile_id ?? null);
      } else if (!cancelled) {
        setSoloClientId(null);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [groupId]);

  // Desktop never acts as a client (act-as is a phone-only tool for logging
  // in person), and the athlete mirror ignores the cookie off-phone — so a
  // leftover cookie is cleared the first time a real desktop-width page
  // loads, instead of lingering and resurfacing on the phone later.
  useEffect(() => {
    try {
      if (!window.matchMedia("(min-width: 1024px)").matches) return;
      if (window.sessionStorage.getItem("act-as-cleared") === "1") return;
      window.sessionStorage.setItem("act-as-cleared", "1");
      fetch("/api/coach/act-as", { method: "DELETE" }).catch(() => {});
    } catch {
      // Storage/matchMedia unavailable — harmless; the cookie is ignored on desktop anyway.
    }
  }, []);

  // Platform-admin-only "Organizations" link — visible only to the one
  // account flagged profiles.is_platform_admin, so an ordinary coach never
  // sees this at all.
  useEffect(() => {
    let cancelled = false;
    if (isDesktop !== true) return;
    async function run() {
      const supabase = createBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      if (!cancelled) setCoachId(user.id);
      const { data } = await supabase
        .from("profiles")
        .select("is_platform_admin")
        .eq("id", user.id)
        .maybeSingle();
      if (!cancelled) setIsPlatformAdmin(data?.is_platform_admin ?? false);
      if (data?.is_platform_admin) {
        const { count } = await supabase
          .from("support_requests")
          .select("id", { count: "exact", head: true })
          .eq("status", "open");
        if (!cancelled) setOpenSupportCount(count ?? 0);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [isDesktop]);

  // Remembers the last group this coach actually looked at, so the
  // cross-group Home dashboard (app/dashboard/page.tsx) can default its
  // own sidebar to somewhere real instead of showing no nav at all.
  // Non-httpOnly on purpose — this is UI convenience, not access control,
  // and the server-rendered Home page needs to read it via cookies().
  // A one-on-one client group is never remembered: Home would anchor on a client. The cookie keeps the last team or social group.
  useEffect(() => {
    if (coachLevel || groupKind === null || groupKind === "one_on_one") return;
    try {
      document.cookie = `last_group=${encodeURIComponent(
        JSON.stringify({ id: groupId, name: groupName })
      )}; path=/; max-age=${60 * 60 * 24 * 90}`;
      // The remembered WORKSPACE (last_workspace_group) is NOT written here (FIX 4): only the middleware sets it, on a real visit to a page of the chosen organization (or after the coach confirmed switching).
    } catch {
      // Non-fatal — Home just falls back to its minimal shell.
    }
  }, [groupId, groupName, groupKind, coachLevel]);

  // Organization branding (button shape, colors, fonts, logo) is now
  // applied once at the app root (app/layout.tsx) as CSS custom
  // properties, so it reaches this shell and the athlete mobile app
  // alike — nothing shell-specific to fetch or apply here anymore.

  // "What's new" badges: how many posts / client check-ins happened since
  // this coach last actually opened Team Feed / Clients for this group.
  // Visiting the relevant page marks it seen going forward — a brand-new
  // coach_view_state row seeds itself at "now" rather than flooding the
  // very first load with every historical post as "unread."
  useEffect(() => {
    let cancelled = false;
    if (isDesktop !== true) return;
    async function run() {
      const supabase = createBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      let { data: state } = await supabase
        .from("coach_view_state")
        .select("feed_seen_at, clients_seen_at")
        .eq("coach_id", user.id)
        .eq("group_id", groupId)
        .maybeSingle();

      const nowIso = new Date().toISOString();

      if (!state) {
        // First time this coach has ever loaded any desktop page for this
        // group — seed both to "now" so nothing pre-existing floods in as
        // "unread." A real badge only starts accumulating from here.
        await bestEffort(supabase.from("coach_view_state").upsert(
          { coach_id: user.id, group_id: groupId, feed_seen_at: nowIso, clients_seen_at: nowIso },
          { onConflict: "coach_id,group_id" }
        ));
        state = { feed_seen_at: nowIso, clients_seen_at: nowIso };
      } else if (active === "feed" || active === "clients" || active === "dashboard") {
        // Visiting the group's own Dashboard (which already surfaces a
        // "Recent Activity" feed of completions/comments) counts as
        // having seen both signals — otherwise a coach who navigates via
        // Home → Dashboard and never opens Feed/Clients directly would
        // see a Home-page activity dot that can never clear.
        const patch =
          active === "feed"
            ? { feed_seen_at: nowIso }
            : active === "clients"
            ? { clients_seen_at: nowIso }
            : { feed_seen_at: nowIso, clients_seen_at: nowIso };
        await bestEffort(supabase
          .from("coach_view_state")
          .update(patch)
          .eq("coach_id", user.id)
          .eq("group_id", groupId));
        state = { ...state, ...patch };
      }

      if (active !== "feed") {
        const { count } = await supabase
          .from("posts")
          .select("id", { count: "exact", head: true })
          .eq("group_id", groupId)
          .gt("created_at", state.feed_seen_at ?? "1970-01-01");
        if (!cancelled) setFeedUnread(count ?? 0);
      }

      if (active !== "clients") {
        const { data: logs } = await supabase
          .from("workout_logs")
          .select("athlete_id")
          .eq("group_id", groupId)
          .gt("created_at", state.clients_seen_at ?? "1970-01-01");
        if (!cancelled) setClientsUnread(new Set((logs ?? []).map((l) => l.athlete_id)).size);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [groupId, active, isDesktop]);

  // Coach<->Athlete DM unread count — a plain unread tally, not the
  // seeded "since last seen" mechanism above (a real unread message has
  // an unambiguous read/unread state already, no first-visit flood risk
  // to guard against). Skipped while the Messages page itself is open —
  // that page marks things read as they're opened, so a badge would just
  // be showing stale state a moment later anyway.
  useEffect(() => {
    let cancelled = false;
    if (active === "messages") {
      setMessagesUnread(0);
      return;
    }
    if (isDesktop !== true) return;
    async function run() {
      const supabase = createBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { count } = await supabase
        .from("direct_messages")
        .select("id", { count: "exact", head: true })
        .eq("group_id", groupId)
        .eq("recipient_id", user.id)
        .is("read_at", null);
      if (!cancelled) setMessagesUnread(count ?? 0);
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [groupId, active, isDesktop]);

  const navFacts = useCoachNavFacts();
  const onFrontDesk = useOnFrontDesk();
  // A team-sport group (never a coach-level page) gets its own tabs (Athletes, Team calendar, Team sheet, no money): lib/team-sport.ts, lib/desktop-coach-homes.ts.
  const teamSport = isTeamSportGroup(teamMode) && !coachLevel;
  // ONE rule for the money numbers (Business tile / view, rail Business icon, income, MRR, paying clients): lib/team-sport.ts moneyHiddenFor.
  const moneyHidden = moneyHiddenFor({ coachLevel: !!coachLevel, groupIsTeamSport: isTeamSportGroup(teamMode), orgTeamOnly });

  // FIX 6, six homes on the computer (lib/desktop-coach-homes.ts; Ron: "all six need to be done"). The rail is exactly six icons: Home, Clients, Calendar, Programs, Messages, Settings. Each goes to
  // its home's first tab this coach can see and is lit by the address; the home's tabs are a strip at the top of the page. There are no menus.
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const here = homeOfPath(pathname ?? "", searchParams ? `?${searchParams.toString()}` : "");
  const tabsByHome = homeTabs({ groupId, coachLevel: !!coachLevel, groupKind, teamMode, teamSport, moneyHidden, navFacts, isPlatformAdmin, onFrontDesk });
  // A page outside the table (a client's page seen by the coach, in-person logging) still lights the home its `active` key belongs to.
  const litHome: HomeKey | null =
    here?.home ?? (active === "home" ? "home" : HOMES.find((h) => tabsByHome[h.key].some((t) => t.key === active))?.key ?? null);

  // Hover rail widgets (hover_expand_rail_widgets_idea.md, decided per icon by Ron; FIX 6 decision 6): Business on Home (not where the money numbers are hidden), Clients, Calendar,
  // Messages with the Team feed under it, and Team performance on Programs in a team-sport group only. Settings has none.
  const HOME_ICON: Record<HomeKey, RailIcon["icon"]> = { home: Home, clients: teamSport ? Users2 : UserRound, calendar: CalendarDays, programs: Dumbbell, messages: Mail, settings: Settings };
  const homeWidget: Partial<Record<HomeKey, React.ReactNode>> = {
    home: moneyHidden ? undefined : <BusinessRailWidget groupId={groupId} />,
    clients: <ClientsRailWidget groupId={groupId} />,
    calendar: <CalendarRailWidget groupId={groupId} />,
    programs: teamSport ? <TeamRailWidget groupId={groupId} /> : undefined,
    messages: (
      <div className="space-y-3">
        <MessagesRailWidget groupId={groupId} />
        {groupKind !== null && groupKind !== "one_on_one" && <FeedRailWidget groupId={groupId} />}
      </div>
    ),
  };
  const homeBadge: Partial<Record<HomeKey, number>> = { clients: clientsUnread, messages: messagesUnread };
  const railIcons: RailIcon[] = HOMES.map((h) => ({
    key: h.key,
    // a team-sport group's Clients and Calendar are its Athletes and Team calendar
    label: teamSport && (h.key === "clients" || h.key === "calendar") ? tabsByHome[h.key][0]?.label ?? h.label : h.label,
    href: homeHref(tabsByHome, h.key) ?? "/dashboard",
    icon: HOME_ICON[h.key],
    active: litHome === h.key,
    badge: homeBadge[h.key],
    popover: homeWidget[h.key],
  }));

  // Tell the workspace host (in the coach layout, above every page) who and where this page is: while a shell is on screen the workspace is available.
  const isSharedGroup = coachLevel || groupKind === "team" || groupKind === "social";
  useEffect(() => {
    if (!coachId) return;
    registerWorkspace({ coachId, groupId, groupName, isShared: isSharedGroup });
    return () => registerWorkspace(null);
  }, [coachId, groupId, groupName, isSharedGroup, registerWorkspace]);

  return (
    <TerminologyProvider groupId={groupId}>
    <div className="min-h-screen bg-graphite text-chalk font-body">
      {/* operational_resilience_oversight_check.md — WCAG 2.4.1 Bypass
          Blocks (AA): this shell's sidebar is a real keyboard-tab-through
          cost on every single page. Visually hidden until it receives
          keyboard focus (Tab), then jumps straight to #main-content. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[200] focus:h-10 focus:px-4 focus:flex focus:items-center bg-rust text-graphite font-body text-sm font-medium"
      >
        Skip to content
      </a>
      {/* Persistent top bar — always visible regardless of sidebar state,
          on every viewport. Houses the mobile nav toggle and the "View as
          Client" jump, since both need to stay reachable without scrolling
          or hunting through the sidebar. */}
      <header className="sticky top-0 z-30 h-14 flex items-center gap-3 px-3 md:px-4 border-b border-steel/20 bg-graphite">
        {/* Always visible, not just on mobile — the sidebar's own name
            label is easy to miss when your eyes are on the main content,
            and picking up someone else's client/program by mistake is a
            real risk this exists to head off. */}
        <div className="flex items-center gap-1.5 min-w-0 max-w-[36%] lg:max-w-none">
          {/* "You're in: org -> group" — a coach who administers more than
              one organization otherwise has no reliable way to tell which
              org's data/branding a page belongs to just by looking, which
              is exactly the confusion that led to the org-scoping bug this
              indicator exists to guard against going forward. Only renders
              once the org name has loaded, so it never flashes empty. */}
          {orgName && !coachLevel && (
            <>
              <div className="hidden sm:block min-w-0">
                <WorkspaceMenu groupId={groupId} orgName={orgName} />
              </div>
              <ChevronRight className="hidden sm:inline w-3.5 h-3.5 text-steel shrink-0" />
            </>
          )}
          {coachLevel && orgName ? (
            <WorkspaceMenu groupId={groupId} orgName={orgName} large />
          ) : groupKind === "one_on_one" && soloClientId ? (
            <p className="font-display font-bold text-lg md:text-2xl uppercase tracking-wide truncate">
              <Link href={`/groups/${groupId}/athletes/${soloClientId}`} className="hover:text-rust underline-offset-4 hover:underline" title="Open this client's profile">
                {groupName}
              </Link>
            </p>
          ) : (
            <p className="font-display font-bold text-lg md:text-2xl uppercase tracking-wide truncate">
              {groupName}
            </p>
          )}
          {groupKind && !coachLevel && (
            <span
              className={`shrink-0 font-body text-xs uppercase tracking-wide px-1.5 py-0.5 border ${
                groupKind === "one_on_one"
                  ? "border-rust text-rust"
                  : groupKind === "social"
                  ? "border-moss text-moss"
                  : "border-steel/40 text-steel"
              }`}
            >
              {groupKind === "one_on_one" ? (
                <SwappableTerm termKey="client" form="singular" className="capitalize" />
              ) : groupKind === "social" ? (
                "Social"
              ) : (
                <SwappableTerm termKey="group" form="singular" className="capitalize" />
              )}
            </span>
          )}
        </div>
        <div className="ml-auto flex items-center gap-1.5 shrink-0">
          <HeaderNotificationBell scopeGroupId={groupId} />
          <DownloadAppButton variant="topbar" />
          <ClientFinder currentGroupId={groupId} />
        </div>
      </header>

      {/* The floating card stack's toolbar lives here, in the page flow, so it takes its own space instead of drawing over the page and the rail
          (Ron, Oct 6). Empty (zero height) unless the card-stack layout puts its bar into it. */}
      <div id="workspace-bar-slot" className="sticky top-14 z-30 hidden lg:block" />

      <div className="flex">
        {/* Concept 8 "Familiar" shell redesign — Discord/YouTube-inspired
            icon rail (always 64px, never collapses) + a resizable/
            collapsible list panel (roster, pinned Needs Attention strip,
            picture-in-picture Business mini-dashboard). Desktop/tablet
            only — mobile keeps the existing off-canvas drawer below,
            unchanged, since this redesign is explicitly scoped to the
            desktop shell. */}
        <ShellRail
          icons={railIcons}
          footer={
            <>
              <WorkspaceRailButton />
              <FeedbackButton variant="icon" />
              <DownloadAppButton collapsed />
              {/* Only on a tablet: back to the phone app. A computer never sees it. */}
              <TabletLayoutSwitch to="mobile" variant="rail" />
              <div className="w-11 flex items-center justify-center">
                <SignOutButton />
              </div>
            </>
          }
        />
        {isDesktop === true && coachId && (
          <ShellListPanel
            coachId={coachId}
            groupId={groupId}
            groupName={groupName}
            hideMoney={moneyHidden}
          />
        )}

        {/* On a phone (Release 2): Spotlight on top, and the coach's OWN app's five tabs at the bottom. Desktop/tablet keeps the rail + list panel above, unchanged. */}
        <div className="lg:hidden">
          <CoachSpotHub groupId={groupId} />
          <BottomTabBar groupId={groupId} variant="own" activeOverride={null} />
        </div>

        <main id="main-content" tabIndex={-1} className={`flex-1 min-w-0 px-4 pt-6 pb-24 md:px-10 md:pt-8 lg:pb-8 lg:mr-[var(--ws-dock,0px)] ${wide ? "" : "max-w-[1400px]"} focus:outline-none`}>
          <PendingNoticeFlusher />
          {here && (
            <HomeTabStrip
              label={HOMES.find((h) => h.key === here.home)?.label ?? "Sections"}
              tabs={tabsByHome[here.home]}
              current={here.tab}
              counts={{ clients: clientsUnread, messages: messagesUnread, feed: feedUnread, support: openSupportCount }}
            />
          )}
          {children}
        </main>
      </div>
      {/* Mounted once here so it's reachable from every one of this
          shell's ~50 routes, not just /dashboard (collective_intelligence
          audit gap — the component's own design intent was always
          "available everywhere," it just was never actually wired in
          anywhere but Home). Self-contained, no props needed. */}
      {/* Desktop-only edge tab: on phones the Spotlight hub is the single entry,
          so hide this one below lg (position:fixed still hides with its wrapper). */}
      {isDesktop === true && (
        <div className="hidden lg:block">
          <CollectiveIntelligenceChat groupId={groupId} unread={messagesUnread} />
        </div>
      )}
    </div>
    </TerminologyProvider>
  );
}

// A page shown inside a workspace pane (see components/shared/embedded-context.tsx) is just its content: no rail, panels, top bar or floating chat, so a pane never
// holds a second copy of the whole app. Everything else about the page (its own data, its own controls, its links) is unchanged.
export function CoachDesktopShell(props: React.ComponentProps<typeof CoachDesktopShellFull>) {
  const embedded = useEmbedded();
  if (embedded) {
    return (
      <TerminologyProvider groupId={props.groupId}>
        <div data-embedded="1" className="min-h-screen bg-graphite text-chalk font-body">
          <EmbeddedActivityReporter />
          <main id="main-content" className="px-4 pt-4 pb-8">
            {props.children}
          </main>
        </div>
      </TerminologyProvider>
    );
  }
  return <CoachDesktopShellFull {...props} />;
}
