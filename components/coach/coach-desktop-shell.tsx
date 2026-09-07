"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  LayoutGrid,
  Dumbbell,
  Calculator,
  ChevronDown,
  ChevronRight,
  CalendarClock,
  CalendarDays,
  MessagesSquare,
  Users,
} from "lucide-react";
import { SignOutButton } from "@/components/group/sign-out-button";
import { createBrowserClient } from "@/lib/supabase/client";

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
  | "programs"
  | "exercise-library"
  | "tools"
  | "availability"
  | "calendar"
  | "feed"
  | "clients";

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
    active === "programs" || active === "exercise-library" || active === "tools";
  const [programmingOpen, setProgrammingOpen] = useState(true);
  const [feedUnread, setFeedUnread] = useState(0);
  const [clientsUnread, setClientsUnread] = useState(0);

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
    {
      key: "tools",
      label: "1RM Calculator",
      href: `/groups/${groupId}/tools/one-rep-max`,
      icon: Calculator,
    },
  ];

  return (
    <div className="min-h-screen bg-graphite text-chalk font-body flex">
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
            href={`/groups/${groupId}/availability`}
            className={`flex items-center gap-3 px-5 h-11 font-body text-sm transition-colors ${
              active === "availability"
                ? "text-rust bg-rust/10 border-r-2 border-rust"
                : "text-steel active:text-chalk"
            }`}
          >
            <CalendarClock className="w-4 h-4 shrink-0" strokeWidth={2.25} />
            Availability
          </Link>

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
        </nav>

        <div className="px-5 py-4 border-t border-steel/20">
          <SignOutButton />
        </div>
      </aside>

      <main className="flex-1 min-w-0 px-10 py-8 max-w-[1400px]">{children}</main>
    </div>
  );
}
