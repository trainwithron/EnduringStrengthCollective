import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { BottomTabBar } from "@/components/athlete/bottom-tab-bar";
import { StatFieldManager, type StatFieldRow } from "@/components/coach/desktop/stat-field-manager";
import { GameStatGrid, type GameStatAthlete } from "@/components/coach/desktop/game-stat-grid";
import { TeamGameScoreForm } from "@/components/coach/desktop/team-game-score-form";

export default async function GameDetailPage(
  props: { params: Promise<{ groupId: string; gameId: string }> }
) {
  const params = await props.params;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const [{ data: group }, { data: viewerMembership }, { data: game }] = await Promise.all([
    supabase.from("groups").select("name").eq("id", params.groupId).single(),
    supabase
      .from("group_memberships")
      .select("role, coach_position_id")
      .eq("group_id", params.groupId)
      .eq("profile_id", user.id)
      .maybeSingle(),
    supabase
      .from("team_games")
      .select("id, event_date, start_time, opponent, is_home, our_score, opponent_score, notes")
      .eq("id", params.gameId)
      .single(),
  ]);

  if (!viewerMembership || !game) redirect("/");
  const isCoach = viewerMembership.role === "coach";
  // null = head coach (sees/edits every position); set = scoped to just
  // that position — the one place tiered permissions actually bite,
  // enforced for real by RLS on game_stat_entries, mirrored here so the
  // UI only *offers* what a position-scoped coach can actually save.
  const coachPositionId = viewerMembership.coach_position_id ?? null;

  const [{ data: fieldRows }, { data: memberRows }, { data: entryRows }] = await Promise.all([
    supabase
      .from("group_stat_fields")
      .select("id, name, sort_order")
      .eq("group_id", params.groupId)
      .order("sort_order", { ascending: true }),
    supabase
      .from("group_memberships")
      .select("profile_id, position_id, profiles ( full_name )")
      .eq("group_id", params.groupId)
      .eq("role", "athlete"),
    supabase
      .from("game_stat_entries")
      .select("athlete_id, field_id, value")
      .eq("game_id", params.gameId),
  ]);

  const fields: StatFieldRow[] = (fieldRows ?? []).map((f) => ({ id: f.id, name: f.name, sortOrder: f.sort_order }));

  let athletes: GameStatAthlete[] = (memberRows ?? []).map((m: any) => ({
    profileId: m.profile_id,
    fullName: m.profiles?.full_name ?? "Unknown",
    positionId: m.position_id ?? null,
  }));
  // A position-scoped coach only sees (and can only save) their own
  // position's athletes here — matches the RLS boundary exactly rather
  // than showing rows a save would silently fail against.
  if (isCoach && coachPositionId) {
    athletes = athletes.filter((a) => a.positionId === coachPositionId);
  }
  athletes.sort((a, b) => a.fullName.localeCompare(b.fullName));

  const entries = (entryRows ?? []).map((e) => ({ athleteId: e.athlete_id, fieldId: e.field_id, value: Number(e.value) }));

  const dateLabel = new Date(`${game.event_date}T00:00:00`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const backHref = `/groups/${params.groupId}/team/calendar`;

  const content = (
    <div className="max-w-3xl">
      <Link href={backHref} className="font-body text-xs text-steel uppercase tracking-wide">
        &larr; Back to calendar
      </Link>
      <div className="pb-6 border-b border-steel/20 mb-6 mt-3">
        <h1 className="font-display font-bold text-3xl uppercase leading-none">
          {game.is_home ? "vs" : "@"} {game.opponent}
        </h1>
        <p className="font-body text-sm text-steel mt-2">
          {dateLabel}
          {game.start_time ? ` · ${game.start_time.slice(0, 5)}` : ""}
        </p>
      </div>

      {isCoach ? (
        <TeamGameScoreForm
          gameId={game.id}
          initialOurScore={game.our_score}
          initialOpponentScore={game.opponent_score}
          initialNotes={game.notes}
        />
      ) : (
        game.our_score != null && (
          <p className="font-display text-2xl mb-6">
            {game.our_score} – {game.opponent_score}
          </p>
        )
      )}

      {isCoach && <StatFieldManager groupId={params.groupId} initialFields={fields} />}

      <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-3">Stats</h2>
      <GameStatGrid
        gameId={game.id}
        fields={fields}
        athletes={athletes}
        initialEntries={entries}
        editable={isCoach}
      />
    </div>
  );

  if (isCoach) {
    return (
      <CoachDesktopShell groupId={params.groupId} groupName={group?.name ?? "Coaching"} active="game-detail">
        {content}
      </CoachDesktopShell>
    );
  }

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body px-5 py-8 pb-24">
      {content}
      <BottomTabBar groupId={params.groupId} />
    </main>
  );
}
