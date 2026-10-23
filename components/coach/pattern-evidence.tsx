import { evidenceRowText, type FindingEvidence } from "@/lib/session-pattern-evidence";
import { formatInTimezone } from "@/lib/format-in-timezone";
import { formatLift } from "@/lib/lift-weight";
import type { WeightUnit } from "@/lib/units";

// What actually happened behind a Session Pattern finding, one compact row per session (or per exercise), in plain words that fit a phone (Ron, Oct 20: "show me the actual thing that's
// happened"). Server-rendered; the rows come from lib/session-pattern-evidence.ts.
export function PatternEvidence({ evidence, timeZone, unit }: { evidence: FindingEvidence; timeZone: string; unit: WeightUnit }) {
  const day = (iso: string) => formatInTimezone(iso, timeZone, "date");
  const row = "flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-1.5 border-b border-steel/15 last:border-b-0";
  const lift = (lbs: number) => formatLift(lbs, unit).replace(/ (lb|kg)$/, "");

  return (
    <div className="mt-2 border border-steel/20 px-3 py-1" data-testid="pattern-evidence">
      {evidence.kind === "slot_sets" &&
        evidence.rows.map((r, i) => (
          <div key={i} className={row}>
            <span className="font-body text-xs text-steel tabular-nums">{day(r.startedAt)}</span>
            <span className="font-body text-sm text-chalk">{r.exerciseName}</span>
            <span className={`font-body text-xs ${r.done < r.total ? "text-rust" : "text-steel"}`}>
              {r.done} of {r.total} sets done
            </span>
            <span className="basis-full font-body text-xs text-steel tabular-nums">{evidenceRowText(r.sets, lift)}</span>
          </div>
        ))}
      {evidence.kind === "session_rpe" &&
        evidence.rows.map((r, i) => (
          <div key={i} className={row}>
            <span className="font-body text-xs text-steel tabular-nums">{day(r.startedAt)}</span>
            <span className="font-body text-sm text-chalk tabular-nums">Average RPE {r.avgRpe}</span>
          </div>
        ))}
      {evidence.kind === "rest" &&
        evidence.rows.map((r, i) => (
          <div key={i} className={row}>
            <span className="font-body text-sm text-chalk">{r.exerciseName}</span>
            <span className="font-body text-xs text-steel tabular-nums">
              rests {r.actualSeconds}s, planned {r.targetSeconds}s ({r.sets} {r.sets === 1 ? "set" : "sets"})
            </span>
          </div>
        ))}
      {evidence.kind === "durations" && (
        <>
          {evidence.rows.map((r, i) => (
            <div key={i} className={row}>
              <span className="font-body text-xs text-steel tabular-nums">{day(r.startedAt)}</span>
              <span className="font-body text-sm text-chalk tabular-nums">{r.minutes} min</span>
            </div>
          ))}
          <p className="font-body text-xs text-steel py-1.5">All sessions average {evidence.overallMinutes} min.</p>
        </>
      )}
    </div>
  );
}
