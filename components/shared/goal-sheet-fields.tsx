"use client";

import { FOOD_DAY_LABELS, GOAL_SHEET_HINTS, GOAL_SHEET_QUESTIONS, type GoalSheetAnswers, type GoalSheetRow, type GoalSheetTextField } from "@/lib/goal-sheet";

export const FOOD_DAYS = ["food_day_1", "food_day_2", "food_day_3"] as const;
const label = "font-body text-xs text-steel uppercase tracking-wide";
const box = "w-full mt-1 bg-surface border border-steel/30 text-chalk px-3 py-2 font-body text-base focus:outline-none focus:border-rust";
const choice = (on: boolean) => `h-11 font-body text-sm border ${on ? "bg-rust text-graphite border-rust font-bold" : "border-steel/30 text-chalk active:bg-steel/10"}`;

// Ron's 7 goal sheet questions as inputs (his wording, lib/goal-sheet.ts), for the one goals page and the coach filling it in with the client.
export function GoalSheetFields({ answers, onChange }: { answers: GoalSheetAnswers; onChange: (next: GoalSheetAnswers) => void }) {
  const setText = (f: GoalSheetTextField, v: string) => onChange({ ...answers, [f]: v });
  return (
    <div className="space-y-4">
      {(["why_matters", "success_90_days", "obstacles"] as const).map((f) => (
        <div key={f}>
          <label htmlFor={`gs-${f}`} className={label}>
            {GOAL_SHEET_QUESTIONS[f]}
          </label>
          <textarea id={`gs-${f}`} rows={2} maxLength={2000} value={answers[f] ?? ""} onChange={(e) => setText(f, e.target.value)} className={box} />
        </div>
      ))}

      <fieldset>
        <legend className={label}>{GOAL_SHEET_QUESTIONS.days_per_week}</legend>
        <div className="grid grid-cols-7 gap-1 mt-1">
          {[1, 2, 3, 4, 5, 6, 7].map((n) => (
            <button key={n} type="button" aria-pressed={answers.days_per_week === n} onClick={() => onChange({ ...answers, days_per_week: answers.days_per_week === n ? null : n })} className={choice(answers.days_per_week === n)}>
              {n}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className={label}>{GOAL_SHEET_QUESTIONS.want_score}</legend>
        <p className="font-body text-xs text-steel mt-0.5">1 to 10</p>
        <div className="grid grid-cols-5 gap-1 mt-1">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
            <button key={n} type="button" aria-pressed={answers.want_score === n} onClick={() => onChange({ ...answers, want_score: answers.want_score === n ? null : n })} className={choice(answers.want_score === n)}>
              {n}
            </button>
          ))}
        </div>
      </fieldset>

      <div>
        <label htmlFor="gs-want_why" className={label}>
          {GOAL_SHEET_QUESTIONS.want_why}
        </label>
        <textarea id="gs-want_why" rows={2} maxLength={2000} value={answers.want_why ?? ""} onChange={(e) => setText("want_why", e.target.value)} className={box} />
      </div>

      <div>
        <label htmlFor="gs-work_willing" className={label}>
          {GOAL_SHEET_QUESTIONS.work_willing}
        </label>
        <p className="font-body text-xs text-steel mt-0.5">{GOAL_SHEET_HINTS.work_willing}</p>
        <textarea id="gs-work_willing" rows={2} maxLength={2000} value={answers.work_willing ?? ""} onChange={(e) => setText("work_willing", e.target.value)} className={box} />
      </div>

      <fieldset className="space-y-2">
        <legend className={label}>{GOAL_SHEET_QUESTIONS.food}</legend>
        <p className="font-body text-xs text-steel">{GOAL_SHEET_HINTS.food}</p>
        {FOOD_DAYS.map((f) => (
          <div key={f}>
            <label htmlFor={`gs-${f}`} className="font-body text-xs text-chalk">
              {FOOD_DAY_LABELS[f]}
            </label>
            <textarea id={`gs-${f}`} rows={2} maxLength={2000} value={answers[f] ?? ""} onChange={(e) => setText(f, e.target.value)} className={box} />
          </div>
        ))}
      </fieldset>
    </div>
  );
}

// The answers, read-only (the coach's "Read <name>'s answers").
export function GoalSheetAnswersList({ sheet }: { sheet: GoalSheetAnswers }) {
  return (
    <dl className="space-y-3">
      {(["why_matters", "success_90_days", "obstacles"] as const).map((f) => (
        <Answer key={f} q={GOAL_SHEET_QUESTIONS[f]} a={sheet[f]} />
      ))}
      <Answer q={GOAL_SHEET_QUESTIONS.days_per_week} a={sheet.days_per_week != null ? `${sheet.days_per_week} ${sheet.days_per_week === 1 ? "day" : "days"}` : null} />
      <Answer q={GOAL_SHEET_QUESTIONS.want_score} a={sheet.want_score != null ? `${sheet.want_score} out of 10` : null} />
      <Answer q={GOAL_SHEET_QUESTIONS.want_why} a={sheet.want_why} />
      <Answer q={GOAL_SHEET_QUESTIONS.work_willing} a={sheet.work_willing} />
      {FOOD_DAYS.some((f) => sheet[f]) && (
        <div>
          <dt className={label}>{GOAL_SHEET_QUESTIONS.food}</dt>
          {FOOD_DAYS.map((f) =>
            sheet[f] ? (
              <dd key={f} className="font-body text-sm text-chalk mt-1 whitespace-pre-wrap">
                <span className="text-steel">{FOOD_DAY_LABELS[f]}: </span>
                {sheet[f]}
              </dd>
            ) : null
          )}
        </div>
      )}
    </dl>
  );
}

function Answer({ q, a }: { q: string; a: string | null }) {
  if (!a) return null;
  return (
    <div>
      <dt className={label}>{q}</dt>
      <dd className="font-body text-sm text-chalk mt-1 whitespace-pre-wrap">{a}</dd>
    </div>
  );
}

// The stored row's answers only.
export function sheetAnswers(row: GoalSheetRow): GoalSheetAnswers {
  return {
    why_matters: row.why_matters,
    success_90_days: row.success_90_days,
    obstacles: row.obstacles,
    days_per_week: row.days_per_week,
    want_score: row.want_score,
    want_why: row.want_why,
    work_willing: row.work_willing,
    food_day_1: row.food_day_1,
    food_day_2: row.food_day_2,
    food_day_3: row.food_day_3,
  };
}
