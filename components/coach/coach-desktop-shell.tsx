"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  LayoutGrid,
  Dumbbell,
  ChevronRight,
  CalendarDays,
  MessagesSquare,
  Users,
  LayoutDashboard,
  Palette,
  TrendingUp,
  HeartHandshake,
  Flag,
  ChefHat,
  Salad,
  ClipboardList,
  Building2,
  Layers,
  Home,
  MonitorPlay,
  Activity,
  CalendarClock,
  Mail,
  Trophy,
  Wallet,
  Tag,
  MessageCircle,
  Zap,
} from "lucide-react";
import { SignOutButton } from "@/components/group/sign-out-button";
import { DownloadAppButton } from "@/components/coach/desktop/download-app-button";
import { ViewAsClientButton } from "@/components/coach/desktop/view-as-client-button";
import { ViewModeToggle } from "@/components/coach/view-mode-toggle";
import { createBrowserClient } from "@/lib/supabase/client";
import { TerminologyProvider } from "@/components/coach/terminology-provider";
import { SwappableTerm } from "@/components/coach/swappable-term";
import { ShellRail, type RailIcon } from "@/components/coach/desktop/shell-rail";
import { ClientsRailWidget } from "@/components/coach/desktop/rail-widgets/clients-rail-widget";
import { MessagesRailWidget } from "@/components/coach/desktop/rail-widgets/messages-rail-widget";
import { FeedRailWidget } from "@/components/coach/desktop/rail-widgets/feed-rail-widget";
import { CalendarRailWidget } from "@/components/coach/desktop/rail-widgets/calendar-rail-widget";
import { TeamRailWidget } from "@/components/coach/desktop/rail-widgets/team-rail-widget";
import { BusinessRailWidget } from "@/components/coach/desktop/rail-widgets/business-rail-widget";
import { ShellListPanel, type SectionSubLink } from "@/components/coach/desktop/shell-list-panel";
import { BottomTabBar } from "@/components/athlete/bottom-tab-bar";
import { CoachMoreSheet } from "@/components/coach/mobile/coach-more-sheet";

function NavBadge({ count, collapsed }: { count: number; collapsed?: boolean }) {
  if (count <= 0) return null;
  if (collapsed) {
    return (
      <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-rust" />
    );
  }
  return (
    <span className="ml-auto h-5 min-w-[20px] px-1 rounded-full bg-rust text-graphite font-body text-[10px] font-bold flex items-center justify-center">
      {count > 9 ? "9+" : count}
    </span>
  );
}


type Active =
  | "home"
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
  | "branding"
  | "business"
  | "packages"
  | "waiver"
  | "support"
  | "sms-settings"
  | "zapier"
  | "session-types"
  | "session-ledger"
  | "resources"
  | "challenges"
  | "team"
  | "team-calendar"
  | "game-detail"
  | "team-performance"
  | "messages"
  | "records";

interface NavLeaf {
  key: Active;
  label: string;
  href: string;
  icon: typeof LayoutGrid;
  badge?: number;
  // When set, the nav label renders as a SwappableTerm (word-swap
  // terminology system) instead of the plain `label` string — `label`
  // still doubles as the collapsed-state tooltip title.
  termKey?: import("@/lib/terminology").TermKey;
  termForm?: import("@/lib/terminology").TermForm;
}

interface NavGroup {
  label: string;
  icon: typeof LayoutGrid;
  items: NavLeaf[];
}

type NavEntry = NavLeaf | NavGroup;

function isGroup(entry: NavEntry): entry is NavGroup {
  return "items" in entry;
}

export function CoachDesktopShell({
  groupId,
  groupName,
  active,
  children,
}: {
  groupId: string;
  groupName: string;
  active: Active;
  children: React.ReactNode;
}) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [feedUnread, setFeedUnread] = useState(0);
  const [clientsUnread, setClientsUnread] = useState(0);
  const [messagesUnread, setMessagesUnread] = useState(0);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [openSupportCount, setOpenSupportCount] = useState(0);
  const [teamMode, setTeamMode] = useState(false);
  const [groupKind, setGroupKind] = useState<"one_on_one" | "social" | "team" | null>(null);
  const [orgName, setOrgName] = useState<string | null>(null);
  // Concept 8 "Familiar" shell redesign (coach_desktop_shell_identity_
  // redesign.md) — the rail + list panel need the viewer's own id for
  // the pinned Needs Attention strip's fetch.
  const [coachId, setCoachId] = useState<string | null>(null);
  // stale_client_name_header_bug.md, root cause #2 — a coach standing in
  // a client's mobile experience ("View as Client") can end up with that
  // state still active up to 12 hours later on desktop, with no signal
  // in the persistent chrome (only the ~15 individual pages that happen
  // to check the httpOnly cookie themselves show a banner, and plenty of
  // real desktop pages — Dashboard, Clients, Programs, Business — never
  // did). Checked here instead, once, so it's visible everywhere the
  // shell renders regardless of whether that specific page's own data
  // fetch cares about acting-as state.
  const [actingAsName, setActingAsName] = useState<string | null>(null);
  const router = useRouter();

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
    async function run() {
      const supabase = createBrowserClient();
      const { data } = await supabase
        .from("groups")
        .select("team_mode, group_kind, organizations ( name )")
        .eq("id", groupId)
        .maybeSingle();
      if (!cancelled) {
        setTeamMode(data?.team_mode ?? false);
        setGroupKind((data?.group_kind as "one_on_one" | "social" | "team" | null) ?? "team");
        setOrgName((data as any)?.organizations?.name ?? null);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [groupId]);

  // stale_client_name_header_bug.md, root cause #2 — see actingAsName's
  // own comment above. The httpOnly acting-as cookie can't be read here
  // directly, so this asks the one place that can (a small GET on the
  // same route the mobile "View as Client" picker already posts to).
  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        const res = await fetch(`/api/coach/act-as?groupId=${encodeURIComponent(groupId)}`);
        const data = await res.json();
        if (!cancelled) setActingAsName(data.isActingAsOther ? data.athleteName : null);
      } catch {
        // Network hiccup — fail closed (no banner) rather than crash the shell.
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [groupId]);

  // Platform-admin-only "Organizations" link — visible only to the one
  // account flagged profiles.is_platform_admin, so an ordinary coach never
  // sees this at all.
  useEffect(() => {
    let cancelled = false;
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
  }, []);

  async function handleExitActingAs() {
    await fetch("/api/coach/act-as", { method: "DELETE" });
    setActingAsName(null);
    router.refresh();
  }

  // Remembers the last group this coach actually looked at, so the
  // cross-group Home dashboard (app/dashboard/page.tsx) can default its
  // own sidebar to somewhere real instead of showing no nav at all.
  // Non-httpOnly on purpose — this is UI convenience, not access control,
  // and the server-rendered Home page needs to read it via cookies().
  useEffect(() => {
    try {
      document.cookie = `last_group=${encodeURIComponent(
        JSON.stringify({ id: groupId, name: groupName })
      )}; path=/; max-age=${60 * 60 * 24 * 90}`;
    } catch {
      // Non-fatal — Home just falls back to its minimal shell.
    }
  }, [groupId, groupName]);

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
        await supabase.from("coach_view_state").upsert(
          { coach_id: user.id, group_id: groupId, feed_seen_at: nowIso, clients_seen_at: nowIso },
          { onConflict: "coach_id,group_id" }
        );
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
        await supabase
          .from("coach_view_state")
          .update(patch)
          .eq("coach_id", user.id)
          .eq("group_id", groupId);
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
  }, [groupId, active]);

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
  }, [groupId, active]);

  // Close the mobile drawer on every route change (active section change)
  // so navigating doesn't leave the overlay stuck open.
  useEffect(() => {
    setMobileNavOpen(false);
  }, [active]);

  // Regrouped by function (Run my day / Build / Business / Engage)
  // instead of the order features happened to get built in — see the
  // "Reorganize the coach desktop sidebar" pass. Home itself lives
  // outside this array entirely (rendered as its own fixed link above
  // GroupSwitcher below) — it's already the flattest, first-reached
  // item, which is exactly what "Run my day" wants for it.
  const nav: NavEntry[] = [
    // Run my day — the highest-frequency items, flat, no group/extra
    // click to reach any of them. Team Performance sits right next to
    // Dashboard (not folded into a new group) since it's a light,
    // roster-wide insights page every coach can use, not just team-mode
    // groups — gating it behind a group would hide something that's
    // reachable today for anyone who isn't running a team sport.
    { key: "dashboard", label: "Dashboard", href: `/groups/${groupId}/dashboard`, icon: LayoutDashboard },
    { key: "team-performance", label: "Team Performance", href: `/groups/${groupId}/team-performance`, icon: Activity },
    { key: "clients", label: "Clients", href: `/groups/${groupId}/clients`, icon: Users, badge: clientsUnread, termKey: "client", termForm: "plural" },
    { key: "messages", label: "Messages", href: `/groups/${groupId}/messages`, icon: Mail, badge: messagesUnread },
    { key: "feed", label: "Team Feed", href: `/groups/${groupId}/feed`, icon: MessagesSquare, badge: feedUnread },
    { key: "calendar", label: "Calendar", href: `/groups/${groupId}/calendar`, icon: CalendarDays },

    // Build — creation/authoring tools, kept as their own adjacent
    // collapsible groups (not merged into one literal "Build" super-
    // group) so this reuses the exact same NavGroup shape/behavior
    // already proven for Business, rather than inventing nested
    // sub-sections the component doesn't support today.
    {
      label: "Programming",
      icon: LayoutGrid,
      items: [
        { key: "programs", label: "Programs", href: `/groups/${groupId}/programs`, icon: LayoutGrid, termKey: "program", termForm: "plural" },
        { key: "exercise-library", label: "Exercise Library", href: `/groups/${groupId}/exercise-library`, icon: Dumbbell },
      ],
    },
    {
      label: "Nutrition",
      icon: ChefHat,
      items: [
        { key: "recipes", label: "Recipe Hub", href: `/groups/${groupId}/recipes`, icon: ChefHat },
        { key: "nutrition", label: "Meal Plans", href: `/groups/${groupId}/nutrition`, icon: Salad },
      ],
    },
    ...(teamMode
      ? [
          {
            label: "Team",
            icon: ClipboardList,
            items: [
              { key: "team" as const, label: "Depth Chart", href: `/groups/${groupId}/team`, icon: ClipboardList },
              { key: "team-calendar" as const, label: "Team Calendar", href: `/groups/${groupId}/team/calendar`, icon: CalendarDays },
            ],
          },
        ]
      : []),

    // Business — unchanged, plus Availability (real bug fix: this route
    // existed with no nav entry anywhere, reachable only by typing the
    // URL directly).
    {
      label: "Business",
      icon: TrendingUp,
      items: [
        { key: "business", label: "Overview", href: `/groups/${groupId}/business`, icon: TrendingUp },
        { key: "packages", label: "Packages", href: `/groups/${groupId}/business/packages`, icon: Layers },
        { key: "waiver", label: "Waiver", href: `/groups/${groupId}/business/waiver`, icon: ClipboardList },
        { key: "availability", label: "Availability", href: `/groups/${groupId}/availability`, icon: CalendarClock },
        { key: "support", label: "Support", href: `/groups/${groupId}/business/support`, icon: HeartHandshake },
        { key: "sms-settings", label: "SMS Notifications", href: `/groups/${groupId}/business/sms-settings`, icon: MessageCircle },
        { key: "zapier", label: "Zapier", href: `/groups/${groupId}/business/zapier`, icon: Zap },
        { key: "session-ledger", label: "Session Ledger", href: `/groups/${groupId}/business/session-ledger`, icon: Wallet },
        { key: "session-types", label: "Session Types", href: `/groups/${groupId}/business/session-types`, icon: Tag },
        { key: "branding", label: "Organization", href: `/groups/${groupId}/branding`, icon: Palette },
      ],
    },

    // Engage — lighter, occasional-use surfaces, no longer sitting
    // between Team Feed and Calendar the way they used to.
    {
      label: "Engage",
      icon: Flag,
      items: [
        { key: "challenges", label: "Challenges", href: `/groups/${groupId}/challenges`, icon: Flag },
        { key: "records", label: "Hall of Fame", href: `/groups/${groupId}/records`, icon: Trophy },
        { key: "resources", label: "Resources", href: `/groups/${groupId}/resources`, icon: HeartHandshake },
      ],
    },
  ];

  const groupHasActiveChild = (group: NavGroup) => group.items.some((i) => i.key === active);

  // Concept 8 "Familiar" shell redesign — resolves this feature's own
  // flagged open gap ("rail icon-to-destination map is placeholder")
  // with a real IA: one rail icon per real top-level destination this
  // shell's own `nav` array already defines, reusing its hrefs/icons/
  // badges verbatim rather than inventing a parallel structure. A group
  // (Programming, Business, etc.) becomes one icon pointing at its first
  // item; every group's other items stay reachable via the small
  // section sub-nav the list panel renders when that section is active.
  // Hover rail widgets (hover_expand_rail_widgets_idea.md) — a
  // glanceable popover per icon, decided per-icon by Ron directly: no
  // widget at all for Programming (his own call, no obvious glanceable
  // metric there) or any icon not named below, matching the confirmed
  // spec exactly rather than guessing one onto every icon.
  const flatWidgetByKey: Partial<Record<Active, React.ReactNode>> = {
    clients: <ClientsRailWidget groupId={groupId} />,
    messages: <MessagesRailWidget groupId={groupId} />,
    feed: <FeedRailWidget groupId={groupId} />,
    calendar: <CalendarRailWidget groupId={groupId} />,
    "team-performance": <TeamRailWidget groupId={groupId} />,
  };

  const railIcons: RailIcon[] = nav.map((entry) => {
    if (!isGroup(entry)) {
      return {
        key: entry.key,
        label: entry.label,
        href: entry.href,
        icon: entry.icon,
        active: active === entry.key,
        badge: entry.badge,
        popover: flatWidgetByKey[entry.key],
      };
    }
    const first = entry.items[0];
    return {
      key: `group:${entry.label}`,
      label: entry.label,
      href: first.href,
      icon: entry.icon,
      active: groupHasActiveChild(entry),
      popover: entry.label === "Business" ? <BusinessRailWidget groupId={groupId} /> : undefined,
    };
  });

  const activeGroup = nav.find((entry): entry is NavGroup => isGroup(entry) && groupHasActiveChild(entry));

  // Coach mobile tab bar (coach_mobile_app_redesign_plan.md) — the three
  // sections that are real bottom tabs light their own tab; everything
  // else reached through this shell (Dashboard, Build, Business, Engage)
  // is, by definition, reached through the "More" sheet, so it lights
  // "More" instead of nothing.
  const mobileTabOverride =
    active === "clients" ? "roster" : active === "messages" ? "messages" : active === "calendar" ? "calendar" : "more";
  const sectionLabel = activeGroup?.label ?? null;
  const sectionSubLinks: SectionSubLink[] =
    activeGroup?.items.map((item) => ({
      key: item.key,
      label: item.label,
      href: item.href,
      active: active === item.key,
    })) ?? [];

  return (
    <TerminologyProvider groupId={groupId}>
    <div className="min-h-screen bg-graphite text-chalk font-body">
      {/* Persistent top bar — always visible regardless of sidebar state,
          on every viewport. Houses the mobile nav toggle and the "View as
          Client" jump, since both need to stay reachable without scrolling
          or hunting through the sidebar. */}
      <header className="sticky top-0 z-30 h-14 flex items-center gap-3 px-3 md:px-4 border-b border-steel/20 bg-graphite">
        {/* Always visible, not just on mobile — the sidebar's own name
            label is easy to miss when your eyes are on the main content,
            and picking up someone else's client/program by mistake is a
            real risk this exists to head off. */}
        <div className="flex items-center gap-1.5 min-w-0">
          {/* "You're in: org -> group" — a coach who administers more than
              one organization otherwise has no reliable way to tell which
              org's data/branding a page belongs to just by looking, which
              is exactly the confusion that led to the org-scoping bug this
              indicator exists to guard against going forward. Only renders
              once the org name has loaded, so it never flashes empty. */}
          {orgName && (
            <>
              <span
                className="hidden sm:inline font-body text-xs md:text-sm text-steel truncate max-w-[10rem] md:max-w-[16rem]"
                title={orgName}
              >
                {orgName}
              </span>
              <ChevronRight className="hidden sm:inline w-3.5 h-3.5 text-steel/50 shrink-0" />
            </>
          )}
          <p className="font-display font-bold text-lg md:text-2xl uppercase tracking-wide truncate">
            {groupName}
          </p>
          {groupKind && (
            <span
              className={`shrink-0 font-body text-[10px] uppercase tracking-wide px-1.5 py-0.5 border ${
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
          <DownloadAppButton variant="topbar" />
          <ViewAsClientButton groupId={groupId} />
        </div>
      </header>

      {/* stale_client_name_header_bug.md, root cause #1 — a 1-on-1
          client's relationship IS a groups row named after them, so
          clicking into one silently changes "current group" to that
          client with only a small singular/plural badge word as the
          signal. That's too easy to miss (this is exactly what produced
          Ron's "Enduring Strength Co. > Johann Gorsek [Client]"
          breadcrumb confusion) — a real, unmissable, persistent banner
          instead, with a one-click way back to the coach's actual
          org/team context. */}
      {/* Both stacked in one sticky container (rather than each being
          independently sticky) since they're two independent conditions
          that can both be true at once — a coach acting-as-client
          inside a one-on-one group's own shell — and each being
          separately `sticky top-14` would overlap instead of stacking. */}
      {(groupKind === "one_on_one" || actingAsName) && (
        <div className="sticky top-14 z-20">
          {groupKind === "one_on_one" && (
            <div className="flex items-center justify-between gap-3 px-3 md:px-4 py-1.5 bg-rust/10 border-b border-rust/30">
              <p className="font-body text-xs text-rust truncate">
                You&apos;re in <span className="font-medium">{groupName}</span>&apos;s workspace, not{" "}
                {orgName ?? "your team"}&apos;s.
              </p>
              <Link
                href="/dashboard"
                className="shrink-0 font-body text-xs text-rust underline underline-offset-2"
              >
                Back to Home
              </Link>
            </div>
          )}

          {/* stale_client_name_header_bug.md, root cause #2 — a real,
              shell-wide "Viewing as" signal, not just the ~15 pages that
              separately checked for this before. Not gated on `active`,
              so it shows on Dashboard/Clients/Programs/Business too. */}
          {actingAsName && (
            <div className="flex items-center justify-between gap-3 px-3 md:px-4 py-1.5 bg-yellow-500/10 border-b border-yellow-500/30">
              <p className="font-body text-xs text-yellow-500 truncate">
                Viewing as <span className="font-medium">{actingAsName}</span>.
              </p>
              <button
                type="button"
                onClick={handleExitActingAs}
                className="shrink-0 font-body text-xs text-yellow-500 underline underline-offset-2"
              >
                Exit
              </button>
            </div>
          )}
        </div>
      )}

      <div className="flex">
        {/* Concept 8 "Familiar" shell redesign — Discord/YouTube-inspired
            icon rail (always 64px, never collapses) + a resizable/
            collapsible list panel (roster, pinned Needs Attention strip,
            picture-in-picture Business mini-dashboard). Desktop/tablet
            only — mobile keeps the existing off-canvas drawer below,
            unchanged, since this redesign is explicitly scoped to the
            desktop shell. */}
        <ShellRail
          icons={[
            { key: "home", label: "Home", href: "/dashboard", icon: Home, active: active === "home" },
            ...railIcons,
          ]}
          footer={
            <>
              <a
                href={`/groups/${groupId}/display`}
                target="_blank"
                rel="noopener noreferrer"
                title="Display Mode"
                className="w-11 h-11 flex items-center justify-center text-steel active:text-chalk"
              >
                <MonitorPlay className="w-4 h-4" strokeWidth={2.25} />
              </a>
              <ViewModeToggle
                targetMode="mobile"
                label="Client-Facing Mode"
                title="Client-Facing Mode — preview your own generic client shell (not a specific client's data; for that, use View as Client)"
                collapsed
                groupId={groupId}
              />
              {isPlatformAdmin && (
                <>
                  <Link
                    href="/admin/organizations"
                    title="Organizations"
                    className="w-11 h-11 flex items-center justify-center text-steel active:text-chalk"
                  >
                    <Building2 className="w-4 h-4" strokeWidth={2.25} />
                  </Link>
                  <Link
                    href="/admin/support"
                    title="Support Inbox"
                    className="relative w-11 h-11 flex items-center justify-center text-steel active:text-chalk"
                  >
                    <HeartHandshake className="w-4 h-4" strokeWidth={2.25} />
                    <NavBadge count={openSupportCount} collapsed />
                  </Link>
                </>
              )}
              <DownloadAppButton collapsed />
              <div className="w-11 flex items-center justify-center">
                <SignOutButton />
              </div>
            </>
          }
        />
        {coachId && (
          <ShellListPanel
            coachId={coachId}
            groupId={groupId}
            sectionLabel={sectionLabel}
            sectionSubLinks={sectionSubLinks}
          />
        )}

        {/* Coach mobile tab bar (coach_mobile_app_redesign_plan.md) —
            replaces the old off-canvas drawer as the primary mobile nav;
            "More" opens the reorganized CoachMoreSheet below instead of
            the full legacy sidebarContent list. Desktop/tablet keeps the
            rail + list panel above, unchanged. */}
        <div className="lg:hidden">
          <BottomTabBar
            groupId={groupId}
            variant="coach"
            activeOverride={mobileTabOverride}
            onMoreClick={() => setMobileNavOpen(true)}
          />
          {mobileNavOpen && (
            <CoachMoreSheet groupId={groupId} groupName={groupName} onClose={() => setMobileNavOpen(false)} />
          )}
        </div>

        <main className="flex-1 min-w-0 px-4 pt-6 pb-24 md:px-10 md:pt-8 lg:pb-8 max-w-[1400px]">{children}</main>
      </div>
    </div>
    </TerminologyProvider>
  );
}
