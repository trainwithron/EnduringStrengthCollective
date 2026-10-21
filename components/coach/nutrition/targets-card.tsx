import type { ReactNode } from "react";

// The one Targets card of a coach's Nutrition page (Ron, Oct 21: one number used to be proposed in three places and the phase shown three times). In order: a suggestion waiting for the
// coach (the starting target, or the weekly check-in's) with Accept / Edit, the standing target with the calculator at its top, and the phase of record. Everything else that shapes the
// target (the switches, the body numbers, the phase review, the spotter) is under one Details, whose line says when something there needs a look.
export function TargetsCard({
  suggestion,
  standing,
  phase,
  details,
  detailsFlags,
}: {
  suggestion: ReactNode;
  standing: ReactNode;
  phase: ReactNode;
  details: ReactNode;
  /** e.g. ["Phase review due", "2 things to look at"]; empty when nothing needs a look */
  detailsFlags: string[];
}) {
  return (
    <div className="space-y-5" data-targets-card>
      {suggestion}
      {standing}
      {phase}
      <details className="border border-steel/20" data-target-details>
        <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden flex items-center justify-between gap-3 min-h-[44px] px-4">
          <span className="font-body text-sm text-chalk">Details</span>
          <span className={`font-body text-xs ${detailsFlags.length > 0 ? "text-amber" : "text-steel"}`}>
            {detailsFlags.length > 0 ? detailsFlags.join(" · ") : "Tracking, body numbers, phase review"}
          </span>
        </summary>
        <div className="px-4 pb-4 pt-3 border-t border-steel/15 space-y-6">{details}</div>
      </details>
    </div>
  );
}
