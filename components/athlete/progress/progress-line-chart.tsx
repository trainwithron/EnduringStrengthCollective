// The client's progress line (wave 2: My progress and Measurements; Ron approved the mockups Nov 20): one series over time, a soft accent fill under the line, a
// dot on the latest point, and the months along the bottom. Plain SVG (no chart library, like the coach's TrendChart), coloured from the theme tokens so an
// organization's own accent draws it. Dates are YYYY-MM-DD; points are spaced by time, not by count. Under two points it draws nothing and says so.

export interface LinePoint {
  date: string;
  value: number;
}

const W = 330;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayNum = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))) / 86400000;

export function chartPoints(points: LinePoint[], height: number, pad = 10): { x: number; y: number; point: LinePoint }[] {
  const pts = points.filter((p) => /^\d{4}-\d{2}-\d{2}/.test(p.date) && Number.isFinite(p.value)).sort((a, b) => a.date.localeCompare(b.date));
  if (pts.length < 2) return [];
  const x0 = dayNum(pts[0].date);
  const x1 = dayNum(pts[pts.length - 1].date);
  const lo = Math.min(...pts.map((p) => p.value));
  const hi = Math.max(...pts.map((p) => p.value));
  const span = hi - lo || 1;
  return pts.map((p) => ({
    x: x1 === x0 ? W / 2 : ((dayNum(p.date) - x0) / (x1 - x0)) * (W - 2 * pad) + pad,
    y: height - pad - ((p.value - lo) / span) * (height - 2 * pad),
    point: p,
  }));
}

/** Up to four month names spread across the span, for the labels under the line. */
export function monthTicks(points: LinePoint[]): string[] {
  const keys = [...new Set(points.map((p) => p.date.slice(0, 7)).filter((k) => /^\d{4}-\d{2}$/.test(k)))].sort();
  if (keys.length <= 4) return keys.map((k) => MONTHS[Number(k.slice(5, 7)) - 1]);
  const step = (keys.length - 1) / 3;
  return [0, 1, 2, 3].map((i) => MONTHS[Number(keys[Math.round(i * step)].slice(5, 7)) - 1]);
}

export function ProgressLineChart({
  points,
  label,
  height = 120,
  dots = false,
  emptyLabel = "Two or more entries draw the line.",
}: {
  points: LinePoint[];
  // what the line shows, for a screen reader ("Estimated max, from 235 to 255 lb")
  label: string;
  height?: number;
  // a dot on every point (a few readings, like measurements), not only the latest
  dots?: boolean;
  emptyLabel?: string;
}) {
  const plotted = chartPoints(points, height);
  if (plotted.length === 0) return <p className="font-body text-sm text-steel py-3">{emptyLabel}</p>;
  const line = plotted.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const area = `${line} L${plotted[plotted.length - 1].x.toFixed(1)} ${height} L${plotted[0].x.toFixed(1)} ${height} Z`;
  const last = plotted[plotted.length - 1];
  const ticks = monthTicks(plotted.map((p) => p.point));
  return (
    <div>
      <svg width="100%" height={height} viewBox={`0 0 ${W} ${height}`} role="img" aria-label={label}>
        {[0.2, 0.55, 0.9].map((f) => (
          <line key={f} x1="0" x2={W} y1={height * f} y2={height * f} stroke="rgb(var(--line))" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        ))}
        <path d={area} fill="rgb(var(--rust) / 0.14)" />
        <path d={line} fill="none" stroke="rgb(var(--rust))" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {dots && plotted.slice(0, -1).map((p) => <circle key={p.point.date} cx={p.x} cy={p.y} r="3.5" fill="rgb(var(--rust))" />)}
        <circle cx={last.x} cy={last.y} r="4.5" fill="rgb(var(--rust))" stroke="rgb(var(--surface))" strokeWidth="2" />
      </svg>
      {ticks.length > 1 && (
        <div className="flex justify-between font-body text-[11px] text-steel mt-1" aria-hidden="true">
          {ticks.map((t, i) => (
            <span key={`${t}-${i}`}>{t}</span>
          ))}
        </div>
      )}
    </div>
  );
}
