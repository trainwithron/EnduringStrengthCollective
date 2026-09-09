import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { BottomTabBar } from "@/components/athlete/bottom-tab-bar";
import { ChallengeStatusControl } from "@/components/coach/desktop/challenge-status-control";
import { ChallengeParticipantPanel } from "@/components/athlete/challenge-participant-panel";
import {
  computeChallengeWindow,
  computeConsistencyPct,
  rankLeaderboard,
  estimatedRevenueCents,
  formatCents,
} from "@/lib/challenges";

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default async function ChallengeDetailPage(
  props: {
    params: Promise<{ groupId: string; challengeId: string }>;
  }
) {
  const params = await props.params;
  const supabase = createServerClient();
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

  if (!membership) {
    return (
      <main className="min-h-screen bg-graphite text-chalk flex items-center justify-center px-6">
        <p className="font-body text-steel text-center">
          This group isn&apos;t available, or you don&apos;t have access to it.
        </p>
      </main>
    );
  }
  const isCoach = membership.role === "coach";

  const { data: challenge } = await supabase
    .from("challenges")
    .select("id, coach_id, name, description, start_date, duration_weeks, entry_fee_cents, status")
    .eq("id", params.challengeId)
    .maybeSingle();

  if (!challenge) {
    return (
      <main className="min-h-screen bg-graphite text-chalk flex items-center justify-center px-6">
        <p className="font-body text-steel text-center">This challenge isn&apos;t available.</p>
      </main>
    );
  }

  const { data: habitRows } = await supabase
    .from("challenge_habits")
    .select("id, title")
    .eq("challenge_id", params.challengeId)
    .order("sort_order", { ascending: true });
  const habits = habitRows ?? [];

  const { data: participantRows } = await supabase
    .from("challenge_participants")
    .select("profile_id, before_photo_url, after_photo_url, profiles ( full_name )")
    .eq("challenge_id", params.challengeId);
  const participants = (participantRows ?? []).map((p) => ({
    profileId: p.profile_id,
    fullName: (p.profiles as any)?.full_name ?? "Unknown",
    beforePhotoUrl: p.before_photo_url,
    afterPhotoUrl: p.after_photo_url,
  }));

  const habitIds = habits.map((h) => h.id);
  const { data: logRows } = await supabase
    .from("challenge_habit_logs")
    .select("challenge_habit_id, profile_id, log_date, completed_at")
    .in("challenge_habit_id", habitIds.length > 0 ? habitIds : ["00000000-0000-0000-0000-000000000000"])
    .not("completed_at", "is", null);
  const logs = logRows ?? [];

  const today = new Date();
  const todayKey = dateKey(today);
  const win = computeChallengeWindow(challenge.start_date, challenge.duration_weeks, todayKey);

  const completedCountByProfile = new Map<string, number>();
  for (const log of logs) {
    completedCountByProfile.set(log.profile_id, (completedCountByProfile.get(log.profile_id) ?? 0) + 1);
  }

  const leaderboard = rankLeaderboard(
    participants.map((p) => ({
      profileId: p.profileId,
      fullName: p.fullName,
      score: completedCountByProfile.get(p.profileId) ?? 0,
    }))
  );

  const viewerParticipant = participants.find((p) => p.profileId === user.id) ?? null;
  const isJoined = !!viewerParticipant;
  const myCompletedToday = logs
    .filter((l) => l.profile_id === user.id && l.log_date === todayKey)
    .map((l) => l.challenge_habit_id);
  const myConsistency = isJoined
    ? computeConsistencyPct(completedCountByProfile.get(user.id) ?? 0, habits.length, win.daysElapsed)
    : 0;

  const leaderboardSection = (
    <div className="border border-steel/20 p-4">
      <h3 className="font-body text-xs text-steel uppercase tracking-wide mb-3">Leaderboard</h3>
      {leaderboard.length === 0 ? (
        <p className="font-body text-sm text-steel">No participants yet.</p>
      ) : (
        <div className="divide-y divide-steel/15">
          {leaderboard.map((entry) => (
            <div key={entry.profileId} className="py-2 flex items-center justify-between">
              <span className="font-body text-sm">
                <span className="text-steel mr-2">#{entry.rank}</span>
                {entry.fullName}
                {entry.profileId === user.id && <span className="text-rust"> (you)</span>}
              </span>
              <span className="font-body text-xs text-steel">{entry.score} check-offs</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  if (isCoach && challenge.coach_id === user.id) {
    const { data: group } = await supabase
      .from("groups")
      .select("name")
      .eq("id", params.groupId)
      .single();

    return (
      <CoachDesktopShell groupId={params.groupId} groupName={group?.name ?? "Coaching"} active="challenges">
        <Link
          href={`/groups/${params.groupId}/challenges`}
          className="font-body text-xs text-steel uppercase tracking-wide"
        >
          &larr; Back to challenges
        </Link>
        <div className="pb-6 border-b border-steel/20 mb-6 mt-3">
          <div className="flex items-center gap-3 mb-2">
            <h1 className="font-display font-bold text-3xl uppercase leading-none">{challenge.name}</h1>
            <ChallengeStatusControl challengeId={challenge.id} status={challenge.status} />
          </div>
          {challenge.description && (
            <p className="font-body text-sm text-steel mt-1 max-w-[70ch]">{challenge.description}</p>
          )}
          <p className="font-body text-xs text-steel mt-2">
            Starts {new Date(challenge.start_date + "T00:00:00").toLocaleDateString()} &middot;{" "}
            {challenge.duration_weeks} weeks &middot; day {win.daysElapsed + 1} of {win.totalDays}
          </p>
        </div>

        <div className="grid grid-cols-3 gap-4 mb-8">
          <div className="border border-steel/20 p-4">
            <p className="font-display text-3xl leading-none">{participants.length}</p>
            <p className="font-body text-xs text-steel mt-1 uppercase tracking-wide">Participants</p>
          </div>
          <div className="border border-steel/20 p-4">
            <p className="font-display text-3xl leading-none">
              {formatCents(estimatedRevenueCents(participants.length, challenge.entry_fee_cents))}
            </p>
            <p className="font-body text-xs text-steel mt-1 uppercase tracking-wide">
              Est. revenue ({formatCents(challenge.entry_fee_cents)}/entry)
            </p>
          </div>
          <div className="border border-steel/20 p-4">
            <p className="font-display text-3xl leading-none">{habits.length}</p>
            <p className="font-body text-xs text-steel mt-1 uppercase tracking-wide">Habit targets</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-6 mb-8">
          <div className="border border-steel/20 p-4">
            <h3 className="font-body text-xs text-steel uppercase tracking-wide mb-2">Habit targets</h3>
            <ul className="space-y-1">
              {habits.map((h) => (
                <li key={h.id} className="font-body text-sm">
                  {h.title}
                </li>
              ))}
            </ul>
          </div>
          {leaderboardSection}
        </div>

        <div>
          <h3 className="font-body text-xs text-steel uppercase tracking-wide mb-2">
            Before &amp; after
          </h3>
          <div className="grid grid-cols-4 gap-3">
            {participants.map((p) => (
              <div key={p.profileId} className="border border-steel/20 p-2">
                <p className="font-body text-xs mb-1.5">{p.fullName}</p>
                <div className="grid grid-cols-2 gap-1">
                  {p.beforePhotoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.beforePhotoUrl} alt="Before" className="w-full aspect-square object-cover" />
                  ) : (
                    <div className="w-full aspect-square bg-surface flex items-center justify-center">
                      <span className="font-body text-[9px] text-steel">No photo</span>
                    </div>
                  )}
                  {p.afterPhotoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.afterPhotoUrl} alt="After" className="w-full aspect-square object-cover" />
                  ) : (
                    <div className="w-full aspect-square bg-surface flex items-center justify-center">
                      <span className="font-body text-[9px] text-steel">No photo</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </CoachDesktopShell>
    );
  }

  // Athlete / participant branch.
  return (
    <main className="min-h-screen bg-graphite text-chalk font-body pb-24">
      <header className="px-5 pt-8 pb-6 border-b border-steel/20">
        <Link
          href={`/groups/${params.groupId}/challenges`}
          className="font-body text-xs text-steel uppercase tracking-wide"
        >
          &larr; Back to challenges
        </Link>
        <h1 className="font-display font-bold text-3xl leading-none mt-3 uppercase">{challenge.name}</h1>
        {challenge.description && (
          <p className="font-body text-sm text-steel mt-2 max-w-[60ch]">{challenge.description}</p>
        )}
        <p className="font-body text-xs text-steel mt-2">
          Day {win.daysElapsed + 1} of {win.totalDays}
          {isJoined && ` · ${myConsistency}% consistency`}
        </p>
      </header>

      <section className="px-5 pt-6 space-y-6">
        <ChallengeParticipantPanel
          challengeId={challenge.id}
          groupId={params.groupId}
          isJoined={isJoined}
          isJoinable={challenge.status === "active"}
          todayKey={todayKey}
          habits={habits}
          completedHabitIdsToday={myCompletedToday}
          beforePhotoUrl={viewerParticipant?.beforePhotoUrl ?? null}
          afterPhotoUrl={viewerParticipant?.afterPhotoUrl ?? null}
          hasEnded={win.hasEnded}
        />
        {leaderboardSection}
      </section>

      <BottomTabBar groupId={params.groupId} activeOverride="feed" />
    </main>
  );
}
