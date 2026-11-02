"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  EMPTY_GOAL_SHEET,
  FOOD_DAY_LABELS,
  GOAL_SHEET_HEADING,
  GOAL_SHEET_HINTS,
  GOAL_SHEET_QUESTIONS,
  goalSheetHasAnswers,
  goalSheetWaitingOnClient,
  type GoalSheetAnswers,
  type GoalSheetRow,
  type GoalSheetTextField,
} from "@/lib/goal-sheet";

const FOOD_DAYS = ["food_day_1", "food_day_2", "food_day_3"] as const;

function shortDate(iso: string, timeZone?: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", ...(timeZone ? { timeZone } : {}) });
}

// The goal sheet (Ron, Nov 2), on the client's goal page and on the coach's view of that client. The client fills it in. The coach reads it, fills it in
// with them in a session, or sends it so the client is asked to fill it in. Saving goes through /api/goal-sheet, which checks who is asking.
export function GoalSheetSection({
  groupId,
  athleteId,
  sheet,
  viewer,
  clientFirstName,
  timeZone,
}: {
  groupId: string;
  athleteId: string;
  sheet: GoalSheetRow | null;
  viewer: "client" | "coach";
  clientFirstName?: string;
  timeZone?: string;
}) {
  const router = useRouter();
  const saved: GoalSheetAnswers = sheet ? { ...EMPTY_GOAL_SHEET, ...pick(sheet) } : EMPTY_GOAL_SHEET;
  const hasAnswers = goalSheetHasAnswers(saved);
  const waiting = goalSheetWaitingOnClient(sheet);
  const first = clientFirstName || "your client";
  const [editing, setEditing] = useState(viewer === "client" && !hasAnswers);
  const [answers, setAnswers] = useState<GoalSheetAnswers>(saved);
  const [busy, setBusy] = useState<"save" | "send" | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function setText(f: GoalSheetTextField, v: string) {
    setAnswers((a) => ({ ...a, [f]: v }));
  }

  async function post(url: string, payload: object): Promise<boolean> {
    try {
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      return res.ok;
    } catch {
      return false;
    }
  }

  async function save() {
    if (busy) return;
    setBusy("save");
    setError(null);
    setNote(null);
    const ok = await post("/api/goal-sheet", { groupId, athleteId, answers });
    setBusy(null);
    if (!ok) {
      setError("Couldn't save the goal sheet. Try again.");
      return;
    }
    setEditing(false);
    setNote("Saved.");
    router.refresh();
  }

  async function send() {
    if (busy) return;
    setBusy("send");
    setError(null);
    setNote(null);
    const ok = await post("/api/goal-sheet/send", { groupId, athleteId });
    setBusy(null);
    if (!ok) {
      setError("Couldn't send it. Try again.");
      return;
    }
    setNote(`Sent. ${first} will get a notice to fill it in.`);
    router.refresh();
  }

  const label = "font-body text-xs text-steel uppercase tracking-wide";
  const box = "w-full mt-1 bg-surface border border-steel/30 text-chalk px-3 py-2 font-body text-sm focus:outline-none focus:border-rust";
  const choice = (on: boolean) =>
    `h-11 font-body text-sm border ${on ? "bg-rust text-graphite border-rust font-bold" : "border-steel/30 text-chalk active:bg-steel/10"}`;

  const status =
    viewer === "coach"
      ? waiting && sheet?.requested_at
        ? `Sent ${shortDate(sheet.requested_at, timeZone)}. Not filled in yet.`
        : sheet?.filled_at && hasAnswers
          ? `Filled in ${shortDate(sheet.filled_at, timeZone)}${sheet.filled_by === athleteId ? ` by ${first}` : ""}.`
          : null
      : waiting
        ? "Your coach asked you to fill this in."
        : null;

  return (
    <section aria-label={GOAL_SHEET_HEADING} className="border border-steel/20 p-4 mb-6">
      <h2 className="font-display uppercase text-sm tracking-wide text-steel">{GOAL_SHEET_HEADING}</h2>
      {status && <p className={`font-body text-sm mt-1 ${viewer === "client" ? "text-rust" : "text-steel"}`}>{status}</p>}

      {editing ? (
        <div className="space-y-4 mt-3">
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
                <button key={n} type="button" aria-pressed={answers.days_per_week === n} onClick={() => setAnswers((a) => ({ ...a, days_per_week: a.days_per_week === n ? null : n }))} className={choice(answers.days_per_week === n)}>
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
                <button key={n} type="button" aria-pressed={answers.want_score === n} onClick={() => setAnswers((a) => ({ ...a, want_score: a.want_score === n ? null : n }))} className={choice(answers.want_score === n)}>
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

          <div className="flex gap-2">
            <button type="button" onClick={save} disabled={busy !== null} className="flex-1 h-11 bg-rust text-graphite font-display uppercase text-sm font-bold disabled:opacity-40">
              {busy === "save" ? "Saving…" : "Save"}
            </button>
            {hasAnswers || viewer === "coach" ? (
              <button
                type="button"
                onClick={() => {
                  setAnswers(saved);
                  setEditing(false);
                }}
                className="h-11 px-4 border border-steel/40 text-chalk font-body text-sm"
              >
                Cancel
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <>
          {hasAnswers ? (
            <dl className="mt-3 space-y-3">
              {(["why_matters", "success_90_days", "obstacles"] as const).map((f) => (
                <Answer key={f} q={GOAL_SHEET_QUESTIONS[f]} a={saved[f]} />
              ))}
              <Answer q={GOAL_SHEET_QUESTIONS.days_per_week} a={saved.days_per_week != null ? `${saved.days_per_week} ${saved.days_per_week === 1 ? "day" : "days"}` : null} />
              <Answer q={GOAL_SHEET_QUESTIONS.want_score} a={saved.want_score != null ? `${saved.want_score} out of 10` : null} />
              <Answer q={GOAL_SHEET_QUESTIONS.want_why} a={saved.want_why} />
              <Answer q={GOAL_SHEET_QUESTIONS.work_willing} a={saved.work_willing} />
              {FOOD_DAYS.some((f) => saved[f]) && (
                <div>
                  <dt className={label}>{GOAL_SHEET_QUESTIONS.food}</dt>
                  {FOOD_DAYS.map((f) =>
                    saved[f] ? (
                      <dd key={f} className="font-body text-sm text-chalk mt-1 whitespace-pre-wrap">
                        <span className="text-steel">{FOOD_DAY_LABELS[f]}: </span>
                        {saved[f]}
                      </dd>
                    ) : null
                  )}
                </div>
              )}
            </dl>
          ) : (
            <p className="font-body text-sm text-steel mt-2">Not filled in yet.</p>
          )}
          <div className="flex flex-wrap gap-2 mt-4">
            <button type="button" onClick={() => setEditing(true)} className="h-11 px-4 border border-rust/60 text-rust font-body text-sm active:bg-rust/10">
              {hasAnswers ? "Edit" : viewer === "coach" ? `Fill in with ${first}` : "Fill it in"}
            </button>
            {viewer === "coach" && (
              <button type="button" onClick={send} disabled={busy !== null} className="h-11 px-4 border border-steel/40 text-chalk font-body text-sm disabled:opacity-40">
                {busy === "send" ? "Sending…" : sheet?.requested_at ? `Send to ${first} again` : `Send to ${first}`}
              </button>
            )}
          </div>
        </>
      )}

      {note && (
        <p className="font-body text-sm text-moss mt-3" role="status">
          {note}
        </p>
      )}
      {error && (
        <p className="font-body text-sm text-rust mt-3" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function Answer({ q, a }: { q: string; a: string | null }) {
  if (!a) return null;
  return (
    <div>
      <dt className="font-body text-xs text-steel uppercase tracking-wide">{q}</dt>
      <dd className="font-body text-sm text-chalk mt-1 whitespace-pre-wrap">{a}</dd>
    </div>
  );
}

function pick(row: GoalSheetRow): GoalSheetAnswers {
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
