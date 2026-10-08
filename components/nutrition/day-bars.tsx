import type { DayBar } from "@/lib/nutrient-view";

// A small bar chart of one nutrient as a percent of the reference intake, one bar per day. Plain markup (no chart library). A bar is full height at 100% and above (its number is in
// the label); a day that does not count (too little logged, or too little of it reports the nutrient) is drawn light and dashed, and a day with nothing reported is a thin line, never
// a zero-height bar that would read as "none eaten".
export function DayBars({ bars, label, compact = false }: { bars: DayBar[]; label: string; compact?: boolean }) {
  const height = compact ? 48 : 96;
  return (
    <div role="img" aria-label={label} className="flex items-end gap-[3px]" style={{ height }}>
      {bars.map((b) => {
        const h = b.pct == null ? 2 : Math.max(2, Math.round((Math.min(100, b.pct) / 100) * height));
        const title = `${b.date}: ${b.total == null ? "not reported" : `${b.pct == null ? "" : `${b.pct}% of the reference · `}${Math.round(b.coveragePct)}% of the day's calories counted`}${b.total != null && !b.counts ? " · not counted (too little logged or reported)" : ""}`;
        return (
          <div key={b.date} className="flex-1 min-w-[3px] flex flex-col justify-end" style={{ height }} title={title}>
            <div
              className={b.pct == null ? "bg-steel/30" : b.counts ? "bg-rust" : "border border-dashed border-rust/60 bg-rust/10"}
              style={{ height: h }}
            />
          </div>
        );
      })}
    </div>
  );
}
