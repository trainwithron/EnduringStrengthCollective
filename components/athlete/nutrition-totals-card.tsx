// The first thing on the client's Nutrition page (Look Refresh, Ron Nov 20): what is logged for the day as a calories ring and protein / carbs / fat bars. With a target the
// ring and bars fill toward it; without one they show the logged numbers and stay empty, with the same friendly line as before. Colors come from the organization's theme.
import { OpenSetTargetsButton } from "@/components/athlete/set-my-targets-sheet";

export interface TotalsLike {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

export interface TargetLike {
  calories?: number | null;
  proteinG?: number | null;
  carbsG?: number | null;
  fatG?: number | null;
}

const share = (logged: number, target: number | null | undefined) => (target != null && target > 0 ? Math.min(1, Math.max(0, logged / target)) : 0);

export function NutritionTotalsCard({
  title,
  totals,
  target,
  withTarget,
  noTargetLine,
  coachCanSeeLine,
  setTargetsHref,
}: {
  title: string;
  totals: TotalsLike;
  target: TargetLike | null | undefined;
  withTarget: boolean;
  // The line under the bars when there is no target (null: none).
  noTargetLine: string | null;
  // "Your coach can see what you log here." (null in the coach's own space).
  coachCanSeeLine: string | null;
  // Where "Set my targets" is on this page, when the client may set their own.
  setTargetsHref?: string | null;
}) {
  const kcal = Math.round(totals.calories);
  const kcalTarget = withTarget && target?.calories != null ? Math.round(target.calories) : null;
  const r = 40;
  const circumference = 2 * Math.PI * r;
  const filled = share(totals.calories, kcalTarget) * circumference;
  const bars: { key: string; label: string; logged: number; target: number | null }[] = [
    { key: "protein", label: "Protein", logged: totals.proteinG, target: withTarget && target?.proteinG != null ? Math.round(target.proteinG) : null },
    { key: "carbs", label: "Carbs", logged: totals.carbsG, target: withTarget && target?.carbsG != null ? Math.round(target.carbsG) : null },
    { key: "fat", label: "Fat", logged: totals.fatG, target: withTarget && target?.fatG != null ? Math.round(target.fatG) : null },
  ];
  return (
    <section className="bg-surface rounded-card p-4 sm:p-5" data-testid="logged-totals" aria-label={title}>
      <p className="font-body text-[13px] font-semibold text-steel mb-3">{title}</p>
      <div className="flex items-center gap-4 sm:gap-5">
        <svg
          width="96"
          height="96"
          viewBox="0 0 96 96"
          role="img"
          aria-label={kcalTarget != null ? `${kcal} of ${kcalTarget} calories` : `${kcal} calories logged, no target`}
          className="shrink-0"
        >
          <circle cx="48" cy="48" r={r} fill="none" stroke="rgb(var(--line))" strokeWidth="9" />
          {filled > 0 && (
            <circle
              cx="48"
              cy="48"
              r={r}
              fill="none"
              stroke="rgb(var(--rust))"
              strokeWidth="9"
              strokeLinecap="round"
              strokeDasharray={`${filled.toFixed(1)} ${circumference.toFixed(1)}`}
              transform="rotate(-90 48 48)"
            />
          )}
          <text x="48" y="50" textAnchor="middle" fill="rgb(var(--chalk))" className="font-display" fontSize="24">
            {kcal}
          </text>
          <text x="48" y="66" textAnchor="middle" fill="rgb(var(--steel))" className="font-body" fontSize="11">
            {kcalTarget != null ? `of ${kcalTarget} kcal` : "kcal"}
          </text>
        </svg>
        <div className="flex-1 min-w-0 flex flex-col gap-2">
          {bars.map((b) => (
            <div key={b.key}>
              <div className="flex items-baseline justify-between gap-2 font-body text-xs">
                <span className="text-chalk">{b.label}</span>
                <span className="text-steel [font-variant-numeric:tabular-nums]">
                  {Math.round(b.logged)}
                  {b.target != null ? ` / ${b.target}` : ""} g
                </span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-line overflow-hidden" aria-hidden="true">
                {b.target != null && <div className="h-full rounded-full bg-rust" style={{ width: `${Math.round(share(b.logged, b.target) * 100)}%` }} />}
              </div>
            </div>
          ))}
        </div>
      </div>
      {!withTarget && noTargetLine && (
        <p className="font-body text-xs text-steel mt-3">
          {noTargetLine}
          {setTargetsHref && (
            <>
              {" "}
              <OpenSetTargetsButton fallbackHref={setTargetsHref} className="inline-flex items-center min-h-[44px] text-rust-ink font-semibold underline-offset-2 hover:underline" />
            </>
          )}
        </p>
      )}
      {coachCanSeeLine && <p className="font-body text-xs text-steel mt-1">{coachCanSeeLine}</p>}
    </section>
  );
}
