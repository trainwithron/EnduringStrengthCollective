import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { BottomTabBar } from "@/components/athlete/bottom-tab-bar";
import { ActingAsBanner } from "@/components/athlete/acting-as-banner";
import { getEffectiveAthlete } from "@/lib/acting-as";
import { prefersAthleteStyleView } from "@/lib/pwa-server";

interface RecordRow {
  id: string;
  exerciseName: string;
  value: number;
  athleteName: string;
  achievedAt: string;
  history: { athleteName: string; value: number; achievedAt: string; supersededAt: string }[];
}

// Group Hall of Fame (record_holders_hall_of_fame_scoping memory) — a
// durable reference page distinct from Team Feed's PR Board (which
// scrolls away) and the live/current leaderboard (this week's standing,
// not all-time). Direct-group tier only, weight only — see
// supabase/migrations/0142_exercise_records.sql for why the other two
// scope tiers (world record, local area) and other tracked fields aren't
// built yet. History is free with the append-only schema, so it's shown
// by default rather than treated as an optional extra.
async function loadRecords(groupId: string): Promise<RecordRow[]> {
  const supabase = await createServerClient();
  const { data: rows } = await supabase
    .from("exercise_records")
    .select("id, exercise_name, value, achieved_at, superseded_at, profiles ( full_name )")
    .eq("group_id", groupId)
    .eq("tracked_field", "weight")
    .order("exercise_name", { ascending: true })
    .order("achieved_at", { ascending: false });

  const byExercise = new Map<string, RecordRow>();
  for (const row of (rows ?? []) as any[]) {
    const name = row.exercise_name;
    const athleteName = row.profiles?.full_name ?? "An athlete";
    if (row.superseded_at === null) {
      byExercise.set(name, {
        id: row.id,
        exerciseName: name,
        value: row.value,
        athleteName,
        achievedAt: row.achieved_at,
        history: byExercise.get(name)?.history ?? [],
      });
    } else {
      const existing = byExercise.get(name);
      const entry = { athleteName, value: row.value, achievedAt: row.achieved_at, supersededAt: row.superseded_at };
      if (existing) existing.history.push(entry);
      else
        byExercise.set(name, {
          id: row.id,
          exerciseName: name,
          value: 0,
          athleteName: "",
          achievedAt: "",
          history: [entry],
        });
    }
  }
  return Array.from(byExercise.values())
    .filter((r) => r.athleteName !== "") // a superseded-only bucket with no current holder can't happen, but stay defensive
    .sort((a, b) => a.exerciseName.localeCompare(b.exerciseName));
}

function RecordsList({ records }: { records: RecordRow[] }) {
  if (records.length === 0) {
    return (
      <p className="font-body text-sm text-steel">
        No records yet — the first athlete to complete a weighted exercise in this group sets the bar.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {records.map((r) => (
        <div key={r.exerciseName} className="border border-steel/20 p-4">
          <div className="flex items-center justify-between">
            <h3 className="font-body text-sm font-medium">{r.exerciseName}</h3>
            <p className="font-display text-lg leading-none text-rust">{r.value} lb</p>
          </div>
          <p className="font-body text-xs text-steel mt-1">
            {r.athleteName} &middot;{" "}
            {new Date(r.achievedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
          </p>
          {r.history.length > 0 && (
            <details className="mt-2">
              <summary className="font-body text-[11px] text-steel cursor-pointer">
                {r.history.length} previous holder{r.history.length === 1 ? "" : "s"}
              </summary>
              <div className="mt-2 space-y-1 pl-3 border-l border-steel/20">
                {r.history
                  .sort((a, b) => b.achievedAt.localeCompare(a.achievedAt))
                  .map((h, i) => (
                    <p key={i} className="font-body text-[11px] text-steel">
                      {h.athleteName} — {h.value} lb (
                      {new Date(h.achievedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      )
                    </p>
                  ))}
              </div>
            </details>
          )}
        </div>
      ))}
    </div>
  );
}

export default async function RecordsPage(props: { params: Promise<{ groupId: string }> }) {
  const params = await props.params;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: membership } = await supabase
    .from("group_memberships")
    .select("role")
    .eq("group_id", params.groupId)
    .eq("profile_id", user.id)
    .maybeSingle();
  const isCoach = membership?.role === "coach";

  const effective = await getEffectiveAthlete(params.groupId, user.id);
  const isActingAsOther = effective.isActingAsOther;
  const showMobileView = isActingAsOther || !isCoach || (await prefersAthleteStyleView());

  const records = await loadRecords(params.groupId);

  if (isCoach && !showMobileView) {
    const { data: group } = await supabase.from("groups").select("name").eq("id", params.groupId).single();
    return (
      <CoachDesktopShell groupId={params.groupId} groupName={group?.name ?? "Coaching"} active="records">
        <div className="pb-6 border-b border-steel/20 mb-6">
          <h1 className="font-display font-bold text-3xl uppercase leading-none">Hall of Fame</h1>
          <p className="font-body text-sm text-steel mt-2 max-w-[70ch]">
            The group&apos;s all-time bests, by weight lifted. New records are detected automatically when a
            workout is completed.
          </p>
        </div>
        <div className="max-w-[640px]">
          <RecordsList records={records} />
        </div>
      </CoachDesktopShell>
    );
  }

  let actingAsFullName: string | null = null;
  if (isActingAsOther) {
    const { data: p } = await supabase.from("profiles").select("full_name").eq("id", effective.athleteId).maybeSingle();
    actingAsFullName = p?.full_name ?? "Client";
  }

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body pb-28">
      {isActingAsOther && <ActingAsBanner athleteFullName={actingAsFullName ?? "Client"} groupId={params.groupId} />}
      <header className="px-5 pt-8 pb-6 border-b border-steel/20">
        <Link href={`/groups/${params.groupId}`} className="font-body text-xs text-steel uppercase tracking-wide">
          &larr; Back to group
        </Link>
        <h1 className="font-display font-bold text-3xl uppercase leading-none mt-3">Hall of Fame</h1>
      </header>
      <div className="px-5 pt-6">
        <RecordsList records={records} />
      </div>
      <BottomTabBar groupId={params.groupId} activeOverride="settings" />
    </main>
  );
}
