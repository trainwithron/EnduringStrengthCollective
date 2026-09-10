import Link from "next/link";
import { Home } from "lucide-react";
import { SignOutButton } from "@/components/group/sign-out-button";
import { DownloadAppButton } from "@/components/coach/desktop/download-app-button";

// A dedicated, minimal shell for the one cross-group page in the app —
// not a retrofit of CoachDesktopShell, which has a lot of group-keyed
// data-fetching (unread badges, team_mode) that a truly group-agnostic
// page has no use for. No GroupSwitcher here either: this page's own
// three sections already are the full group directory, so a dropdown
// would be redundant.
export function CoachHomeShell({ orgName, children }: { orgName: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-graphite text-chalk flex">
      <aside className="w-60 shrink-0 border-r border-steel/20 flex flex-col">
        <div className="px-5 pt-6 pb-5 border-b border-steel/20">
          <p className="font-body text-[11px] text-steel uppercase tracking-wide">Coaching</p>
          <h1 className="font-display font-bold text-lg uppercase leading-tight truncate mt-1">{orgName}</h1>
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
          <DownloadAppButton />
          <SignOutButton />
        </div>
      </aside>
      <main className="flex-1 px-8 py-8 max-w-5xl">{children}</main>
    </div>
  );
}
