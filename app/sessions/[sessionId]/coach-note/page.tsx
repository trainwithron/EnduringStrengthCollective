import { LoadFailedPage } from "@/components/ui/load-failed-page";
import { isReadFailure } from "@/lib/read-failed";
import Link from "next/link";
import { NoAccess } from "@/components/shared/no-access";
import { redirect } from "next/navigation";
import { createCrossOrgServerClient as createServerClient } from "@/lib/supabase/server";
import { AcknowledgeSessionPatternNoteButton } from "@/components/coach/acknowledge-session-pattern-note-button";
import { CoachMobileShell } from "@/components/coach/mobile/coach-mobile-shell";
import { PatternEvidence } from "@/components/coach/pattern-evidence";
import { gatherSessionPatternFindings } from "@/lib/session-pattern-spotter-gather";
import { getGroupCoachTimezone } from "@/lib/timezone";
import { loadLiftUnit } from "@/lib/lift-unit-server";

export const metadata = { title: "Coach note" };

// Session Pattern Spotter's coach-facing page
// (habit_spotter_and_post_workout_coach_page_research_sept19.md) — a
// dedicated route rather than squeezed into QuickViewBubble's condensed-
// popup pattern (that pattern is "a light version of a standing
// dashboard page," not a one-time, session-specific moment). Reached
// via the push notification/in-app notification the check route fires,
// never linked from anywhere an athlete sees.
// What was found shows the evidence, not just a number (Ron, Oct 20: "show me the actual sets logged that were in question, the actual exercise"): the findings are worked out again
// here over the same sessions the note was about, with every set counted by the logger's own rule, so a note written when old "pending" sets were read as skipped is corrected,
// not repeated. On a phone the page has the coach's usual Spotlight and bottom tabs, and a way back to the client.
export default async function SessionPatternNotePage(props: { params: Promise<{ sessionId: string }> }) {
  const params = await props.params;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: session } = await supabase
    .from("athlete_sessions")
    .select("id, group_id, athlete_id, workout_id, started_at, profiles ( full_name )")
    .eq("id", params.sessionId)
    .maybeSingle();

  if (!session) {
    return (
      <NoAccess>That session doesn&apos;t exist.</NoAccess>
    );
  }

  const { data: membership, error: membershipError } = await supabase
    .from("group_memberships")
    .select("role")
    .eq("group_id", session.group_id)
    .eq("profile_id", user.id)
    .maybeSingle();

  if (isReadFailure(membershipError)) return <LoadFailedPage />;

  if (membership?.role !== "coach") {
    return (
      <NoAccess>Only coaches can view this.</NoAccess>
    );
  }

  const { data: check } = await supabase
    .from("session_pattern_checks")
    .select("id, found_something, detected_signals, synthesis_text, acknowledged_at")
    .eq("session_id", params.sessionId)
    .maybeSingle();

  const athleteName = (session.profiles as any)?.full_name ?? "This client";
  const { data: groupRow } = await supabase.from("groups").select("name").eq("id", session.group_id).maybeSingle();
  const profileHref = `/groups/${session.group_id}/athletes/${session.athlete_id}`;
  // The phone's usual coach chrome (Spotlight up top, the five tabs below); a computer reaches this page from the notification and goes back with the link at the top.
  const phoneShell = (
    <div className="lg:hidden">
      <CoachMobileShell groupId={session.group_id} groupName={(groupRow?.name as string | undefined) ?? ""}>
        {null}
      </CoachMobileShell>
    </div>
  );
  const back = (
    <Link href={profileHref} className="inline-flex items-center min-h-11 mb-2 font-body text-sm text-steel active:text-rust">
      &larr; {athleteName}
    </Link>
  );

  if (!check || !check.found_something) {
    return (
      <main className="min-h-screen bg-graphite text-chalk font-body px-5 pt-6 pb-28">
        <div className="max-w-xl mx-auto">
          {back}
          <p className="font-body text-steel max-w-[50ch] mt-6">
            Nothing was flagged for {athleteName}&apos;s session — check the session recap for the full log.
          </p>
        </div>
        {phoneShell}
      </main>
    );
  }

  const { data: workout } = session.workout_id
    ? await supabase.from("workouts").select("program_id").eq("id", session.workout_id).maybeSingle()
    : { data: null };

  const stored = (check.detected_signals ?? []) as { kind: string; description: string }[];
  // The same sessions as the note, looked at again now with every logged set counted (and with what actually happened in each one).
  const [findings, tz, unit] = await Promise.all([
    gatherSessionPatternFindings(supabase as any, { athleteId: session.athlete_id, groupId: session.group_id, upTo: session.started_at as string }),
    getGroupCoachTimezone(supabase, session.group_id),
    loadLiftUnit(supabase as any, session.athlete_id),
  ]);
  const sameKinds = findings.length === stored.length && findings.every((f) => stored.some((s) => s.kind === f.kind));
  // The note as written still stands when the same things are found; otherwise say what is true now.
  const summary = findings.length === 0
    ? "Looked at again with every logged set counted, nothing stands out in these sessions now."
    : sameKinds
      ? check.synthesis_text
      : findings.map((f) => f.description).join(" ");

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body px-5 pt-6 pb-28 lg:pb-10">
      <div className="max-w-xl mx-auto">
        {back}
        <p className="font-body text-xs text-rust uppercase tracking-wide font-bold mb-2">
          Session Pattern Spot
        </p>
        <h1 className="font-display font-bold text-2xl uppercase leading-tight mb-4">
          {athleteName}&apos;s recent sessions
        </h1>

        <div className="border border-rust/40 bg-rust/5 p-4 mb-6">
          <p className="font-body text-sm text-chalk">{summary}</p>
        </div>

        {findings.length > 0 && (
          <div className="mb-8">
            <p className="font-body text-xs text-steel uppercase tracking-wide mb-2">What was found</p>
            <ul className="space-y-4">
              {findings.map((f, i) => (
                <li key={i}>
                  <p className="font-body text-sm text-chalk">{f.description}</p>
                  {f.evidence && <PatternEvidence evidence={f.evidence} timeZone={tz} unit={unit} />}
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
      {phoneShell}
    </main>
  );
}
