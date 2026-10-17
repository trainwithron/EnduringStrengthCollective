"use client";

import Link from "next/link";
import { EmbeddedActivityReporter } from "@/components/coach/workspace/embedded-activity-reporter";
import { useEmbedded } from "@/components/shared/embedded-context";
import { Home } from "lucide-react";
import { SignOutButton } from "@/components/group/sign-out-button";
import { DownloadAppButton } from "@/components/coach/desktop/download-app-button";
import { TerminologyProvider } from "@/components/coach/terminology-provider";
import { ExitDesktopModeButton } from "@/components/coach/exit-desktop-mode-button";
import { ClientFinder } from "@/components/coach/desktop/client-finder";
import { HeaderNotificationBell } from "@/components/notifications/header-bell";
import { CollectiveIntelligenceChat } from "@/components/coach/desktop/collective-intelligence-chat";
import { CoachHomeMobileMenu } from "@/components/coach/coach-home-mobile-menu";

// A dedicated, minimal shell for the one cross-group page in the app —
// not a retrofit of CoachDesktopShell, which has a lot of group-keyed
// data-fetching (unread badges, team_mode) that a truly group-agnostic
// page has no use for. No GroupSwitcher here either: this page's own
// three sections already are the full group directory, so a dropdown
// would be redundant.
function CoachHomeShellFull({ orgName, children }: { orgName: string; children: React.ReactNode }) {
  return (
    <TerminologyProvider>
    <div className="min-h-screen bg-graphite text-chalk lg:flex">
      {/* On a phone the 240px sidebar would take two thirds of the screen: it becomes a slim top bar, and the sidebar returns from the lg breakpoint. */}
      <header className="lg:hidden flex items-center justify-between gap-3 px-4 min-h-14 border-b border-steel/20">
        <Link href="/dashboard" className="flex items-center gap-2 min-h-11 font-body text-sm text-rust">
          <Home className="w-4 h-4 shrink-0" strokeWidth={2.25} />
          Home
        </Link>
        <p className="font-display font-bold text-sm uppercase truncate">{orgName}</p>
        <div className="flex items-center">
          <HeaderNotificationBell placement="below" />
          <CoachHomeMobileMenu />
        </div>
      </header>
      <aside className="hidden lg:flex w-60 shrink-0 border-r border-steel/20 flex-col">
        <div className="px-5 pt-6 pb-5 border-b border-steel/20">
          <p className="font-body text-xs text-steel uppercase tracking-wide">Coaching</p>
          <h1 className="font-display font-bold text-lg uppercase leading-tight truncate mt-1">{orgName}</h1>
        </div>
        <div className="px-3 pt-3">
          <ClientFinder currentGroupId={null} align="left" />
        </div>
        <nav className="flex-1 py-3">
          <Link
            href="/dashboard"
            className="flex items-center gap-3 h-11 px-5 font-body text-sm text-rust bg-rust/10 border-r-2 border-rust"
          >
            <Home className="w-4 h-4 shrink-0" strokeWidth={2.25} />
            Home
          </Link>
        </nav>
        <div className="border-t border-steel/20 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <Link href="/notifications" className="font-body text-sm text-steel">Notifications</Link>
            <HeaderNotificationBell placement="above" />
          </div>
          <ExitDesktopModeButton />
          <DownloadAppButton />
          <SignOutButton />
        </div>
      </aside>
      <main className="flex-1 min-w-0 px-4 py-6 lg:px-8 lg:py-8 max-w-5xl">{children}</main>
      {/* Same "available everywhere" mount as CoachDesktopShell, so the
          brand-new-coach fallback branch of Home isn't missing it. */}
      {/* Desktop-only edge tab: on phones the Spotlight hub is the single entry,
          so hide this one below lg (position:fixed still hides with its wrapper). */}
      <div className="hidden lg:block">
        <CollectiveIntelligenceChat />
      </div>
    </div>
    </TerminologyProvider>
  );
}

// Shown inside a workspace pane: just the content (see components/shared/embedded-context.tsx).
export function CoachHomeShell(props: { orgName: string; children: React.ReactNode }) {
  const embedded = useEmbedded();
  if (embedded) {
    return (
      <TerminologyProvider>
        <div data-embedded="1" className="min-h-screen bg-graphite text-chalk font-body">
          <EmbeddedActivityReporter />
          <main id="main-content" className="px-4 pt-4 pb-8">
            {props.children}
          </main>
        </div>
      </TerminologyProvider>
    );
  }
  return <CoachHomeShellFull {...props} />;
}
