// Reading an InBody result sheet from a photo (release CE). The AI only COPIES what is printed, each number with the unit printed beside it (never computes, never guesses); this file turns that into the
// numbers the app stores (pounds, litres), refuses anything impossible, and works out the checks the review screen shows. Nothing here saves anything: the person looks at every number first.
// Pure, so the rules are tested without a camera.

export const KG_TO_LB = 2.2046226218;

export const INBODY_SYSTEM_PROMPT = `You read the printed text of an InBody body-composition result sheet from a photo. You COPY numbers exactly as printed. You never calculate, convert, estimate or guess.

Return ONLY one JSON object with these keys. Use null for anything you cannot read clearly in the photo. Give every weight or mass as {"value": number, "unit": "kg" or "lb"} with the unit that is PRINTED next to it on the sheet (check the column headings and the unit labels; sheets use either).

{
  "scanDateText": string | null,            // the date and time printed on the sheet, exactly as printed
  "weight": {"value": number, "unit": "kg" | "lb"} | null,
  "skeletalMuscleMass": {"value": number, "unit": "kg" | "lb"} | null,
  "bodyFatMass": {"value": number, "unit": "kg" | "lb"} | null,
  "percentBodyFat": number | null,           // percent, as printed
  "leanBodyMass": {"value": number, "unit": "kg" | "lb"} | null,   // also called fat free mass
  "bmi": number | null,
  "totalBodyWater": {"value": number, "unit": "L" | "kg" | "lb"} | null,
  "ecwRatio": number | null,                 // extracellular water ratio, like 0.380
  "visceralFatLevel": number | null,
  "bmr": number | null,                      // basal metabolic rate, kcal
  "inbodyScore": number | null,
  "segmental": {                             // the limb-by-limb section, or null if the sheet has none
    "rightArm": {"lean": {"value": number, "unit": "kg" | "lb"} | null, "fat": {"value": number, "unit": "kg" | "lb"} | null} | null,
    "leftArm": ... same shape ... | null,
    "trunk": ... same shape ... | null,
    "rightLeg": ... same shape ... | null,
    "leftLeg": ... same shape ... | null
  } | null
}

Rules:
- If the photo is not an InBody result sheet, or is too blurry to read, return exactly: {"error": "That doesn't look like a readable InBody sheet. Try a clearer, flat photo of the whole page, or type the numbers in."}
- Do not include any other text, notes or markdown.`;

export interface SegmentValues {
  leanLb: number | null;
  fatLb: number | null;
}

export interface ScanValues {
  scanDate: string | null; // YYYY-MM-DD
  weightLb: number | null;
  skeletalMuscleLb: number | null;
  bodyFatMassLb: number | null;
  percentBodyFat: number | null;
  leanMassLb: number | null;
  bmi: number | null;
  totalBodyWaterL: number | null;
  ecwRatio: number | null;
  visceralLevel: number | null;
  bmrKcal: number | null;
  inbodyScore: number | null;
  segments: Record<string, SegmentValues> | null;
}

export const EMPTY_SCAN: ScanValues = {
  scanDate: null,
  weightLb: null,
  skeletalMuscleLb: null,
  bodyFatMassLb: null,
  percentBodyFat: null,
  leanMassLb: null,
  bmi: null,
  totalBodyWaterL: null,
  ecwRatio: null,
  visceralLevel: null,
  bmrKcal: null,
  inbodyScore: null,
  segments: null,
};

// What a number may be at all (the same limits the table holds), so a misread digit is dropped to blank rather than saved.
const LIMITS = {
  weightLb: [20, 1000],
  skeletalMuscleLb: [5, 400],
  bodyFatMassLb: [1, 800],
  percentBodyFat: [1, 80],
  leanMassLb: [10, 600],
  bmi: [8, 90],
  totalBodyWaterL: [5, 200],
  ecwRatio: [0.2, 0.6],
  visceralLevel: [1, 40],
  bmrKcal: [400, 6000],
  inbodyScore: [0, 100],
} as const;

const round = (n: number, places = 1) => Math.round(n * 10 ** places) / 10 ** places;

function within(value: number | null, key: keyof typeof LIMITS): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const [lo, hi] = LIMITS[key];
  return value >= lo && value <= hi ? value : null;
}

function plain(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

// {"value": 82.4, "unit": "kg"} -> pounds. An unknown or missing unit is not guessed at: the number is left blank.
export function toPounds(raw: unknown): number | null {
  if (!raw || typeof raw !== "object") return null;
  const value = plain((raw as any).value);
  const unit = String((raw as any).unit ?? "").trim().toLowerCase();
  if (value == null) return null;
  if (unit === "lb" || unit === "lbs" || unit === "pounds") return round(value);
  if (unit === "kg" || unit === "kgs" || unit === "kilograms") return round(value * KG_TO_LB);
  return null;
}

function toLitres(raw: unknown): number | null {
  if (!raw || typeof raw !== "object") return null;
  const value = plain((raw as any).value);
  const unit = String((raw as any).unit ?? "").trim().toLowerCase();
  if (value == null) return null;
  if (unit === "l" || unit === "litres" || unit === "liters" || unit === "kg") return round(value); // a kilogram of water is a litre
  if (unit === "lb" || unit === "lbs") return round(value / KG_TO_LB);
  return null;
}

// The printed date -> YYYY-MM-DD, only when it can be read one way. 2026.08.12 and 2026-08-12 are year first; 08/12/2026 could be either order, so it is left for the person to choose.
export function parsePrintedDate(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = /(\d{4})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{1,2})/.exec(text);
  if (m) return validDate(Number(m[1]), Number(m[2]), Number(m[3]));
  const d = /(\d{1,2})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{4})/.exec(text);
  if (d) {
    const a = Number(d[1]);
    const b = Number(d[2]);
    // both orders possible: only when one of them cannot be a month is it unambiguous
    if (a > 12 && b <= 12) return validDate(Number(d[3]), b, a);
    if (b > 12 && a <= 12) return validDate(Number(d[3]), a, b);
    return null;
  }
  return null;
}

function validDate(y: number, mo: number, d: number): string | null {
  if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const LIMBS = ["rightArm", "leftArm", "trunk", "rightLeg", "leftLeg"] as const;

// What the AI returned -> the numbers to show on the review screen. Anything unreadable, in the wrong unit or impossible is null (left blank for the person to fill in or leave).
export function normalizeScan(raw: unknown): ScanValues {
  if (!raw || typeof raw !== "object") return { ...EMPTY_SCAN };
  const r = raw as Record<string, any>;
  let segments: Record<string, SegmentValues> | null = null;
  if (r.segmental && typeof r.segmental === "object") {
    const out: Record<string, SegmentValues> = {};
    for (const limb of LIMBS) {
      const seg = r.segmental[limb];
      if (!seg || typeof seg !== "object") continue;
      const leanLb = toPounds(seg.lean);
      const fatLb = toPounds(seg.fat);
      if (leanLb != null || fatLb != null) out[limb] = { leanLb: leanLb != null && leanLb > 0 && leanLb < 200 ? leanLb : null, fatLb: fatLb != null && fatLb > 0 && fatLb < 200 ? fatLb : null };
    }
    if (Object.keys(out).length > 0) segments = out;
  }
  return {
    scanDate: parsePrintedDate(typeof r.scanDateText === "string" ? r.scanDateText : null),
    weightLb: within(toPounds(r.weight), "weightLb"),
    skeletalMuscleLb: within(toPounds(r.skeletalMuscleMass), "skeletalMuscleLb"),
    bodyFatMassLb: within(toPounds(r.bodyFatMass), "bodyFatMassLb"),
    percentBodyFat: within(plain(r.percentBodyFat), "percentBodyFat"),
    leanMassLb: within(toPounds(r.leanBodyMass), "leanMassLb"),
    bmi: within(plain(r.bmi), "bmi"),
    totalBodyWaterL: within(toLitres(r.totalBodyWater), "totalBodyWaterL"),
    ecwRatio: within(plain(r.ecwRatio), "ecwRatio"),
    visceralLevel: within(plain(r.visceralFatLevel), "visceralLevel"),
    bmrKcal: within(plain(r.bmr), "bmrKcal"),
    inbodyScore: within(plain(r.inbodyScore), "inbodyScore"),
    segments,
  };
}

export interface Check {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
}

const close = (a: number, b: number, tolerance: number) => Math.abs(a - b) <= tolerance * Math.max(a, b);

// Do the numbers agree with each other? A mismatch never blocks saving: the review screen just points at it. Only checks whose numbers are both present are made.
export function sanityChecks(v: ScanValues): Check[] {
  const checks: Check[] = [];
  if (v.weightLb != null && v.leanMassLb != null && v.bodyFatMassLb != null) {
    const sum = v.leanMassLb + v.bodyFatMassLb;
    checks.push({ key: "mass", label: "Lean mass plus fat mass is about the weight", ok: close(sum, v.weightLb, 0.03), detail: `${round(v.leanMassLb)} + ${round(v.bodyFatMassLb)} = ${round(sum)} lb, the weight is ${round(v.weightLb)} lb` });
  }
  if (v.weightLb != null && v.bodyFatMassLb != null && v.percentBodyFat != null) {
    const pct = (v.bodyFatMassLb / v.weightLb) * 100;
    checks.push({ key: "percent", label: "Percent body fat matches fat mass over weight", ok: Math.abs(pct - v.percentBodyFat) <= 1.5, detail: `${round(v.bodyFatMassLb)} / ${round(v.weightLb)} is ${round(pct)} percent, the sheet says ${round(v.percentBodyFat)}` });
  }
  if (v.skeletalMuscleLb != null && v.leanMassLb != null) {
    checks.push({ key: "muscle", label: "Skeletal muscle is less than lean mass", ok: v.skeletalMuscleLb < v.leanMassLb, detail: `${round(v.skeletalMuscleLb)} lb of muscle, ${round(v.leanMassLb)} lb of lean mass` });
  }
  if (v.weightLb != null && v.bmi != null && v.bmi > 0) {
    // BMI needs a height the sheet prints but we do not read: only the weight order of magnitude is checked here (BMI x 2.2 square metres is a plausible 4 to 8 foot person)
    const impliedHeightM = Math.sqrt(v.weightLb / KG_TO_LB / v.bmi);
    checks.push({ key: "bmi", label: "BMI fits the weight for a real height", ok: impliedHeightM >= 1.2 && impliedHeightM <= 2.3, detail: `${round(v.bmi)} at ${round(v.weightLb)} lb is a height of about ${round(impliedHeightM, 2)} m` });
  }
  return checks;
}

// A value the person can confirm: the form holds text, so a blank stays blank and a number is read back as a number.
export function numberFromField(text: string): number | null {
  const t = text.trim().replace(/,/g, "");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

// What goes to the database: the review screen's numbers, nothing else.
export function valuesForSave(v: ScanValues): Record<string, unknown> {
  return { ...v };
}

// The person's weight unit is only a display choice; scans are stored in pounds. The review screen shows pounds.
export const FIELD_LABELS: { key: keyof Omit<ScanValues, "scanDate" | "segments">; label: string; unit: string; step: string }[] = [
  { key: "weightLb", label: "Weight", unit: "lb", step: "0.1" },
  { key: "skeletalMuscleLb", label: "Skeletal muscle mass", unit: "lb", step: "0.1" },
  { key: "bodyFatMassLb", label: "Body fat mass", unit: "lb", step: "0.1" },
  { key: "percentBodyFat", label: "Percent body fat", unit: "%", step: "0.1" },
  { key: "leanMassLb", label: "Lean body mass", unit: "lb", step: "0.1" },
  { key: "bmi", label: "BMI", unit: "", step: "0.1" },
  { key: "totalBodyWaterL", label: "Total body water", unit: "L", step: "0.1" },
  { key: "ecwRatio", label: "ECW ratio", unit: "", step: "0.001" },
  { key: "visceralLevel", label: "Visceral fat level", unit: "", step: "1" },
  { key: "bmrKcal", label: "Basal metabolic rate", unit: "kcal", step: "1" },
  { key: "inbodyScore", label: "InBody score", unit: "", step: "1" },
];
