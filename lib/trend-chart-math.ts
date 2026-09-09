// Pure geometry for a simple time-series line chart: scales real dates/
// values into SVG coordinates, plus a least-squares trend line so "am I
// generally going up or down" reads at a glance even when the raw data is
// noisy day to day. Separated from the rendering component so the scaling
// math itself is directly testable without touching the DOM.
export interface TrendPoint {
  date: string;
  value: number;
}

export interface PlottedPoint {
  x: number;
  y: number;
  date: string;
  value: number;
}

export interface ChartGeometry {
  points: PlottedPoint[];
  trendLine: { x1: number; y1: number; x2: number; y2: number };
  minValue: number;
  maxValue: number;
}

export function computeChartGeometry(
  points: TrendPoint[],
  width: number,
  height: number,
  padding: number
): ChartGeometry | null {
  if (points.length < 2) return null;

  const sorted = points
    .slice()
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const times = sorted.map((p) => new Date(p.date).getTime());
  const values = sorted.map((p) => p.value);

  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const timeSpan = maxTime - minTime || 1;
  // A perfectly flat series (every value identical) would otherwise divide
  // by zero — draw it as a flat horizontal line across the middle instead.
  const valueSpan = maxValue - minValue || 1;

  const plotW = width - padding * 2;
  const plotH = height - padding * 2;

  function toXY(t: number, v: number) {
    return {
      x: padding + ((t - minTime) / timeSpan) * plotW,
      y: padding + (1 - (v - minValue) / valueSpan) * plotH,
    };
  }

  const plotted: PlottedPoint[] = sorted.map((p, i) => ({
    ...toXY(times[i], p.value),
    date: p.date,
    value: p.value,
  }));

  // Least-squares fit over normalized time (0..1) rather than raw
  // millisecond timestamps — keeps the math numerically stable regardless
  // of how far apart the real dates are.
  const n = sorted.length;
  const xs = times.map((t) => (t - minTime) / timeSpan);
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = values.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (values[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  const intercept = meanY - slope * meanX;

  const trendStart = toXY(minTime, intercept);
  const trendEnd = toXY(maxTime, intercept + slope);

  return {
    points: plotted,
    trendLine: { x1: trendStart.x, y1: trendStart.y, x2: trendEnd.x, y2: trendEnd.y },
    minValue,
    maxValue,
  };
}
