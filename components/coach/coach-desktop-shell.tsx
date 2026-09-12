"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  LayoutGrid,
  Dumbbell,
  ChevronDown,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
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
  Menu,
  X,
  Building2,
  Layers,
  Home,
  MonitorPlay,
  Activity,
  CalendarClock,
} from "lucide-react";
import { SignOutButton } from "@/components/group/sign-out-button";
import { DownloadAppButton } from "@/components/coach/desktop/download-app-button";
import { GroupSwitcher } from "@/components/coach/desktop/group-switcher";
import { ViewAsClientButton } from "@/components/coach/desktop/view-as-client-button";
import { ViewModeToggle } from "@/components/coach/view-mode-toggle";
import { createBrowserClient } from "@/lib/supabase/client";

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

const SIDEBAR_WIDTH = 240;
const SIDEBAR_WIDTH_COLLAPSED = 68;
const COLLAPSE_STORAGE_KEY = "coach-sidebar-collapsed";

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
  | "resources"
  | "challenges"
  | "team"
  | "team-calendar"
  | "game-detail"
  | "team-performance";

interface NavLeaf {
  key: Active;
  label: string;
  href: string;
  icon: typeof LayoutGrid;
  badge?: number;
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
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    Business: true,
    Programming: true,
  });
  const [collapsed, setCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [feedUnread, setFeedUnread] = useState(0);
  const [clientsUnread, setClientsUnread] = useState(0);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [openSupportCount, setOpenSupportCount] = useState(0);
  const [teamMode, setTeamMode] = useState(false);
  const [groupKind, setGroupKind] = useState<"one_on_one" | "social" | "team" | null>(null);

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
      const { data } = await supabase.from("groups").select("team_mode, group_kind").eq("id", groupId).maybeSingle();
      if (!cancelled) {
        setTeamMode(data?.team_mode ?? false);
        setGroupKind((data?.group_kind as "one_on_one" | "social" | "team" | null) ?? "team");
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

  // Collapse state persists across visits — a coach who prefers the icon
  // rail shouldn't have to re-collapse it every page load.
  useEffect(() => {
    try {
      if (window.localStorage.getItem(COLLAPSE_STORAGE_KEY) === "1") setCollapsed(true);
    } catch {
      // Storage unavailable (private browsing, etc.) — default expanded.
    }
  }, []);

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

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(COLLAPSE_STORAGE_KEY, next ? "1" : "0");
      } catch {
        // Ignore — the toggle still works for this session.
      }
      return next;
    });
  }

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
    { key: "clients", label: "Clients", href: `/groups/${groupId}/clients`, icon: Users, badge: clientsUnread },
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
        { key: "programs", label: "Programs", href: `/groups/${groupId}/programs`, icon: LayoutGrid },
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
        { key: "resources", label: "Resources", href: `/groups/${groupId}/resources`, icon: HeartHandshake },
      ],
    },
  ];

  const groupHasActiveChild = (group: NavGroup) => group.items.some((i) => i.key === active);

  function renderLeaf(item: NavLeaf, { indented = false }: { indented?: boolean } = {}) {
    const isActive = active === item.key;
    const Icon = item.icon;
    if (collapsed) {
      return (
        <Link
          key={item.key}
          href={item.href}
          title={item.label}
          className={`relative flex items-center justify-center h-11 mx-2 my-0.5 transition-colors ${
            isActive ? "text-rust bg-rust/10" : "text-steel active:text-chalk"
          }`}
        >
          <Icon className="w-4 h-4 shrink-0" strokeWidth={2.25} />
          <NavBadge count={item.badge ?? 0} collapsed />
        </Link>
      );
    }
    return (
      <Link
        key={item.key}
        href={item.href}
        className={`flex items-center gap-3 h-11 font-body text-sm transition-colors ${
          indented ? "pl-11 pr-5 h-10" : "px-5"
        } ${isActive ? "text-rust bg-rust/10 border-r-2 border-rust" : "text-steel active:text-chalk"}`}
      >
        <Icon className={`shrink-0 ${indented ? "w-3.5 h-3.5" : "w-4 h-4"}`} strokeWidth={2.25} />
        {item.label}
        <NavBadge count={item.badge ?? 0} />
      </Link>
    );
  }

  function renderNav() {
    return nav.map((entry) => {
      if (!isGroup(entry)) return renderLeaf(entry);

      const open = openGroups[entry.label] ?? true;
      const hasActive = groupHasActiveChild(entry);

      if (collapsed) {
        // No room for a submenu in the icon rail — each item in the group
        // gets its own icon directly, flattened, rather than trying to fit
        // a flyout in this pass.
        return (
          <div key={entry.label}>
            {entry.items.map((item) => renderLeaf(item))}
          </div>
        );
      }

      return (
        <div key={entry.label}>
          <button
            type="button"
            onClick={() => setOpenGroups((prev) => ({ ...prev, [entry.label]: !open }))}
            className={`w-full flex items-center gap-3 px-5 h-11 font-body text-sm transition-colors ${
              hasActive && !open ? "text-rust bg-rust/10 border-r-2 border-rust" : "text-steel active:text-chalk"
            }`}
          >
            {open ? (
              <ChevronDown className="w-4 h-4 shrink-0" strokeWidth={2.25} />
            ) : (
              <ChevronRight className="w-4 h-4 shrink-0" strokeWidth={2.25} />
            )}
            {entry.label}
          </button>
          {open && <div>{entry.items.map((item) => renderLeaf(item, { indented: true }))}</div>}
        </div>
      );
    });
  }

  const sidebarContent = (
    <>
      <Link
        href="/dashboard"
        title="Home"
        className={`flex items-center gap-3 h-11 font-body text-sm border-b border-steel/20 transition-colors ${
          collapsed ? "justify-center" : "px-5"
        } ${active === "home" ? "text-rust bg-rust/10" : "text-steel active:text-chalk"}`}
      >
        <Home className="w-4 h-4 shrink-0" strokeWidth={2.25} />
        {!collapsed && "Home"}
      </Link>
      <GroupSwitcher groupId={groupId} groupName={groupName} collapsed={collapsed} />
      <nav className="flex-1 py-3 overflow-y-auto">{renderNav()}</nav>
      <div className={`border-t border-steel/20 py-2 ${collapsed ? "px-2" : "px-5"}`}>
        <a
          href={`/groups/${groupId}/display`}
          target="_blank"
          rel="noopener noreferrer"
          title="Display Mode"
          className={`flex items-center gap-2 font-body text-xs text-steel active:text-chalk ${
            collapsed ? "justify-center" : ""
          }`}
        >
          <MonitorPlay className="w-3.5 h-3.5 shrink-0" strokeWidth={2.25} />
          {!collapsed && "Display Mode"}
        </a>
      </div>
      <div className={`border-t border-steel/20 py-2 ${collapsed ? "px-2" : "px-5"}`}>
        <ViewModeToggle targetMode="mobile" label="Client-Facing Mode" collapsed={collapsed} />
      </div>
      {isPlatformAdmin && (
        <div className={`border-t border-steel/20 py-2 ${collapsed ? "px-2" : "px-5"} space-y-2`}>
          <Link
            href="/admin/organizations"
            title="Organizations"
            className={`flex items-center gap-2 font-body text-xs text-steel active:text-chalk ${
              collapsed ? "justify-center" : ""
            }`}
          >
            <Building2 className="w-3.5 h-3.5 shrink-0" strokeWidth={2.25} />
            {!collapsed && "Organizations"}
          </Link>
          <Link
            href="/admin/support"
            title="Support Inbox"
            className={`relative flex items-center gap-2 font-body text-xs text-steel active:text-chalk ${
              collapsed ? "justify-center" : ""
            }`}
          >
            <HeartHandshake className="w-3.5 h-3.5 shrink-0" strokeWidth={2.25} />
            {!collapsed && "Support Inbox"}
            <NavBadge count={openSupportCount} collapsed={collapsed} />
          </Link>
        </div>
      )}
      <div className="border-t border-steel/20 py-2">
        <DownloadAppButton collapsed={collapsed} />
      </div>
      <div className={`border-t border-steel/20 py-4 ${collapsed ? "px-2" : "px-5"}`}>
        <SignOutButton />
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-graphite text-chalk font-body">
      {/* Persistent top bar — always visible regardless of sidebar state,
          on every viewport. Houses the mobile nav toggle and the "View as
          Client" jump, since both need to stay reachable without scrolling
          or hunting through the sidebar. */}
      <header className="sticky top-0 z-30 h-14 flex items-center gap-3 px-3 md:px-4 border-b border-steel/20 bg-graphite">
        <button
          type="button"
          onClick={() => setMobileNavOpen(true)}
          className="lg:hidden w-9 h-9 flex items-center justify-center text-chalk shrink-0"
          aria-label="Open navigation"
        >
          <Menu className="w-5 h-5" />
        </button>
        <button
          type="button"
          onClick={toggleCollapsed}
          className="hidden lg:flex w-9 h-9 items-center justify-center text-steel shrink-0"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronsRight className="w-4 h-4" /> : <ChevronsLeft className="w-4 h-4" />}
        </button>
        {/* Always visible, not just on mobile — the sidebar's own name
            label is easy to miss when your eyes are on the main content,
            and picking up someone else's client/program by mistake is a
            real risk this exists to head off. */}
        <div className="flex items-center gap-2 min-w-0">
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
              {groupKind === "one_on_one" ? "Client" : groupKind === "social" ? "Social" : "Group"}
            </span>
          )}
        </div>
        <div className="ml-auto flex items-center gap-1.5 shrink-0">
          <DownloadAppButton variant="topbar" />
          <ViewAsClientButton groupId={groupId} />
        </div>
      </header>

      <div className="flex">
        {/* Desktop / tablet sidebar — always in-flow, width animates
            between the full and icon-rail states. */}
        <aside
          className="hidden lg:flex shrink-0 border-r border-steel/20 flex-col sticky top-14 h-[calc(100vh-56px)] transition-[width] duration-150"
          style={{ width: collapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH }}
        >
          {sidebarContent}
        </aside>

        {/* Mobile off-canvas drawer — hidden by default so the sidebar
            never eats half the screen on a phone; opened via the hamburger
            in the top bar above. */}
        {mobileNavOpen && (
          <div className="lg:hidden fixed inset-0 z-40 flex">
            <div
              className="absolute inset-0 bg-graphite/80"
              onClick={() => setMobileNavOpen(false)}
              aria-hidden="true"
            />
            <aside
              className="relative w-[280px] max-w-[85vw] h-full bg-graphite border-r border-steel/20 flex flex-col"
            >
              <div className="flex items-center justify-end px-3 h-14 border-b border-steel/20">
                <button
                  type="button"
                  onClick={() => setMobileNavOpen(false)}
                  className="w-9 h-9 flex items-center justify-center text-steel"
                  aria-label="Close navigation"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              {sidebarContent}
            </aside>
          </div>
        )}

        <main className="flex-1 min-w-0 px-4 py-6 md:px-10 md:py-8 max-w-[1400px]">{children}</main>
      </div>
    </div>
  );
}
