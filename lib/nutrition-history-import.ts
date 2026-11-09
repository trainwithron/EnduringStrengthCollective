import { MEAL_SLOTS, type MealSlot } from "@/lib/food-entry";
import { daysBetweenKeys, dateKeyOfParts } from "@/lib/date-key";

// Reading a client's food diary exported from another app, so a coach can bring their history into Spotlight (Ron, Nov 9). Pure: the file's text in, rows out. Nothing here
// touches the database, the network or a log; the file is read in the coach's browser and only the rows below are sent to our own route.
//
// Three exports are recognized, each by its column NAMES (any order, any case, extra columns ignored). A format whose columns are not all found is not matched: nothing is guessed.
//   * Cronometer "Servings": Day, Group, Food Name, Amount, Energy (kcal), Protein (g), Carbs (g) (or Net Carbs (g)), Fat (g). One row per food; Group is the meal.
//   * MyFitnessPal "Nutrition": Date, Meal, Calories, Fat (g), Carbohydrates (g), Protein (g). One row per MEAL (the meal's totals), so each becomes one entry.
//   * MacroFactor food log (its headers are not confirmed yet): Date, Food Name, Calories, Protein, Carbs, Fat. Any file with those named columns is read the same way.
// Dates from today on are left out (today is for logging live), and so are rows that are blank, day totals, or have a number that cannot be read.

export type HistorySource = "cronometer" | "myfitnesspal" | "macrofactor";

export interface ImportedFoodRow {
  date: string; // YYYY-MM-DD
  mealSlot: MealSlot | null;
  description: string;
  servingLabel: string | null;
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
}

export interface SkippedImportRow {
  rowNumber: number; // the row in the file, the header being row 1
  reason: string;
}

export type NutritionHistoryParse =
  | {
      ok: true;
      source: HistorySource;
      sourceLabel: string;
      // What one row is, for the preview: "412 foods" or "280 meal totals".
      rowWord: { one: string; many: string };
      rows: ImportedFoodRow[]; // date order, file order within a day
      dayCount: number;
      firstDate: string;
      lastDate: string;
      skipped: SkippedImportRow[];
      leftOutFromToday: number;
    }
  | { ok: false; error: string };

export const IMPORT_MAX_ROWS = 20000;
// About two years of days, first to last.
export const IMPORT_MAX_SPAN_DAYS = 731;
export const IMPORT_EARLIEST_DATE = "2000-01-01";
// The database refuses an entry over these (food_log_entries_amounts_sane, migration 0300), so a row over them is left out here with a reason instead of failing the save.
export const IMPORT_LIMITS = { calories: 20000, proteinG: 2000, carbsG: 5000, fatG: 2000 } as const;
export const IMPORT_MAX_DESCRIPTION = 160;
export const IMPORT_MAX_SERVING = 120;

const NOTHING_SAVED = "Nothing was saved.";
export const UNRECOGNIZED_FILE =
  "Spotlight can't read this file. Upload the CSV export from Cronometer (Servings), MyFitnessPal (Nutrition) or MacroFactor (food log). " + NOTHING_SAVED;

// ---------------------------------------------------------------- CSV

// Splits CSV text into rows of cells: quoted cells (with "" for a quote, and commas or line breaks inside), CRLF or LF line ends, a byte-order mark at the start. The separator is
// the one the header line uses most (a comma, else a semicolon or a tab, which some spreadsheet programs write). Rows with nothing in them are dropped.
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const sep = separatorOf(src);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === sep) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  row.push(cell);
  rows.push(row);
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

function separatorOf(src: string): string {
  let quoted = false;
  const count: Record<string, number> = { ",": 0, ";": 0, "\t": 0 };
  for (const c of src) {
    if (c === '"') quoted = !quoted;
    else if (!quoted && (c === "\n" || c === "\r")) break;
    else if (!quoted && c in count) count[c]++;
  }
  if (count[","] > 0 && count[","] >= count[";"] && count[","] >= count["\t"]) return ",";
  if (count[";"] > 0 && count[";"] >= count["\t"]) return ";";
  if (count["\t"] > 0) return "\t";
  return ",";
}

// ---------------------------------------------------------------- columns

const norm = (s: string) => s.replace(/^﻿/, "").trim().toLowerCase().replace(/\s+/g, " ");

// The column whose name is exactly one of the names (compared without case or extra spaces), trying the names in order. -1 when none is there.
function col(header: string[], names: readonly string[]): number {
  const h = header.map(norm);
  for (const name of names) {
    const i = h.indexOf(name);
    if (i >= 0) return i;
  }
  return -1;
}

const NAMES = {
  cronometer: {
    day: ["day"],
    time: ["time"],
    group: ["group"],
    food: ["food name"],
    amount: ["amount"],
    energy: ["energy (kcal)"],
    protein: ["protein (g)"],
    carbs: ["carbs (g)", "net carbs (g)"],
    fat: ["fat (g)"],
  },
  myfitnesspal: {
    date: ["date"],
    meal: ["meal"],
    calories: ["calories"],
    protein: ["protein (g)", "protein"],
    carbs: ["carbohydrates (g)", "carbohydrates", "carbs (g)", "carbs"],
    fat: ["fat (g)", "fat", "total fat (g)"],
  },
  macrofactor: {
    date: ["date"],
    food: ["food name", "food", "name", "food item"],
    meal: ["meal"],
    serving: ["serving"],
    qty: ["serving size", "serving qty", "serving quantity", "servings", "quantity", "qty", "amount"],
    unit: ["serving unit", "unit", "units"],
    calories: ["calories (kcal)", "calories", "energy (kcal)", "kcal"],
    protein: ["protein (g)", "protein"],
    carbs: ["carbs (g)", "carbs", "carbohydrates (g)", "carbohydrates", "total carbs (g)"],
    fat: ["fat (g)", "fat", "total fat (g)"],
  },
} as const;

const SHOWN = { protein: "Protein", carbs: "Carbs", fat: "Fat", calories: "Calories" } as const;

type Macros = { calories: number; protein: number; carbs: number; fat: number };

type Detected =
  | { source: "cronometer"; c: { day: number; group: number; food: number; amount: number } & Macros }
  | { source: "myfitnesspal"; c: { date: number; meal: number } & Macros }
  | { source: "macrofactor"; c: { date: number; food: number; meal: number; serving: number; qty: number; unit: number } & Macros };

// Which export this is, from its header. Either the format and its columns, or a plain reason it cannot be read.
export function detectHistoryFormat(header: string[]): Detected | { error: string } {
  const cr = NAMES.cronometer;
  const missing = (label: string, cols: [keyof typeof SHOWN, number][]) => {
    const gone = cols.filter(([, i]) => i < 0).map(([k]) => SHOWN[k]);
    return gone.length > 0 ? { error: `This looks like a ${label} export, but it has no ${listOf(gone)} column, so it can't be read. ${NOTHING_SAVED}` } : null;
  };

  // Cronometer servings: Day + Food Name + Energy (kcal) say which file it is; the three macros must be there too.
  const day = col(header, cr.day);
  const crFood = col(header, cr.food);
  const energy = col(header, cr.energy);
  if (day >= 0 && crFood >= 0 && energy >= 0) {
    const m = { calories: energy, protein: col(header, cr.protein), carbs: col(header, cr.carbs), fat: col(header, cr.fat) };
    const gone = missing("Cronometer", [["protein", m.protein], ["carbs", m.carbs], ["fat", m.fat]]);
    if (gone) return gone;
    return { source: "cronometer", c: { day, food: crFood, group: col(header, cr.group), amount: col(header, cr.amount), ...m } };
  }

  const date = col(header, NAMES.myfitnesspal.date);
  const mfFood = col(header, NAMES.macrofactor.food);

  // Cronometer's daily summary has a Date and Energy (kcal) but no foods: say which file to export instead.
  if (date >= 0 && energy >= 0 && mfFood < 0 && crFood < 0 && col(header, NAMES.myfitnesspal.meal) < 0) {
    return { error: `This looks like Cronometer's daily summary, which has no foods in it. In Cronometer, export "Servings" instead and upload that file. ${NOTHING_SAVED}` };
  }

  // MyFitnessPal: one row per meal (Date + Meal + Calories), and no food names.
  const meal = col(header, NAMES.myfitnesspal.meal);
  const mfpCalories = col(header, NAMES.myfitnesspal.calories);
  if (date >= 0 && meal >= 0 && mfpCalories >= 0 && mfFood < 0) {
    const m = { calories: mfpCalories, protein: col(header, NAMES.myfitnesspal.protein), carbs: col(header, NAMES.myfitnesspal.carbs), fat: col(header, NAMES.myfitnesspal.fat) };
    const gone = missing("MyFitnessPal", [["protein", m.protein], ["carbs", m.carbs], ["fat", m.fat]]);
    if (gone) return gone;
    return { source: "myfitnesspal", c: { date, meal, ...m } };
  }

  // A food log (MacroFactor): Date + a food name column, and calories and all three macros. Anything less is not recognized.
  if (date >= 0 && mfFood >= 0) {
    const mf = NAMES.macrofactor;
    const m = { calories: col(header, mf.calories), protein: col(header, mf.protein), carbs: col(header, mf.carbs), fat: col(header, mf.fat) };
    const gone = missing("food log", [["calories", m.calories], ["protein", m.protein], ["carbs", m.carbs], ["fat", m.fat]]);
    if (gone) return gone;
    return { source: "macrofactor", c: { date, food: mfFood, meal: col(header, mf.meal), serving: col(header, mf.serving), qty: col(header, mf.qty), unit: col(header, mf.unit), ...m } };
  }

  return { error: UNRECOGNIZED_FILE };
}

function listOf(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
}

// ---------------------------------------------------------------- cells

// A number cell: empty is "not reported" (null); "1,234.5" is 1234.5; anything else that is not a plain number is unreadable (a comma that is not a thousands separator is not
// guessed to be a decimal point).
export function parseNumberCell(cell: string | undefined): { value: number | null; bad: boolean } {
  const s = (cell ?? "").trim().replace(/\s+/g, "");
  if (s === "" || s === "-" || s === "—") return { value: null, bad: false };
  const plain = /^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s) ? s.replace(/,/g, "") : s;
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(plain)) return { value: null, bad: true };
  const n = Number(plain);
  return Number.isFinite(n) ? { value: n, bad: false } : { value: null, bad: true };
}

type DayOrder = "mdy" | "dmy";

const ISO = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/;
const SLASHED = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/;
const datePart = (cell: string) => cell.trim().split(/[T ]/)[0] ?? "";

// Whether slashed dates ("8/3/2026") are month first or day first, from every date in the file: a first number over 12 means day first, a second over 12 means month first.
// A file that never shows which (every date could be either) or shows both cannot be read: the day is never guessed.
export function slashedDateOrder(cells: string[]): DayOrder | "none" | "unclear" {
  let any = false;
  let dayFirst = false;
  let monthFirst = false;
  for (const cell of cells) {
    const m = SLASHED.exec(datePart(cell));
    if (!m) continue;
    any = true;
    if (Number(m[1]) > 12) dayFirst = true;
    if (Number(m[2]) > 12) monthFirst = true;
  }
  if (!any) return "none";
  if (dayFirst === monthFirst) return "unclear";
  return dayFirst ? "dmy" : "mdy";
}

// A date cell as a YYYY-MM-DD key, or null when it is not a real calendar date. A time after the date ("2026-08-03 07:15") is ignored.
export function parseDateCell(cell: string | undefined, order: DayOrder | null): string | null {
  const s = datePart(cell ?? "");
  let y: number, mo: number, d: number;
  const iso = ISO.exec(s);
  const sl = SLASHED.exec(s);
  if (iso) [y, mo, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (sl && order) [y, mo, d] = order === "mdy" ? [Number(sl[3]), Number(sl[1]), Number(sl[2])] : [Number(sl[3]), Number(sl[2]), Number(sl[1])];
  else return null;
  if (mo < 1 || mo > 12 || d < 1) return null;
  const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  if (d > daysInMonth) return null;
  return dateKeyOfParts(y, mo - 1, d);
}

// The meal a row belongs to: Breakfast, Lunch, Dinner (or Supper), and anything with "snack" in it. Any other group ("Uncategorized", "Pre-workout") is no meal.
export function mealSlotOf(name: string | undefined): MealSlot | null {
  const s = norm(name ?? "");
  if (s === "breakfast") return "breakfast";
  if (s === "lunch") return "lunch";
  if (s === "dinner" || s === "supper") return "dinner";
  if (s.includes("snack")) return "snack";
  return null;
}

const TOTAL_WORD = /^(daily |day )?totals?:?$/;

// Cronometer writes a total row for each day in the Group column. A row is a total when its group says Total AND it has no food of its own (no name, or a name that is itself
// "Total"). A real group someone named "Total" still has real foods with real names, and those are kept.
export function isCronometerTotalRow(group: string | undefined, foodName: string | undefined): boolean {
  if (!TOTAL_WORD.test(norm(group ?? ""))) return false;
  const food = norm(foodName ?? "");
  return food === "" || TOTAL_WORD.test(food);
}

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

// ---------------------------------------------------------------- the file

export function parseNutritionHistory(text: string, opts: { todayKey: string; fileName?: string }): NutritionHistoryParse {
  const table = parseCsv(text);
  if (table.length === 0) return { ok: false, error: `That file is empty. ${NOTHING_SAVED}` };
  const [header, ...body] = table;
  const found = detectHistoryFormat(header);
  if ("error" in found) return { ok: false, error: found.error };
  if (body.length === 0) return { ok: false, error: `That file has no rows below the column names. ${NOTHING_SAVED}` };
  if (body.length > IMPORT_MAX_ROWS * 2) return { ok: false, error: tooManyRows(body.length) };

  const dateCol = found.source === "cronometer" ? found.c.day : found.c.date;
  const order = slashedDateOrder(body.map((r) => r[dateCol] ?? ""));
  if (order === "unclear") {
    return {
      ok: false,
      error: `The dates in this file could be month/day or day/month, and Spotlight won't guess which. Export it again with dates written as year-month-day (2026-08-03). ${NOTHING_SAVED}`,
    };
  }

  const rows: ImportedFoodRow[] = [];
  const skipped: SkippedImportRow[] = [];
  let leftOutFromToday = 0;
  const cell = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");

  body.forEach((r, i) => {
    const rowNumber = i + 2;
    const skip = (reason: string) => skipped.push({ rowNumber, reason });

    let description = "";
    let mealSlot: MealSlot | null = null;
    let servingLabel = "";
    if (found.source === "cronometer") {
      const group = cell(r, found.c.group);
      const food = cell(r, found.c.food);
      if (isCronometerTotalRow(group, food)) return skip("a day's total, not a food");
      if (!food) return skip("no food name");
      description = food;
      mealSlot = mealSlotOf(group);
      servingLabel = cell(r, found.c.amount);
    } else if (found.source === "myfitnesspal") {
      const meal = cell(r, found.c.meal);
      if (!meal) return skip("no meal name");
      if (TOTAL_WORD.test(norm(meal))) return skip("a day's total, not a meal");
      description = `${meal} (MyFitnessPal total)`;
      mealSlot = mealSlotOf(meal);
    } else {
      const food = cell(r, found.c.food);
      if (!food) return skip("no food name");
      if (TOTAL_WORD.test(norm(food))) return skip("a total, not a food");
      description = food;
      mealSlot = mealSlotOf(cell(r, found.c.meal));
      servingLabel = cell(r, found.c.serving) || [cell(r, found.c.qty), cell(r, found.c.unit)].filter(Boolean).join(" ");
    }

    const rawDate = cell(r, dateCol);
    if (!rawDate) return skip("no date");
    const date = parseDateCell(rawDate, order === "none" ? null : order);
    if (!date) return skip("a date that isn't readable");
    if (date < IMPORT_EARLIEST_DATE) return skip("a date before 2000");

    const nums = {
      calories: parseNumberCell(r[found.c.calories]),
      proteinG: parseNumberCell(r[found.c.protein]),
      carbsG: parseNumberCell(r[found.c.carbs]),
      fatG: parseNumberCell(r[found.c.fat]),
    };
    if (Object.values(nums).some((n) => n.bad)) return skip("a number that isn't readable");
    const tooBig = (Object.keys(IMPORT_LIMITS) as (keyof typeof IMPORT_LIMITS)[]).some((k) => {
      const v = nums[k].value;
      return v != null && (v < 0 || v > IMPORT_LIMITS[k]);
    });
    if (tooBig) return skip("a number too large (or below zero) for one entry");

    // Today and later are for logging live in the app; they are left out, counted, not listed.
    if (date >= opts.todayKey) {
      leftOutFromToday++;
      return;
    }

    rows.push({
      date,
      mealSlot,
      description: clip(description, IMPORT_MAX_DESCRIPTION),
      servingLabel: servingLabel ? clip(servingLabel, IMPORT_MAX_SERVING) : null,
      calories: nums.calories.value,
      proteinG: nums.proteinG.value,
      carbsG: nums.carbsG.value,
      fatG: nums.fatG.value,
    });
  });

  if (rows.length === 0) {
    const why = leftOutFromToday > 0 && skipped.length === 0 ? "Every row is dated today or later, and only past days can be brought in." : "No row had a date and a food Spotlight could read.";
    return { ok: false, error: `${why} ${NOTHING_SAVED}` };
  }
  if (rows.length > IMPORT_MAX_ROWS) return { ok: false, error: tooManyRows(rows.length) };

  // Date order, keeping the file's order within a day (a stable sort).
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const firstDate = rows[0].date;
  const lastDate = rows[rows.length - 1].date;
  if ((daysBetweenKeys(firstDate, lastDate) ?? 0) > IMPORT_MAX_SPAN_DAYS) {
    return {
      ok: false,
      error: `This file runs from ${dayLabel(firstDate, true)} to ${dayLabel(lastDate, true)}, which is more than 2 years. Export up to 2 years at a time and upload each file. ${NOTHING_SAVED}`,
    };
  }

  const sourceLabel =
    found.source === "cronometer" ? "Cronometer" : found.source === "myfitnesspal" ? "MyFitnessPal" : /macro\s*factor/i.test(opts.fileName ?? "") ? "MacroFactor" : "a food log";
  return {
    ok: true,
    source: found.source,
    sourceLabel,
    rowWord: found.source === "myfitnesspal" ? { one: "meal total", many: "meal totals" } : { one: "food", many: "foods" },
    rows,
    dayCount: new Set(rows.map((r) => r.date)).size,
    firstDate,
    lastDate,
    skipped,
    leftOutFromToday,
  };
}

function tooManyRows(n: number): string {
  return `This file has ${n.toLocaleString("en-US")} rows. Up to ${IMPORT_MAX_ROWS.toLocaleString("en-US")} can be brought in at once: export a shorter date range and upload each file. ${NOTHING_SAVED}`;
}

// ---------------------------------------------------------------- the preview

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "Aug 3", or "Aug 3, 2026" with the year.
export function dayLabel(key: string, withYear = false): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return key;
  const base = `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}`;
  return withYear ? `${base}, ${m[1]}` : base;
}

const plural = (n: number, w: { one: string; many: string }) => `${n.toLocaleString("en-US")} ${n === 1 ? w.one : w.many}`;

// "Found 94 days, Aug 3 to Nov 8 · 412 foods". The years are shown when the range is not all in this year.
export function previewLine(p: { dayCount: number; firstDate: string; lastDate: string; rows: unknown[]; rowWord: { one: string; many: string } }, todayKey: string): string {
  const thisYear = todayKey.slice(0, 4);
  const withYear = p.firstDate.slice(0, 4) !== thisYear || p.lastDate.slice(0, 4) !== thisYear;
  const range = p.dayCount === 1 ? dayLabel(p.firstDate, withYear) : `${dayLabel(p.firstDate, withYear)} to ${dayLabel(p.lastDate, withYear)}`;
  return `Found ${plural(p.dayCount, { one: "day", many: "days" })}, ${range} · ${plural(p.rows.length, p.rowWord)}`;
}

const r0 = (n: number | null) => (n == null ? "–" : String(Math.round(n)));

// One sample row: "Aug 3 · Breakfast · Oatmeal, 1.00 cup · 300 cal · 10 P / 54 C / 6 F".
export function sampleLine(row: ImportedFoodRow): string {
  const meal = row.mealSlot ? `${row.mealSlot[0].toUpperCase()}${row.mealSlot.slice(1)} · ` : "";
  const food = row.servingLabel ? `${row.description}, ${row.servingLabel}` : row.description;
  return `${dayLabel(row.date)} · ${meal}${food} · ${r0(row.calories)} cal · ${r0(row.proteinG)} P / ${r0(row.carbsG)} C / ${r0(row.fatG)} F`;
}

// ---------------------------------------------------------------- sending and checking

// The rows in groups of at most `maxRows`, never splitting a day (a day with more rows than that is a group of its own). Rows must be in date order.
export function chunkByDay(rows: ImportedFoodRow[], maxRows: number): ImportedFoodRow[][] {
  const chunks: ImportedFoodRow[][] = [];
  let current: ImportedFoodRow[] = [];
  let i = 0;
  while (i < rows.length) {
    let j = i;
    while (j < rows.length && rows[j].date === rows[i].date) j++;
    const day = rows.slice(i, j);
    if (current.length > 0 && current.length + day.length > maxRows) {
      chunks.push(current);
      current = [];
    }
    current.push(...day);
    i = j;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

const okNumber = (v: unknown, max: number): v is number | null => v === null || (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max);

// The server checks every row it is sent again (the page is not the only way to call the route). A row that is not exactly a valid imported row is refused (null).
export function checkImportRow(raw: unknown): ImportedFoodRow | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.date !== "string" || parseDateCell(r.date, null) !== r.date || r.date < IMPORT_EARLIEST_DATE) return null;
  const mealSlot = r.mealSlot ?? null;
  if (mealSlot !== null && !(MEAL_SLOTS as readonly unknown[]).includes(mealSlot)) return null;
  if (typeof r.description !== "string" || r.description.trim() === "" || r.description.length > IMPORT_MAX_DESCRIPTION) return null;
  const servingLabel = r.servingLabel ?? null;
  if (servingLabel !== null && (typeof servingLabel !== "string" || servingLabel.length > IMPORT_MAX_SERVING)) return null;
  const calories = r.calories ?? null;
  const proteinG = r.proteinG ?? null;
  const carbsG = r.carbsG ?? null;
  const fatG = r.fatG ?? null;
  if (!okNumber(calories, IMPORT_LIMITS.calories) || !okNumber(proteinG, IMPORT_LIMITS.proteinG) || !okNumber(carbsG, IMPORT_LIMITS.carbsG) || !okNumber(fatG, IMPORT_LIMITS.fatG)) return null;
  return { date: r.date, mealSlot: mealSlot as MealSlot | null, description: r.description.trim(), servingLabel: servingLabel ? (servingLabel as string).trim() || null : null, calories, proteinG, carbsG, fatG };
}
