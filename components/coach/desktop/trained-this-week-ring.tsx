import { trainedThisWeek } from "@/lib/home-greeting";

// The ring in Home's greeting band (Look Refresh, Nov 20): how many clients trained this week, the same count as the Active this week tile.
export function TrainedThisWeekRing({ active, total, needCheckIn }: { active: number; total: number; needCheckIn: number }) {
  const t = trainedThisWeek(active, total);
  const r = 36;
  const circumference = 2 * Math.PI * r;
  const filled = (t.pct / 100) * circumference;
  return (
    <div className="flex items-center gap-4" data-trained-ring>
      <svg width="86" height="86" viewBox="0 0 86 86" role="img" aria-label={`${t.active} of ${t.total} clients trained this week`} className="shrink-0">
        <circle cx="43" cy="43" r={r} fill="none" stroke="rgb(var(--line))" strokeWidth="8" />
        {filled > 0 && (
          <circle
            cx="43"
            cy="43"
            r={r}
            fill="none"
            stroke="rgb(var(--rust))"
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={`${filled.toFixed(1)} ${circumference.toFixed(1)}`}
            transform="rotate(-90 43 43)"
          />
        )}
        <text x="43" y="50" textAnchor="middle" fill="rgb(var(--chalk))" className="font-display" fontSize="20">
          {t.pct}%
        </text>
      </svg>
      <div>
        <p className="font-body text-sm font-semibold text-chalk">
          {t.active} of {t.total} trained this week
        </p>
        <p className="font-body text-[13px] text-steel">{needCheckIn === 0 ? "No one needs a check-in" : `${needCheckIn} could use a check-in`}</p>
      </div>
    </div>
  );
}
