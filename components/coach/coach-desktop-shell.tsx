"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  LayoutGrid,
  Dumbbell,
  ChevronDown,
  ChevronRight,
  CalendarDays,
  MessagesSquare,
  Users,
  LayoutDashboard,
  Palette,
  TrendingUp,
  HeartHandshake,
  Flag,
  Trophy,
  Split,
  ChefHat,
  Smartphone,
} from "lucide-react";
import { SignOutButton } from "@/components/group/sign-out-button";
import { DownloadAppButton } from "@/components/coach/desktop/download-app-button";
import { createBrowserClient } from "@/lib/supabase/client";
import { BUTTON_SHAPE_RADIUS, type ButtonShape, type DisplayFont, type BodyFont } from "@/lib/theme";

function NavBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="ml-auto h-5 min-w-[20px] px-1 rounded-full bg-rust text-graphite font-body text-[10px] font-bold flex items-center justify-center">
      {count > 9 ? "9+" : count}
    </span>
  );
}

const SIDEBAR_WIDTH = 240;

type Active =
  | "dashboard"
  | "programs"
  | "exercise-library"
  | "recipes"
  | "tools"
  | "availability"
  | "calendar"
  | "feed"
  | "clients"
  | "branding"
  | "business"
  | "referrals"
  | "challenges"
  | "leaderboard"
  | "revenue-splits";

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
  const programmingActive =
    active === "programs" || active === "exercise-library" || active === "recipes";
  const [programmingOpen, setProgrammingOpen] = useState(true);
  const businessActive =
    active === "business" || active === "branding" || active === "revenue-splits";
  const [businessOpen, setBusinessOpen] = useState(true);
  const [feedUnread, setFeedUnread] = useState(0);
  const [clientsUnread, setClientsUnread] = useState(0);
  const [branding, setBranding] = useState<{
    buttonShape: ButtonShape;
    accentColor: string;
    backgroundColor: string;
    textColor: string;
    fontDisplay: DisplayFont;
    fontBody: BodyFont;
  } | null>(null);

  // Organization-wide desktop branding (button shape, colors, fonts) —
  // every coach in the same organization shares one visual identity.
  // Applied as CSS custom properties on this shell's own root element,
  // so it never touches the athlete mobile app, which never renders
  // inside this component.
  useEffect(() => {
    let cancelled = false;
    async function run() {
      const supabase = createBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data: membership } = await supabase
        .from("organization_memberships")
        .select("organization_id")
        .eq("profile_id", user.id)
        .limit(1)
        .maybeSingle();
      if (!membership) return;
      const { data } = await supabase
        .from("organizations")
        .select("button_shape, accent_color, background_color, text_color, font_display, font_body")
        .eq("id", membership.organization_id)
        .maybeSingle();
      if (cancelled) return;
      setBranding({
        buttonShape: (data?.button_shape as ButtonShape) ?? "sharp",
        accentColor: data?.accent_color ?? "#C4622D",
        backgroundColor: data?.background_color ?? "#1C1B1A",
        textColor: data?.text_color ?? "#EDE8E0",
        fontDisplay: (data?.font_display as DisplayFont) ?? "Barlow Condensed",
        fontBody: (data?.font_body as BodyFont) ?? "Inter",
      });
    }
    run();
    return () => {
      cancelled = true;
    };
  }, []);

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
      } else if (active === "feed" || active === "clients") {
        const patch =
          active === "feed" ? { feed_seen_at: nowIso } : { clients_seen_at: nowIso };
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

  const programmingItems: { key: Active; label: string; href: string; icon: typeof LayoutGrid }[] = [
    { key: "programs", label: "Programs", href: `/groups/${groupId}/programs`, icon: LayoutGrid },
    {
      key: "exercise-library",
      label: "Exercise Library",
      href: `/groups/${groupId}/exercise-library`,
      icon: Dumbbell,
    },
    { key: "recipes", label: "Recipe Hub", href: `/groups/${groupId}/recipes`, icon: ChefHat },
  ];

  const businessItems: { key: Active; label: string; href: string; icon: typeof TrendingUp }[] = [
    { key: "business", label: "Overview", href: `/groups/${groupId}/business`, icon: TrendingUp },
    { key: "branding", label: "Organization", href: `/groups/${groupId}/branding`, icon: Palette },
    {
      key: "revenue-splits",
      label: "Revenue Splits",
      href: `/groups/${groupId}/revenue-splits`,
      icon: Split,
    },
  ];

  const brandingStyle = branding
    ? ({
        "--rust": branding.accentColor,
        "--graphite": branding.backgroundColor,
        "--chalk": branding.textColor,
        "--font-display": `"${branding.fontDisplay}"`,
        "--font-body": `"${branding.fontBody}"`,
        "--btn-radius": BUTTON_SHAPE_RADIUS[branding.buttonShape],
      } as React.CSSProperties)
    : undefined;

  return (
    <div
      className="coach-branded-shell min-h-screen bg-graphite text-chalk font-body flex"
      style={brandingStyle}
    >
      <aside
        className="shrink-0 border-r border-steel/20 flex flex-col"
        style={{ width: SIDEBAR_WIDTH }}
      >
        <div className="px-5 pt-6 pb-5 border-b border-steel/20">
          <p className="font-body text-[11px] text-steel uppercase tracking-wide">Coaching</p>
          <h1 className="font-display font-bold text-lg uppercase leading-tight mt-1">
            {groupName}
          </h1>
        </div>

        <nav className="flex-1 py-3">
          <Link
            href={`/groups/${groupId}/dashboard`}
            className={`flex items-center gap-3 px-5 h-11 font-body text-sm transition-colors ${
              active === "dashboard"
                ? "text-rust bg-rust/10 border-r-2 border-rust"
                : "text-steel active:text-chalk"
            }`}
          >
            <LayoutDashboard className="w-4 h-4 shrink-0" strokeWidth={2.25} />
            Dashboard
          </Link>

          <button
            type="button"
            onClick={() => setBusinessOpen((v) => !v)}
            className={`w-full flex items-center gap-3 px-5 h-11 font-body text-sm transition-colors ${
              businessActive && !businessOpen
                ? "text-rust bg-rust/10 border-r-2 border-rust"
                : "text-steel active:text-chalk"
            }`}
          >
            {businessOpen ? (
              <ChevronDown className="w-4 h-4 shrink-0" strokeWidth={2.25} />
            ) : (
              <ChevronRight className="w-4 h-4 shrink-0" strokeWidth={2.25} />
            )}
            Business
          </button>

          {businessOpen && (
            <div>
              {businessItems.map((item) => {
                const Icon = item.icon;
                const isActive = active === item.key;
                return (
                  <Link
                    key={item.key}
                    href={item.href}
                    className={`flex items-center gap-3 pl-11 pr-5 h-10 font-body text-sm transition-colors ${
                      isActive
                        ? "text-rust bg-rust/10 border-r-2 border-rust"
                        : "text-steel active:text-chalk"
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5 shrink-0" strokeWidth={2.25} />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          )}

          <Link
            href={`/groups/${groupId}/clients`}
            className={`flex items-center gap-3 px-5 h-11 font-body text-sm transition-colors ${
              active === "clients"
                ? "text-rust bg-rust/10 border-r-2 border-rust"
                : "text-steel active:text-chalk"
            }`}
          >
            <Users className="w-4 h-4 shrink-0" strokeWidth={2.25} />
            Clients
            <NavBadge count={clientsUnread} />
          </Link>

          <button
            type="button"
            onClick={() => setProgrammingOpen((v) => !v)}
            className={`w-full flex items-center gap-3 px-5 h-11 font-body text-sm transition-colors ${
              programmingActive && !programmingOpen
                ? "text-rust bg-rust/10 border-r-2 border-rust"
                : "text-steel active:text-chalk"
            }`}
          >
            {programmingOpen ? (
              <ChevronDown className="w-4 h-4 shrink-0" strokeWidth={2.25} />
            ) : (
              <ChevronRight className="w-4 h-4 shrink-0" strokeWidth={2.25} />
            )}
            Programming
          </button>

          {programmingOpen && (
            <div>
              {programmingItems.map((item) => {
                const Icon = item.icon;
                const isActive = active === item.key;
                return (
                  <Link
                    key={item.key}
                    href={item.href}
                    className={`flex items-center gap-3 pl-11 pr-5 h-10 font-body text-sm transition-colors ${
                      isActive
                        ? "text-rust bg-rust/10 border-r-2 border-rust"
                        : "text-steel active:text-chalk"
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5 shrink-0" strokeWidth={2.25} />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          )}

          <Link
            href={`/groups/${groupId}/calendar`}
            className={`flex items-center gap-3 px-5 h-11 font-body text-sm transition-colors ${
              active === "calendar"
                ? "text-rust bg-rust/10 border-r-2 border-rust"
                : "text-steel active:text-chalk"
            }`}
          >
            <CalendarDays className="w-4 h-4 shrink-0" strokeWidth={2.25} />
            Calendar
          </Link>

          <Link
            href={`/groups/${groupId}/feed`}
            className={`flex items-center gap-3 px-5 h-11 font-body text-sm transition-colors ${
              active === "feed"
                ? "text-rust bg-rust/10 border-r-2 border-rust"
                : "text-steel active:text-chalk"
            }`}
          >
            <MessagesSquare className="w-4 h-4 shrink-0" strokeWidth={2.25} />
            Team Feed
            <NavBadge count={feedUnread} />
          </Link>

          <Link
            href={`/groups/${groupId}/leaderboard`}
            className={`flex items-center gap-3 px-5 h-11 font-body text-sm transition-colors ${
              active === "leaderboard"
                ? "text-rust bg-rust/10 border-r-2 border-rust"
                : "text-steel active:text-chalk"
            }`}
          >
            <Trophy className="w-4 h-4 shrink-0" strokeWidth={2.25} />
            Leaderboard
          </Link>

          <Link
            href={`/groups/${groupId}/challenges`}
            className={`flex items-center gap-3 px-5 h-11 font-body text-sm transition-colors ${
              active === "challenges"
                ? "text-rust bg-rust/10 border-r-2 border-rust"
                : "text-steel active:text-chalk"
            }`}
          >
            <Flag className="w-4 h-4 shrink-0" strokeWidth={2.25} />
            Challenges
          </Link>

          <Link
            href={`/groups/${groupId}/referrals`}
            className={`flex items-center gap-3 px-5 h-11 font-body text-sm transition-colors ${
              active === "referrals"
                ? "text-rust bg-rust/10 border-r-2 border-rust"
                : "text-steel active:text-chalk"
            }`}
          >
            <HeartHandshake className="w-4 h-4 shrink-0" strokeWidth={2.25} />
            Referrals
          </Link>
        </nav>

        <div className="border-t border-steel/20 py-2">
          <DownloadAppButton />
        </div>
        <div className="px-5 py-4 border-t border-steel/20 space-y-3">
          <SignOutButton />
        </div>
      </aside>

      <main className="flex-1 min-w-0 px-10 py-8 max-w-[1400px]">{children}</main>
    </div>
  );
}
