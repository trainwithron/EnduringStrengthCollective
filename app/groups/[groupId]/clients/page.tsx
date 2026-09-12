import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { ClientCardGrid } from "@/components/coach/desktop/client-card-grid";
import { AddClientButton } from "@/components/coach/desktop/add-client-button";
import type { RosterMember } from "@/lib/types";
import {
  classifyNutritionTrend,
  isTrendAligned,
  type NutritionPhase,
} from "@/lib/nutrition-trend-classifier";

export default async function ClientsPage(
  props: {
    params: Promise<{ groupId: string }>;
  }
) {
  const params = await props.params;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: membership } = await supabase
    .from("group_memberships")
    .select("role")
    .eq("group_id", params.groupId)
    .eq("profile_id", user.id)
    .maybeSingle();

  if (membership?.role !== "coach") {
    return (
      <main className="min-h-screen bg-graphite text-chalk flex items-center justify-center px-6">
        <p className="font-body text-steel text-center">
          Only coaches can manage clients.
        </p>
      </main>
    );
  }

  const { data: group } = await supabase
    .from("groups")
    .select("name")
    .eq("id", params.groupId)
    .single();

  // Cheap, roster-wide: name/avatar/tier for every member, plus one
  // aggregate row per athlete for their most recent workout (a Postgres
  // GROUP BY via RPC, not a raw fetch-every-log-row-and-reduce-in-JS scan
  // — a stress-test pass found the old approach shipping a 1.1MB payload
  // and taking 18.5s at 500 athletes). Credits/wellness/integrity are
  // each a heavier per-athlete join (especially integrity's session/set
  // join) and are deliberately NOT computed here for the whole roster —
  // ClientCardGrid fetches those client-side, scoped to just the
  // currently-visible page of athletes, once pagination is applied.
  const [{ data: memberships }, { data: lastWorkoutRows }] = await Promise.all([
    supabase
      .from("group_memberships")
      .select("role, profiles ( id, full_name, avatar_url ), profile_id, client_tier")
      .eq("group_id", params.groupId),
    supabase.rpc("get_last_workout_per_athlete", { p_group_id: params.groupId }),
  ]);

  const lastLogByAthlete = new Map<string, string>();
  for (const row of (lastWorkoutRows ?? []) as { athlete_id: string; last_logged_at: string }[]) {
    lastLogByAthlete.set(row.athlete_id, row.last_logged_at);
  }

  // Category 2 (Milestone Celebrations) — which nutrition phase (if any)
  // each athlete is tagged with. Cheap and roster-wide (just a phase
  // string per tagged athlete, not the underlying macro/weight time
  // series) so the "Goal" filter can operate on the FULL roster before
  // pagination, same as the existing Tier filter — unlike the heavier
  // per-athlete trend computation below, which stays properly scoped.
  const { data: taggedPhaseRows } = await supabase
    .from("nutrition_phases")
    .select("athlete_id, phase")
    .eq("group_id", params.groupId);
  const phaseByAthleteId = new Map<string, NutritionPhase>();
  for (const row of taggedPhaseRows ?? []) {
    phaseByAthleteId.set(row.athlete_id, row.phase as NutritionPhase);
  }

  const roster: RosterMember[] = (memberships ?? []).map((m: any) => ({
    profileId: m.profile_id,
    fullName: m.profiles?.full_name ?? "Unknown",
    avatarUrl: m.profiles?.avatar_url ?? null,
    role: m.role,
    lastWorkoutAt: lastLogByAthlete.get(m.profile_id) ?? null,
    clientTier: m.client_tier ?? null,
    nutritionPhase: phaseByAthleteId.get(m.profile_id) ?? null,
  }));

  roster.sort((a, b) => {
    if (a.role !== b.role) return a.role === "coach" ? -1 : 1;
    return a.fullName.localeCompare(b.fullName);
  });

  const coaches = roster.filter((m) => m.role === "coach");
  const athletes = roster.filter((m) => m.role === "athlete");

  // Category 2 (Milestone Celebrations) — Ron's own framing: the
  // platform should be able to "intuit what you're doing by your trend
  // lines," and a coach with too many clients whose trend doesn't match
  // their tagged goal is itself a useful signal, not just each client's
  // own concern. Deliberately bounded to the small set of athletes a
  // coach has actually tagged (not a per-athlete scan of the whole
  // roster) — same cost discipline as the rest of this page, which
  // already keeps every per-athlete-heavy computation off the main
  // roster query.
  let phaseAlignmentSummary: { total: number; misaligned: number } | null = null;
  if (phaseByAthleteId.size > 0) {
    const sixWeeksAgo = new Date();
    sixWeeksAgo.setDate(sixWeeksAgo.getDate() - 42);
    let judged = 0;
    let misaligned = 0;
    for (const [athleteId, phase] of phaseByAthleteId) {
      const [{ data: macroRows }, { data: weightRows }] = await Promise.all([
        supabase
          .from("daily_macros")
          .select("log_date, calories")
          .eq("athlete_id", athleteId)
          .eq("group_id", params.groupId)
          .gte("log_date", sixWeeksAgo.toISOString().slice(0, 10)),
        supabase
          .from("body_weight_logs")
          .select("logged_date, weight")
          .eq("athlete_id", athleteId)
          .eq("group_id", params.groupId)
          .gte("logged_date", sixWeeksAgo.toISOString().slice(0, 10)),
      ]);
      const calorieSeries = (macroRows ?? [])
        .filter((r) => r.calories != null)
        .map((r) => ({ date: r.log_date as string, value: r.calories as number }));
      const weightSeries = (weightRows ?? []).map((r) => ({
        date: r.logged_date as string,
        value: r.weight as number,
      }));
      const classification = classifyNutritionTrend(calorieSeries, weightSeries, new Date());
      if (!classification) continue;
      judged += 1;
      if (!isTrendAligned(classification, phase)) misaligned += 1;
    }
    if (judged > 0) phaseAlignmentSummary = { total: judged, misaligned };
  }

  return (
    <CoachDesktopShell groupId={params.groupId} groupName={group?.name ?? "Coaching"} active="clients">
      <div className="pb-6 border-b border-steel/20 mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-display font-bold text-3xl uppercase leading-none">Clients</h1>
          <p className="font-body text-sm text-steel mt-2">
            {athletes.length} {athletes.length === 1 ? "client" : "clients"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <AddClientButton groupId={params.groupId} groupName={group?.name ?? "This group"} createdBy={user.id} />
        </div>
      </div>

      {phaseAlignmentSummary && phaseAlignmentSummary.misaligned > 0 && (
        <div className="mb-6 px-4 py-3 border border-rust/30 bg-rust/5">
          <p className="font-body text-sm">
            {phaseAlignmentSummary.misaligned} of {phaseAlignmentSummary.total} tagged nutrition
            phases {phaseAlignmentSummary.misaligned === 1 ? "isn't" : "aren't"} trending toward their
            goal yet — worth a look on those client profiles.
          </p>
        </div>
      )}

      {coaches.length > 0 && (
        <div className="mb-8">
          <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-2">
            Coaching Staff
          </h2>
          <div className="divide-y divide-steel/15">
            {coaches.map((c) => (
              <div key={c.profileId} className="flex items-center gap-3 py-2">
                {c.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.avatarUrl} alt="" className="w-8 h-8 rounded-full object-cover" />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-surface border border-steel/30 flex items-center justify-center">
                    <span className="font-display text-[10px] text-chalk">
                      {c.fullName
                        .split(" ")
                        .map((p) => p[0])
                        .slice(0, 2)
                        .join("")
                        .toUpperCase()}
                    </span>
                  </div>
                )}
                <span className="font-body text-sm">{c.fullName}</span>
                <span className="font-body text-xs text-rust">Coach</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <ClientCardGrid groupId={params.groupId} members={athletes} />
    </CoachDesktopShell>
  );
}
