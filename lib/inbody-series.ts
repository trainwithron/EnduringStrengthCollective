// The InBody scans of one person, as the rows the app shows and the series the graphs draw. Pure.

export interface ScanRow {
  id: string;
  athlete_id: string;
  uploaded_by: string;
  scan_date: string; // YYYY-MM-DD
  weight_lb: number | null;
  skeletal_muscle_lb: number | null;
  body_fat_mass_lb: number | null;
  percent_body_fat: number | null;
  lean_mass_lb: number | null;
  photo_path: string | null;
  source: "photo" | "manual";
}

export interface ScanSeries {
  key: "weight" | "percentFat" | "muscle" | "fatMass";
  title: string;
  unit: string;
  points: { date: string; value: number }[];
}

const num = (v: unknown): number | null => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

export function parseScanRows(rows: any[] | null | undefined): ScanRow[] {
  return (rows ?? []).map((r) => ({
    id: String(r.id),
    athlete_id: String(r.athlete_id),
    uploaded_by: String(r.uploaded_by),
    scan_date: String(r.scan_date),
    weight_lb: num(r.weight_lb),
    skeletal_muscle_lb: num(r.skeletal_muscle_lb),
    body_fat_mass_lb: num(r.body_fat_mass_lb),
    percent_body_fat: num(r.percent_body_fat),
    lean_mass_lb: num(r.lean_mass_lb),
    photo_path: (r.photo_path as string | null) ?? null,
    source: r.source === "manual" ? "manual" : "photo",
  }));
}

// One point per scan date (two scans on one day: the later one added wins is not known here, so the last in the list is kept), oldest first.
export function scanSeries(rows: ScanRow[]): ScanSeries[] {
  const make = (key: ScanSeries["key"], title: string, unit: string, pick: (r: ScanRow) => number | null): ScanSeries => {
    const byDate = new Map<string, number>();
    for (const r of rows) {
      const v = pick(r);
      if (v != null) byDate.set(r.scan_date, v);
    }
    return { key, title, unit, points: Array.from(byDate.entries()).map(([date, value]) => ({ date, value })).sort((a, b) => a.date.localeCompare(b.date)) };
  };
  return [
    make("weight", "Body weight", " lbs", (r) => r.weight_lb),
    make("percentFat", "Percent body fat", "%", (r) => r.percent_body_fat),
    make("muscle", "Skeletal muscle mass", " lbs", (r) => r.skeletal_muscle_lb),
    make("fatMass", "Body fat mass", " lbs", (r) => r.body_fat_mass_lb),
  ];
}

// "182.4 lb · 17.4% fat · 82.1 lb muscle" for a list row; only what the scan has.
export function scanSummary(r: ScanRow): string {
  const parts: string[] = [];
  if (r.weight_lb != null) parts.push(`${r.weight_lb} lb`);
  if (r.percent_body_fat != null) parts.push(`${r.percent_body_fat}% fat`);
  if (r.skeletal_muscle_lb != null) parts.push(`${r.skeletal_muscle_lb} lb muscle`);
  if (parts.length === 0 && r.body_fat_mass_lb != null) parts.push(`${r.body_fat_mass_lb} lb fat`);
  return parts.join(" · ");
}

// Who may delete: the person themself, or the coach who added it.
export function canDeleteScan(row: Pick<ScanRow, "athlete_id" | "uploaded_by">, viewerId: string): boolean {
  return row.athlete_id === viewerId || row.uploaded_by === viewerId;
}
