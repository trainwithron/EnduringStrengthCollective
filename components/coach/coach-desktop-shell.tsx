"use client";

import { useState } from "react";
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
