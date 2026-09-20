import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { AcknowledgeSessionPatternNoteButton } from "@/components/coach/acknowledge-session-pattern-note-button";

// Session Pattern Spotter's coach-facing page
// (habit_spotter_and_post_workout_coach_page_research_sept19.md) — a
// dedicated route rather than squeezed into QuickViewBubble's condensed-
// popup pattern (that pattern is "a light version of a standing
// dashboard page," not a one-time, session-specific moment). Reached
// via the push notification/in-app notification the check route fires,
// never linked from anywhere an athlete sees.
export default async function SessionPatternNotePage(props: { params: Promise<{ sessionId: string }> }) {
  const params = await props.params;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: session } = await supabase
    .from("athlete_sessions")
    .select("id, group_id, athlete_id, workout_id, profiles ( full_name )")
    .eq("id", params.sessionId)
    .maybeSingle();

  if (!session) {
    return (
      <main className="min-h-screen bg-graphite text-chalk flex items-center justify-center px-6">
        <p className="font-body text-steel text-center">That session doesn&apos;t exist.</p>
      </main>
    );
  }

  const { data: membership } = await supabase
    .from("group_memberships")
    .select("role")
    .eq("group_id", session.group_id)
    .eq("profile_id", user.id)
    .maybeSingle();

  if (membership?.role !== "coach") {
    return (
      <main className="min-h-screen bg-graphite text-chalk flex items-center justify-center px-6">
        <p className="font-body text-steel text-center">Only coaches can view this.</p>
      </main>
    );
  }

  const { data: check } = await supabase
    .from("session_pattern_checks")
    .select("id, found_something, detected_signals, synthesis_text, acknowledged_at")
    .eq("session_id", params.sessionId)
    .maybeSingle();

  const athleteName = (session.profiles as any)?.full_name ?? "This client";

  if (!check || !check.found_something) {
    return (
      <main className="min-h-screen bg-graphite text-chalk flex items-center justify-center px-6">
        <p className="font-body text-steel text-center max-w-[50ch]">
          Nothing was flagged for {athleteName}&apos;s session — check the session recap for the full log.
        </p>
      </main>
    );
  }

  const { data: workout } = session.workout_id
    ? await supabase.from("workouts").select("program_id").eq("id", session.workout_id).maybeSingle()
    : { data: null };

  const signals = (check.detected_signals ?? []) as { kind: string; description: string }[];

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body px-6 py-10">
      <div className="max-w-xl mx-auto">
        <p className="font-body text-[11px] text-rust uppercase tracking-wide font-bold mb-2">
          Session Pattern Spot
        </p>
        <h1 className="font-display font-bold text-2xl uppercase leading-tight mb-4">
          {athleteName}&apos;s recent sessions
        </h1>

        <div className="border border-rust/40 bg-rust/5 p-4 mb-6">
          <p className="font-body text-sm text-chalk">{check.synthesis_text}</p>
        </div>

        {signals.length > 0 && (
          <div className="mb-8">
            <p className="font-body text-[11px] text-steel uppercase tracking-wide mb-2">What was found</p>
            <ul className="space-y-1.5">
              {signals.map((s, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 bg-steel" />
                  <span className="font-body text-sm text-steel">{s.description}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          {workout?.program_id && (
            <Link
              href={`/groups/${session.group_id}/programs/${workout.program_id}`}
              className="h-10 px-4 flex items-center bg-rust text-graphite font-body text-sm font-medium"
            >
              Adjust next session
            </Link>
          )}
          <Link
            href={`/groups/${session.group_id}/messages/${session.athlete_id}`}
            className="h-10 px-4 flex items-center border border-steel/30 text-chalk font-body text-sm"
          >
            Message {athleteName}
          </Link>
          {check.acknowledged_at ? (
            <p className="font-body text-sm text-steel">✓ Acknowledged</p>
          ) : (
            <AcknowledgeSessionPatternNoteButton checkId={check.id} />
          )}
        </div>
      </div>
    </main>
  );
}
