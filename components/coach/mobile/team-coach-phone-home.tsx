import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { createServerClient } from "@/lib/supabase/server";
import { ViewModeToggle } from "@/components/coach/view-mode-toggle";
import { CoachMobileShell } from "./coach-mobile-shell";
import { teamPhoneHome, type TeamPhoneProgram } from "@/lib/team-phone-home";

// The coach home on a PHONE for a team-sport group. A football coach opens this to see the team's program and to get to the team: nothing about money, no "add your first client" nag (a team may never have a client in
// the app: it can be a coach printing workouts and keeping paper copies), no "Start workout" block, no Needs attention strip, no desktop-mode button as a main thing. Everything else is under ONE "More tools".
export async function TeamCoachPhoneHome({ groupId, groupName }: { groupId: string; groupName: string }) {
  const supabase = await createServerClient();
  const { data: rows } = await supabase
    .from("programs")
    .select("id, name, workouts ( week_number, day_index )")
    .eq("group_id", groupId)
    .is("athlete_id", null)
    .is("archived_at", null)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1);
  const first = ((rows ?? []) as { id: string; name: string; workouts: { week_number: number | null; day_index: number | null }[] | null }[])[0] ?? null;
  const program: TeamPhoneProgram | null = first ? { id: first.id, name: first.name, workouts: first.workouts ?? [] } : null;
  const home = teamPhoneHome({ groupId, program });

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body pb-24">
      <CoachMobileShell groupId={groupId} groupName={groupName}>
        <header className="px-5 pt-16 pb-4">
          <h1 className="font-display font-bold text-3xl leading-none uppercase truncate">{groupName}</h1>
        </header>

        <section className="px-5 pb-5" aria-label="Active program">
          {home.program ? (
            <Link href={home.program.href} className="block border border-rust bg-rust/10 p-5 active:bg-rust/15 transition-colors">
              <p className="font-body text-xs text-rust uppercase tracking-wide font-bold">Active program</p>
              <p className="font-display font-bold text-2xl leading-tight mt-1">{home.program.name}</p>
              <p className="font-body text-sm text-steel mt-1">{home.program.summary}</p>
              <span className="inline-block mt-4 h-11 px-5 leading-[2.75rem] bg-rust text-graphite font-body font-bold text-sm">Open the full program &rarr;</span>
            </Link>
          ) : (
            <div className="border border-steel/25 p-5">
              <p className="font-body text-sm text-chalk">No program yet.</p>
              <Link href={home.newProgramHref} className="inline-block mt-3 h-11 px-5 leading-[2.75rem] bg-rust text-graphite font-body font-bold text-sm">
                Build a program
              </Link>
            </div>
          )}
        </section>

        <nav aria-label="Team" className="px-5 pb-5">
          <ul className="border border-steel/20 divide-y divide-steel/15">
            {home.links.map((l) => (
              <li key={l.key}>
                <Link href={l.href} className="flex items-center justify-between h-14 px-4 font-body text-base active:bg-surface/60">
                  {l.label}
                  <span className="text-steel">&rsaquo;</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <details className="mx-5 mb-8 border border-steel/20">
          <summary className="flex items-center justify-between h-14 px-4 font-body text-base cursor-pointer list-none [&::-webkit-details-marker]:hidden">
            More tools
            <ChevronDown className="w-4 h-4 text-steel" strokeWidth={2.25} />
          </summary>
          <ul className="border-t border-steel/15 divide-y divide-steel/15">
            {home.moreLinks.map((l) => (
              <li key={l.key}>
                <Link href={l.href} className="flex items-center h-12 px-4 font-body text-sm text-chalk active:bg-surface/60">
                  {l.label}
                </Link>
              </li>
            ))}
            <li className="px-4 py-2">
              <ViewModeToggle targetMode="desktop" label="Desktop mode" groupId={groupId} />
            </li>
          </ul>
        </details>
      </CoachMobileShell>
    </main>
  );
}

