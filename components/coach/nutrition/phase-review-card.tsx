"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { notifyPush } from "@/lib/push-notify";
import { addDaysToKey } from "@/lib/date-key";
import { shortDateLabel } from "@/lib/apply-from";
import { PHASE_LABELS, type PhasePlan } from "@/lib/phase-plan";
import { setReviewDate } from "@/lib/phase-plan-write";
import { switchToPlannedPhase, NEW_BLOCK_NOTICE } from "@/lib/phase-switch";
import { createBaselineSuggestion } from "@/lib/baseline-suggestion";
import type { BaselineResult } from "@/lib/nutrition-baseline";
import type { NutritionPhase } from "@/lib/nutrition-checkin";
import type { ReviewVerdict, Stance } from "@/lib/phase-review";

type Action = "continue" | "move" | "extend";

export interface PhaseReviewCardProps {
  athleteId: string;
  groupId: string;
  coachId: string;
  clientFirst: string;
  todayKey: string;
  phase: NutritionPhase;
  // The saved plan (needed to move to the next phase).
  plan: PhasePlan;
  headline: string;
  results: string[];
  verdictLine: string;
  verdict: ReviewVerdict;
  // The coach's private plan for what comes next, and what the numbers say about it.
  next: NutritionPhase | null;
  stance: Stance | null;
  stanceLine: string | null;
  factors: string[];
  // The starting target worked out for the NEXT phase (null when it cannot be worked out yet), and whether a starting-target suggestion is already waiting.
  nextBaseline: BaselineResult | null;
  nextArchetype: "standard" | "keto" | "carnivore";
  hasPendingBaseline: boolean;
  drafts: { continue: string; move: string | null; extend: string };
}

const primary = "h-11 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40";
const quiet = "h-11 px-4 border border-steel/40 text-chalk font-body text-sm disabled:opacity-40";

// "Review {client}'s phase": what actually happened, what the numbers say about the planned next step, and three plain choices. It only ever raises a prompt: nothing changes until the
// coach picks one. Moving to the planned phase starts it today (no goal, nothing for the client to accept), prepares the new starting target for the coach to review and apply, and tells
// the client in one plain line. The drafts are the coach's to edit and send; nothing is sent from here except that one line.
export function PhaseReviewCard(p: PhaseReviewCardProps) {
  const router = useRouter();
  const [action, setAction] = useState<Action | null>(null);
  const [text, setText] = useState("");
  const [when, setWhen] = useState("14");
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const moving = p.next != null && p.next !== p.phase;
  // One highlighted choice at most: the one the numbers point to.
  const highlight: Action | null =
    p.verdict === "too_fast" ? "continue" : p.verdict === "not_enough_data" ? "extend" : p.stance === "supports" ? (moving ? "move" : "continue") : p.verdict === "on_track" && !moving ? "continue" : null;

  function open(a: Action) {
    setAction(a);
    setError(null);
    setText(a === "continue" ? p.drafts.continue : a === "move" ? p.drafts.move ?? "" : p.drafts.extend);
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Couldn't copy. Select the message and copy it by hand.");
    }
  }
  const reviewOn = () => (when === "custom" ? custom : addDaysToKey(p.todayKey, Number(when)));

  async function save() {
    if (!action) return;
    setError(null);
    const supabase = createBrowserClient();
    setBusy(true);
    if (action === "move") {
      if (!p.next) return setBusy(false);
      const switched = await switchToPlannedPhase(supabase, { athleteId: p.athleteId, groupId: p.groupId, coachId: p.coachId, phase: p.next, todayKey: p.todayKey, existing: p.plan });
      if (!switched.ok) {
        setBusy(false);
        return setError("Couldn't start the new phase. Check your connection and try again.");
      }
      // The new starting target is prepared for the coach to review (never applied by itself).
      const target = p.nextBaseline && !p.hasPendingBaseline ? await createBaselineSuggestion(supabase, { athleteId: p.athleteId, groupId: p.groupId, outcome: p.nextBaseline, archetype: p.nextArchetype }) : null;
      notifyPush(p.athleteId, NEW_BLOCK_NOTICE.title, NEW_BLOCK_NOTICE.body, `/groups/${p.groupId}`);
      setBusy(false);
      setDone(
        `${p.clientFirst} is now in ${PHASE_LABELS[p.next].toLowerCase()} and was told a new training block started.` +
          (target?.ok ? " A starting target is ready in Targets for you to review and apply." : p.hasPendingBaseline ? " A starting target is already waiting in Targets." : " Add what's missing in About you to get a starting target worked out.")
      );
      router.refresh();
      return;
    }
    const date = reviewOn();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date <= p.todayKey) {
      setBusy(false);
      return setError("Pick a review date after today.");
    }
    const res = await setReviewDate(supabase, { athleteId: p.athleteId, groupId: p.groupId, coachId: p.coachId, reviewOn: date, markReviewed: action === "continue", todayKey: p.todayKey });
    setBusy(false);
    if (!res.ok) return setError("Couldn't save. Check your connection and try again.");
    setDone(`${action === "continue" ? "Keeping going." : "Review moved."} Next review ${shortDateLabel(date)}.`);
    router.refresh();
  }

  const btn = (a: Action, label: string) => (
    <button key={a} type="button" onClick={() => open(a)} aria-pressed={action === a} className={highlight === a ? primary : quiet}>
      {label}
    </button>
  );

  if (done) {
    return (
      <div className="border border-steel/20 p-4" role="status">
        <p className="font-body text-sm text-positive">{done}</p>
      </div>
    );
  }

  return (
    <section className="border border-rust/40 p-4 space-y-3" aria-label={`Review ${p.clientFirst}'s phase`}>
      <div>
        <h3 className="font-display font-bold text-lg uppercase leading-none">Review {p.clientFirst}&apos;s phase</h3>
        <p className="font-body text-xs text-steel mt-1">{p.headline}</p>
      </div>
      <ul className="space-y-1">
        {p.results.map((line) => (
          <li key={line} className="font-body text-sm text-chalk">
            {line}
          </li>
        ))}
      </ul>
      <p className="font-body text-sm text-chalk border-l-2 border-rust/60 pl-2">{p.verdictLine}</p>

      {p.next && p.stanceLine && (
        <div className="space-y-1">
          <p className="font-body text-sm text-chalk">
            Planned next: {PHASE_LABELS[p.next]}. {p.stanceLine} <span className="text-steel">Only you see this plan.</span>
          </p>
          {p.factors.length > 0 && (
            <ul className="list-disc pl-5 space-y-0.5">
              {p.factors.map((f) => (
                <li key={f} className="font-body text-xs text-steel">
                  {f}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {btn("continue", "Keep going")}
        {moving && btn("move", `Move to ${PHASE_LABELS[p.next as NutritionPhase].toLowerCase()}`)}
        {btn("extend", "Extend the review")}
      </div>

      {action && (
        <div className="space-y-3 border-t border-steel/15 pt-3">
          {action === "move" && p.next && (
            <p className="font-body text-xs text-steel max-w-[70ch]">
              This starts {PHASE_LABELS[p.next].toLowerCase()} for {p.clientFirst} today. They are told in one plain line (&ldquo;{NEW_BLOCK_NOTICE.body}&rdquo;) and nothing is asked of them. Their new starting target is prepared for you to review; their
              calories do not change until you apply it.
            </p>
          )}
          {action !== "move" && (
            <label className="block font-body text-xs text-steel">
              {action === "continue" ? "Check again" : "Look again"}
              <select value={when} onChange={(e) => setWhen(e.target.value)} className="block mt-1 h-10 bg-surface border border-steel/30 text-chalk px-2 font-body text-sm">
                <option value="7">in 1 week</option>
                <option value="14">in 2 weeks</option>
                <option value="custom">on a date I pick</option>
              </select>
              {when === "custom" && <input type="date" value={custom} min={addDaysToKey(p.todayKey, 1)} onChange={(e) => setCustom(e.target.value)} className="block mt-2 h-10 bg-surface border border-steel/30 text-chalk px-2 font-body text-sm" />}
            </label>
          )}
          <label className="block font-body text-xs text-steel">
            A message to start from (yours to edit and send; this screen does not send it)
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} maxLength={600} className="block mt-1 w-full bg-graphite border border-steel/30 p-2 font-body text-sm text-chalk" />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={save} disabled={busy} className={primary}>
              {busy ? "Saving…" : action === "move" ? `Start ${p.next ? PHASE_LABELS[p.next].toLowerCase() : "the new phase"}` : action === "continue" ? "Keep going" : "Extend the review"}
            </button>
            {/* The message holds the client's name and weight, so it is copied, never put in a web address (addresses end up in logs and browser history). */}
            <button type="button" onClick={copy} className={quiet}>
              {copied ? "Copied" : "Copy message"}
            </button>
            <Link href={`/groups/${p.groupId}/messages/${p.athleteId}`} className={`${quiet} inline-flex items-center`}>
              Open Messages
            </Link>
          </div>
          {error && (
            <p className="font-body text-xs text-rust" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
