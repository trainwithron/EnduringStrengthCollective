import Link from "next/link";
import { CoachLoggedBadge } from "@/components/coach-logged-badge";
import { believableDurationSeconds, formatDuration } from "@/lib/share-image";
import { FixWorkoutTime } from "@/components/coach/fix-workout-time";
import { looksTooLong } from "@/lib/workout-time-fix";

// One completed workout in a client's Logged workouts list: a short, landscape version of the post-workout card (Ron, Nov 9: "just some stats so coaches can get a quick
// reference of what the workout was and how the client did"). A stat with no real number is left out, never shown as 0.
export function LoggedWorkoutCard({
  clientName,
  clientHref,
  title,
  dateLabel,
  sessionId,
  loggedByCoach,
  volume,
  sets,
  durationSeconds,
  prs,
  exerciseNames,
}: {
  clientName?: string; // the Client workouts list says whose workout it is
  clientHref?: string;
  title: string;
  dateLabel: string;
  sessionId: string | null;
  loggedByCoach: boolean;
  volume: number | null;
  sets: number | null;
  durationSeconds: number | null;
  prs: string[];
  exerciseNames: string[];
}) {
  const seconds = believableDurationSeconds(durationSeconds, null, null);
  const time = seconds != null ? formatDuration(seconds) : null;
  const stats: { value: string; label: string; accent?: boolean }[] = [];
  if (volume != null && volume > 0) stats.push({ value: Math.round(volume).toLocaleString("en-US"), label: "Lbs lifted" });
  if (sets != null && sets > 0) stats.push({ value: String(sets), label: "Sets" });
  if (time) stats.push({ value: time.value, label: time.label });
  if (prs.length > 0) stats.push({ value: String(prs.length), label: prs.length === 1 ? "New PR" : "New PRs", accent: true });

  return (
    <div className="border border-steel/20 bg-chalk/[0.03]">
      {clientName && clientHref && (
        <Link href={clientHref} className="flex items-center min-h-11 px-4 border-b border-steel/15 font-body text-sm font-medium text-chalk">
          {clientName}
        </Link>
      )}
      <Link href={sessionId ? `/sessions/${sessionId}` : "#"} className="block px-4 py-3 hover:bg-surface/40 transition-colors">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="min-w-0">
            <p className="font-body text-xs text-steel">{dateLabel}</p>
            <p className="font-display uppercase text-xl leading-tight mt-0.5 flex flex-wrap items-center gap-x-2">
              <span className="min-w-0 break-words">{title}</span>
              {loggedByCoach && <CoachLoggedBadge className="normal-case" />}
            </p>
            {exerciseNames.length > 0 && <p className="font-body text-xs text-steel mt-1 line-clamp-1">{exerciseNames.join(", ")}</p>}
            {prs.length > 0 && <p className="font-body text-xs text-rust mt-1">PR: {prs.join(", ")}</p>}
          </div>
          {stats.length > 0 && (
            <div className="flex gap-5 shrink-0">
              {stats.map((s) => (
                <div key={s.label} className="min-w-0">
                  <p className={`font-display text-2xl leading-none [font-variant-numeric:tabular-nums] ${s.accent ? "text-rust" : ""}`}>{s.value}</p>
                  <p className="font-body text-[10px] text-steel uppercase tracking-wide mt-1">{s.label}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </Link>
      {sessionId && (
        <Link href={`/sessions/${sessionId}/recap`} className="font-body text-xs text-rust px-4 min-h-11 inline-flex items-center">
          Recap &amp; Up Next &rarr;
        </Link>
      )}
      {sessionId && looksTooLong(durationSeconds) && <FixWorkoutTime sessionId={sessionId} />}
    </div>
  );
}
