// The goal sheet (Ron, Nov 2): one per client per group, on the goal screens. The client fills it in, or the coach fills it in with them, or the
// coach sends it to the client. The wording of every question is Ron's; change it only with him.

export const GOAL_SHEET_HEADING = "Goal sheet";

export const GOAL_SHEET_TEXT_FIELDS = ["why_matters", "success_90_days", "obstacles", "want_why", "work_willing", "food_day_1", "food_day_2", "food_day_3"] as const;
export type GoalSheetTextField = (typeof GOAL_SHEET_TEXT_FIELDS)[number];

export type GoalSheetAnswers = {
  why_matters: string | null;
  success_90_days: string | null;
  obstacles: string | null;
  days_per_week: number | null;
  want_score: number | null;
  want_why: string | null;
  work_willing: string | null;
  food_day_1: string | null;
  food_day_2: string | null;
  food_day_3: string | null;
};

export type GoalSheetRow = GoalSheetAnswers & {
  filled_by: string | null;
  filled_at: string | null;
  requested_by: string | null;
  requested_at: string | null;
};

export const GOAL_SHEET_COLUMNS =
  "why_matters, success_90_days, obstacles, days_per_week, want_score, want_why, work_willing, food_day_1, food_day_2, food_day_3, filled_by, filled_at, requested_by, requested_at";

export const GOAL_SHEET_QUESTIONS = {
  why_matters: "Why does this goal matter to you?",
  success_90_days: "What would success look like 90 days from now?",
  obstacles: "What has gotten in the way before?",
  days_per_week: "How many days a week can you realistically train?",
  want_score: "How bad do you want this?",
  want_why: "Why that number?",
  work_willing: "How hard are you willing to work for it?",
  food: "The last 3 days of eating",
} as const;

export const GOAL_SHEET_HINTS = {
  work_willing: "This affects the plan.",
  food: "A quick recall: what you ate and drank each day. Close is fine.",
} as const;

export const FOOD_DAY_LABELS: Record<"food_day_1" | "food_day_2" | "food_day_3", string> = {
  food_day_1: "Yesterday",
  food_day_2: "2 days ago",
  food_day_3: "3 days ago",
};

export const EMPTY_GOAL_SHEET: GoalSheetAnswers = {
  why_matters: null,
  success_90_days: null,
  obstacles: null,
  days_per_week: null,
  want_score: null,
  want_why: null,
  work_willing: null,
  food_day_1: null,
  food_day_2: null,
  food_day_3: null,
};

const MAX_TEXT = 2000;

function wholeIn(v: unknown, lo: number, hi: number): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isInteger(n) && n >= lo && n <= hi ? n : null;
}

// What a save may write: each text answer trimmed (blank is no answer) and cut to the database's limit; the two numbers only when whole and in range.
export function cleanGoalSheet(raw: unknown): GoalSheetAnswers {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: GoalSheetAnswers = { ...EMPTY_GOAL_SHEET };
  for (const f of GOAL_SHEET_TEXT_FIELDS) {
    const v = typeof r[f] === "string" ? (r[f] as string).trim().slice(0, MAX_TEXT) : "";
    out[f] = v || null;
  }
  out.days_per_week = wholeIn(r.days_per_week, 1, 7);
  out.want_score = wholeIn(r.want_score, 1, 10);
  return out;
}

export function goalSheetHasAnswers(a: GoalSheetAnswers | null | undefined): boolean {
  if (!a) return false;
  return GOAL_SHEET_TEXT_FIELDS.some((f) => !!a[f]) || a.days_per_week != null || a.want_score != null;
}

// The coach sent it and nobody has saved it since: the client is asked to fill it in.
export function goalSheetWaitingOnClient(row: Pick<GoalSheetRow, "requested_at" | "filled_at"> | null | undefined): boolean {
  if (!row?.requested_at) return false;
  return !row.filled_at || new Date(row.filled_at).getTime() < new Date(row.requested_at).getTime();
}
