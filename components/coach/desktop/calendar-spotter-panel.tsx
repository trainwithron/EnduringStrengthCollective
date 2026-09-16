import type { CalendarSpotterFinding } from "@/lib/calendar-spotter-gather";

// scheduling_calendar_spotter_idea.md — "Calendar Spot: [content]" source-
// label convention (resolved directly with Ron): a label prefix is pure
// attribution, never reads as bragging, so it's present on every finding
// uniformly. The gap/flaky findings stay plain fact; the recovery finding
// is the one place body copy earns a benefit-framed line, per the same
// memory's resolved branding note — same taste discipline as coach_
// perceived_value_design_principle.md, just with more room to let the
// software take credit since the coach (not the athlete) is the audience.
export function CalendarSpotterPanel({ findings }: { findings: CalendarSpotterFinding[] }) {
  if (findings.length === 0) return null;

  return (
    <div className="border border-rust/40 bg-rust/5 p-4">
      <p className="font-body text-xs text-rust uppercase tracking-wide font-medium mb-2">Calendar Spot</p>
      <div className="space-y-2">
        {findings.map((f) => (
          <div key={f.athleteId} className="flex items-start gap-2">
            <span
              className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${
                f.kind === "recovery" ? "bg-moss" : "bg-rust"
              }`}
            />
            <p className="font-body text-sm text-chalk flex-1">{f.message}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
