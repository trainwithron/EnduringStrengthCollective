// The 90-day goal look (Ron, Nov 20: R5). A goal sheet answered (or last confirmed) 90 or more days ago brings a card to the client's Home: "Still my goal" stamps today
// (client_goal_sheets.reviewed_at, step 215), "Update my goal" opens the goal sheet, and saving it starts the 90 days again. The coach sees the same thing on Home's Needs you.
// Pure, so it is tested.
export const GOAL_REVIEW_DAYS = 90;
// Where the goal sheet sits on a client's profile: Home's "Worth a goal talk" opens the profile on it (audit, Nov 21).
export const GOAL_SHEET_ANCHOR = "goal-sheet";
const DAY_MS = 86_400_000;

export const GOAL_REVIEW_HEADING = "It's been 90 days since you set your goal";

export interface GoalReviewRow {
  filled_at: string | null;
  reviewed_at?: string | null;
  success_90_days?: string | null;
  why_matters?: string | null;
}

// The last time the client set or confirmed the goal (null: never set).
export function goalAnchor(row: GoalReviewRow | null | undefined): number | null {
  if (!row?.filled_at) return null;
  const set = new Date(row.filled_at).getTime();
  const looked = row.reviewed_at ? new Date(row.reviewed_at).getTime() : NaN;
  const best = Math.max(Number.isFinite(set) ? set : -Infinity, Number.isFinite(looked) ? looked : -Infinity);
  return Number.isFinite(best) ? best : null;
}

export function goalReviewDue(row: GoalReviewRow | null | undefined, now: Date = new Date()): boolean {
  const at = goalAnchor(row);
  return at != null && now.getTime() - at >= GOAL_REVIEW_DAYS * DAY_MS;
}

// The goal in their own words: what success in 90 days looks like, else why it matters (null: neither was answered).
export function goalReviewText(row: GoalReviewRow | null | undefined): string | null {
  const t = (row?.success_90_days ?? "").trim() || (row?.why_matters ?? "").trim();
  return t || null;
}

// The cutoff for the coach's read: a sheet saved before this may be due (its reviewed date decides).
export function goalReviewCutoffIso(now: Date = new Date()): string {
  return new Date(now.getTime() - GOAL_REVIEW_DAYS * DAY_MS).toISOString();
}
