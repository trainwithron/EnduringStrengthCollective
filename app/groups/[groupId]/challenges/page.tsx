import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { BottomTabBar } from "@/components/athlete/bottom-tab-bar";
import { ChallengeCreator } from "@/components/coach/desktop/challenge-creator";
import { estimatedRevenueCents, formatCents } from "@/lib/challenges";
import { prefersAthleteStyleView } from "@/lib/pwa-server";

export default async function ChallengesPage(
  props: {
    params: Promise<{ groupId: string }>;
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
  const showMobileView = !isCoach || prefersAthleteStyleView();

  if (isCoach && !showMobileView) {
    const { data: group } = await supabase
      .from("groups")
      .select("name")
      .eq("id", params.groupId)
      .single();

    const { data: challengeRows } = await supabase
      .from("challenges")
      .select("id, name, status, start_date, duration_weeks, entry_fee_cents")
      .eq("coach_id", user.id)
      .order("created_at", { ascending: false });

    const challengeIds = (challengeRows ?? []).map((c) => c.id);
    const { data: participantRows } = await supabase
      .from("challenge_participants")
      .select("challenge_id")
      .in("challenge_id", challengeIds.length > 0 ? challengeIds : ["00000000-0000-0000-0000-000000000000"]);
    const participantCountByChallenge = new Map<string, number>();
    for (const p of participantRows ?? []) {
      participantCountByChallenge.set(p.challenge_id, (participantCountByChallenge.get(p.challenge_id) ?? 0) + 1);
    }

    return (
      <CoachDesktopShell groupId={params.groupId} groupName={group?.name ?? "Coaching"} active="challenges">
        <div className="pb-6 border-b border-steel/20 mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="font-display font-bold text-3xl uppercase leading-none">Challenges</h1>
            <p className="font-body text-sm text-steel mt-2 max-w-[70ch]">
              Run a time-boxed challenge for your clients — daily habit targets, a leaderboard, and
              a before/after photo. Entry fees are tracked here, not charged — no payment processor
              is connected yet.
            </p>
          </div>
          <ChallengeCreator groupId={params.groupId} />
        </div>

        {(challengeRows ?? []).length === 0 ? (
          <p className="font-body text-sm text-steel">No challenges yet.</p>
        ) : (
          <div className="divide-y divide-steel/15">
            {(challengeRows ?? []).map((c) => {
              const participants = participantCountByChallenge.get(c.id) ?? 0;
              return (
                <Link
                  key={c.id}
                  href={`/groups/${params.groupId}/challenges/${c.id}`}
                  className="py-3 flex items-center justify-between gap-4 hover:bg-surface/30 transition-colors"
                >
                  <div>
                    <p className="font-body text-sm font-medium">{c.name}</p>
                    <p className="font-body text-xs text-steel mt-0.5">
                      {c.status} &middot; starts {new Date(c.start_date + "T00:00:00").toLocaleDateString()} &middot;{" "}
                      {c.duration_weeks} weeks
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-body text-sm">{participants} joined</p>
                    <p className="font-body text-xs text-steel">
                      Est. {formatCents(estimatedRevenueCents(participants, c.entry_fee_cents))}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </CoachDesktopShell>
    );
  }

  // Athlete branch: browse this coach's open challenges, plus anything
  // already joined.
  const { data: coachMembership } = await supabase
    .from("group_memberships")
    .select("profile_id")
    .eq("group_id", params.groupId)
    .eq("role", "coach")
    .limit(1)
    .maybeSingle();
  const coachId = coachMembership?.profile_id;

  const { data: openChallenges } = coachId
    ? await supabase
        .from("challenges")
        .select("id, name, description, status, start_date, duration_weeks, entry_fee_cents")
        .eq("coach_id", coachId)
        .neq("status", "draft")
        .order("start_date", { ascending: false })
    : { data: [] };

  const { data: myParticipantRows } = await supabase
    .from("challenge_participants")
    .select("challenge_id")
    .eq("profile_id", user.id);
  const joinedChallengeIds = new Set((myParticipantRows ?? []).map((p) => p.challenge_id));

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body pb-24">
      <header className="px-5 pt-8 pb-6 border-b border-steel/20">
        <h1 className="font-display font-bold text-3xl leading-none uppercase">Challenges</h1>
        <p className="font-body text-sm text-steel mt-2 max-w-[60ch]">
          Join a challenge your coach is running — daily habit targets, a leaderboard, and a
          before/after photo.
        </p>
      </header>

      <section className="px-5 pt-6 space-y-3">
        {(openChallenges ?? []).length === 0 ? (
          <p className="font-body text-sm text-steel">No challenges open right now.</p>
        ) : (
          (openChallenges ?? []).map((c) => (
            <Link
              key={c.id}
              href={`/groups/${params.groupId}/challenges/${c.id}`}
              className="block border border-steel/20 p-4"
            >
              <div className="flex items-center justify-between gap-3">
                <p className="font-body font-medium text-[15px]">{c.name}</p>
                {joinedChallengeIds.has(c.id) && (
                  <span className="font-body text-xs text-positive uppercase tracking-wide">Joined</span>
                )}
              </div>
              {c.description && <p className="font-body text-sm text-steel mt-1">{c.description}</p>}
              <p className="font-body text-xs text-steel mt-2">
                {c.duration_weeks} weeks &middot; starts{" "}
                {new Date(c.start_date + "T00:00:00").toLocaleDateString()}
                {c.entry_fee_cents > 0 && ` · ${formatCents(c.entry_fee_cents)} entry`}
              </p>
            </Link>
          ))
        )}
      </section>

      <BottomTabBar groupId={params.groupId} activeOverride="settings" />
    </main>
  );
}
