import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { createServerClient } from "@/lib/supabase/server";
import { CoachMobileShell } from "./coach-mobile-shell";
import { teamPhoneHome, type TeamPhoneProgram } from "@/lib/team-phone-home";
import { loadDoneAt } from "@/lib/program-pickup";

// The coach home on a PHONE for a team-sport group. A football coach opens this to see the team's programs and to get to the team: nothing about money, no "add your first client" nag (a team may never have a client in
// the app: it can be a coach printing workouts and keeping paper copies), no "Start workout" block, no Needs attention strip, no desktop-mode button as a main thing. Everything else is under ONE "More tools".
export async function TeamCoachPhoneHome({ groupId, groupName }: { groupId: string; groupName: string }) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Every active team program (not a copy given to one athlete, not archived), in the coach's own order, newest first otherwise.
  const { data: rows } = await supabase
    .from("programs")
    .select("id, name, label, workouts ( id, title, week_number, day_index )")
    .eq("group_id", groupId)
    .is("athlete_id", null).eq("org_program", false)
    .is("archived_at", null)
    .eq("is_active", true)
    .order("sort_order", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(20);
  const programs: TeamPhoneProgram[] = ((rows ?? []) as { id: string; name: string; label: string | null; workouts: TeamPhoneProgram["workouts"] | null }[]).map((r) => ({
    id: r.id,
    name: r.name,
    label: r.label,
    workouts: r.workouts ?? [],
  }));
  const ids = programs.map((p) => p.id);
  // Where each one is up to: the same pointer the program view opens on (the coach's own completions of the team program).
  const { doneAt } = user ? await loadDoneAt(supabase, user.id, programs.flatMap((p) => p.workouts.map((w) => w.id))) : { doneAt: new Map<string, string>() };
  // Who each program was given to, by position: the athletes' own copies of it.
  const forByProgram = new Map<string, { name: string; count: number }[]>();
  if (ids.length > 0) {
    const { data: copies } = await supabase.from("programs").select("source_program_id, athlete_id").in("source_program_id", ids).not("athlete_id", "is", null).is("archived_at", null);
    const copyRows = (copies ?? []) as { source_program_id: string; athlete_id: string }[];
    const athleteIds = [...new Set(copyRows.map((c) => c.athlete_id))];
    if (athleteIds.length > 0) {
      const [{ data: seats }, { data: positions }] = await Promise.all([
        supabase.from("group_memberships").select("profile_id, position_id").eq("group_id", groupId).in("profile_id", athleteIds),
        supabase.from("group_positions").select("id, name").eq("group_id", groupId),
      ]);
      const positionName = new Map(((positions ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]));
      const positionOf = new Map(((seats ?? []) as { profile_id: string; position_id: string | null }[]).map((s) => [s.profile_id, s.position_id ? positionName.get(s.position_id) ?? null : null]));
      for (const id of ids) {
        const counts = new Map<string, number>();
        for (const c of copyRows.filter((c) => c.source_program_id === id)) {
          const name = positionOf.get(c.athlete_id);
          if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
        }
        forByProgram.set(id, [...counts.entries()].map(([name, count]) => ({ name, count })));
      }
    }
  }
  const home = teamPhoneHome({ groupId, programs, doneAt, forByProgram });

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body pb-24">
      {/* Ron decided team-only coaches keep their team Home: the bar's Home tab stays here (the other tabs open their own app). */}
      <CoachMobileShell groupId={groupId} groupName={groupName} activeOverride="home" homeHref={`/groups/${groupId}`}>
        <header className="px-5 pt-16 pb-4">
          <h1 className="font-display font-bold text-3xl leading-none uppercase truncate">{groupName}</h1>
        </header>

        <section className="px-5 pb-5 space-y-3" aria-label="Programs">
          {home.programs.length > 0 ? (
            home.programs.map((p) => (
              <Link key={p.id} href={p.href} className="block border border-rust bg-rust/10 p-5 active:bg-rust/15 transition-colors" data-team-program>
                <p className="font-display font-bold text-2xl leading-tight">{p.name}</p>
                <p className="font-body text-sm text-steel mt-1">{p.summary}</p>
                <p className="font-body text-sm text-chalk mt-1">{p.upNext}</p>
                {p.forLine && <p className="font-body text-xs text-steel mt-1">{p.forLine}</p>}
                <span className="inline-block mt-4 h-11 px-5 leading-[2.75rem] bg-rust text-graphite font-body font-bold text-sm">{p.cta} &rarr;</span>
              </Link>
            ))
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
          </ul>
        </details>
      </CoachMobileShell>
    </main>
  );
}

