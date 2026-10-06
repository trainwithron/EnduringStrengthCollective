"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/client";
import type { ProgressCardData } from "@/lib/progress-look-gather";
import {
  APPLIED_PREFIX,
  DELIBERATE_PREFIX,
  HINT_KEY,
  LATER_PREFIX,
  THRESHOLD_KEY,
  buildHelpQuestionDraft,
  buildOptions,
  buildStatusNote,
  cardHeadline,
  collapseCards,
  describeLook,
  type OptionDraft,
} from "@/lib/progress-look";
import { appendedNote, bumpedReps, parseStep, raisedTarget } from "@/lib/progress-apply";

interface Loaded {
  cards: ProgressCardData[];
  threshold: number;
  hintOn: boolean;
  truncated: boolean;
}

const btn = "h-11 px-4 border font-body text-sm disabled:opacity-50";

// "Time to progress?" for a coach's Home (docs/TIME_TO_PROGRESS_DESIGN.md). One collapsed row ("4 need a look") that opens to at most three cards, oldest
// evidence first. Everything is a suggestion to the coach: nothing is sent to a client, and nothing in a program changes until the coach taps Apply on a
// draft they may have edited. The coach's answers are kept in their own feedback rows; no database change.
export function ProgressLookPanel() {
  const [data, setData] = useState<Loaded | null>(null);
  const [coachId, setCoachId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [thresholdDraft, setThresholdDraft] = useState("3");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = createBrowserClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return;
        const res = await fetch("/api/progress-look");
        if (!res.ok) return;
        const json = (await res.json()) as Loaded;
        if (cancelled) return;
        setCoachId(user.id);
        setData(json);
        setThresholdDraft(String(json.threshold));
      } catch {
        // A suggestion never breaks Home: show nothing.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function record(key: string, action: "confirmed" | "denied" | "edited", summary: string, detail?: string) {
    if (!coachId) return false;
    const { error } = await createBrowserClient().from("spotter_recommendation_feedback").insert({
      coach_id: coachId,
      spotter_kind: "progress",
      dismissal_key: key,
      option_summary: summary,
      action,
      edit_detail: detail ?? null,
    });
    return !error;
  }

  function resolved(key: string) {
    setData((d) => (d ? { ...d, cards: d.cards.filter((c) => c.key !== key) } : d));
  }

  async function saveThreshold() {
    const n = Math.min(8, Math.max(2, Math.round(Number(thresholdDraft))));
    if (!Number.isFinite(n)) return;
    if (await record(THRESHOLD_KEY, "edited", `Ask after ${n} sessions`, String(n))) {
      setData((d) => (d ? { ...d, threshold: n } : d));
      setEditing(false);
    }
  }

  async function toggleHint(on: boolean) {
    if (await record(HINT_KEY, "edited", on ? "Rough rep guide on" : "Rough rep guide off", on ? "on" : "off")) setData((d) => (d ? { ...d, hintOn: on } : d));
  }

  if (!data || data.cards.length === 0) return null;
  const { count, shown } = collapseCards(data.cards);
  const byKey = new Map(data.cards.map((c) => [c.key, c]));

  return (
    <section className="border border-steel/30 bg-surface/40 rounded-token-lg mb-6" aria-label="Time to progress">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full min-h-14 px-4 py-3 flex items-center gap-3 text-left"
      >
        <span className="flex-1">
          <span className="block font-body text-sm text-chalk font-medium">
            {count} {count === 1 ? "needs" : "need"} a look
          </span>
          <span className="block font-body text-xs text-steel mt-0.5">Possible time to progress. Only you see this.</span>
        </span>
        <ChevronDown className={`w-4 h-4 text-steel shrink-0 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>

      {open && (
        <div className="px-4 pb-4">
          <ul className="divide-y divide-steel/15">
            {shown.map((c) => (
              <ProgressCardView key={c.key} card={byKey.get(c.key) as ProgressCardData} onResolved={resolved} record={record} />
            ))}
          </ul>
          {count > shown.length && <p className="font-body text-xs text-steel mt-2">{count - shown.length} more after these.</p>}
          {data.truncated && <p className="font-body text-xs text-steel mt-1">Very large roster: only the most recent sessions were read.</p>}

          <div className="mt-3 pt-3 border-t border-steel/15 font-body text-xs text-steel">
            {editing ? (
              <div className="flex flex-wrap items-center gap-2">
                <label htmlFor="progress-threshold">Ask after</label>
                <select id="progress-threshold" value={thresholdDraft} onChange={(e) => setThresholdDraft(e.target.value)} className="h-10 bg-graphite border border-steel/30 text-chalk px-2 text-sm">
                  {[2, 3, 4, 5, 6, 7, 8].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
                <span>same-load sessions</span>
                <button type="button" onClick={saveThreshold} className="h-10 px-3 border border-rust text-rust text-sm">
                  Save
                </button>
                <button type="button" onClick={() => setEditing(false)} className="h-10 px-3 text-steel text-sm">
                  Cancel
                </button>
              </div>
            ) : (
              <p>
                I&apos;ll ask after {data.threshold} sessions at the same load.{" "}
                <button type="button" onClick={() => setEditing(true)} className="underline text-chalk">
                  Change
                </button>
              </p>
            )}
            <label className="flex items-center gap-2 mt-2 cursor-pointer">
              <input type="checkbox" checked={data.hintOn} onChange={(e) => toggleHint(e.target.checked)} className="accent-rust" />
              <span>Mention the rough guide (a rep or two over target twice in a row)</span>
            </label>
            <p className="mt-2">These numbers are rough guidelines, not rules. People do not progress every week.</p>
          </div>
        </div>
      )}
    </section>
  );
}

export function ProgressCardView({
  card,
  onResolved,
  record,
}: {
  card: ProgressCardData;
  onResolved: (key: string) => void;
  record: (key: string, action: "confirmed" | "denied" | "edited", summary: string, detail?: string) => Promise<boolean>;
}) {
  const looks = [...card.flagged, ...card.others];
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [exercise, setExercise] = useState(card.flagged[0]?.exerciseName ?? "");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const first = card.clientName.split(" ")[0] ?? "";
  const look = looks.find((l) => l.exerciseName === exercise) ?? card.flagged[0];
  const options = look ? buildOptions(look, card.harderByExercise[look.exerciseName] ?? null) : [];
  const slot = look ? card.nextSlotByExercise[look.exerciseName] ?? null : null;
  const draftFor = (o: OptionDraft) => drafts[`${exercise}::${o.id}`] ?? o.draft;
  const setDraft = (o: OptionDraft, v: string) => setDrafts((d) => ({ ...d, [`${exercise}::${o.id}`]: v }));
  const summaryBase = `${card.clientName}: ${card.title}`;

  async function deliberate() {
    setBusy(true);
    if (await record(DELIBERATE_PREFIX + card.key, "confirmed", `${summaryBase}: holding it on purpose`)) onResolved(card.key);
    else setMessage("That didn't save. Try again.");
    setBusy(false);
  }
  async function notNow() {
    setBusy(true);
    if (await record(card.key, "denied", `${summaryBase}: not now`)) onResolved(card.key);
    else setMessage("That didn't save. Try again.");
    setBusy(false);
  }
  async function lookAgain() {
    setBusy(true);
    if (await record(LATER_PREFIX + card.key, "denied", `${summaryBase}: look again in 2 weeks`)) onResolved(card.key);
    else setMessage("That didn't save. Try again.");
    setBusy(false);
  }

  async function apply(o: OptionDraft) {
    if (!look) return;
    setMessage(null);
    if (!card.programIsPersonal) {
      setMessage(`${first || "This client"} follows a shared program, so changing it would change it for everyone. Give them their own copy first (Programming on their profile), then apply.`);
      return;
    }
    if (!slot) {
      setMessage("There is no later workout in their program to change.");
      return;
    }
    setBusy(true);
    const supabase = createBrowserClient();
    let ok = true;
    if (o.kind === "load") {
      const step = parseStep(draftFor(o));
      if (step == null) {
        setMessage("Type how much to add, for example 5.");
        setBusy(false);
        return;
      }
      for (const s of slot.sets) {
        const { error } = await supabase.from("group_workout_exercise_sets").update({ target_weight: raisedTarget(s.targetWeight, look.weight, step) }).eq("id", s.id);
        if (error) ok = false;
      }
      if (slot.sets.length === 0) ok = false;
    } else if (o.kind === "reps") {
      const by = parseStep(draftFor(o));
      if (by == null) {
        setMessage("Type how many reps to add, for example 1.");
        setBusy(false);
        return;
      }
      let changed = 0;
      for (const s of slot.sets) {
        const next = bumpedReps(s.targetReps, by);
        if (next == null) continue;
        const { error } = await supabase.from("group_workout_exercise_sets").update({ target_reps: next }).eq("id", s.id);
        if (error) ok = false;
        else changed++;
      }
      if (changed === 0) {
        setMessage("Their rep targets are not plain numbers, so edit them in the program builder.");
        setBusy(false);
        return;
      }
    } else if (o.kind === "set") {
      const lastSet = slot.sets[slot.sets.length - 1];
      if (!lastSet) ok = false;
      else {
        const { data: row } = await supabase.from("group_workout_exercise_sets").select("*").eq("id", lastSet.id).maybeSingle();
        if (!row) ok = false;
        else {
          const copy: Record<string, unknown> = { ...(row as Record<string, unknown>) };
          delete copy.id;
          delete copy.created_at;
          const { error } = await supabase.from("group_workout_exercise_sets").insert({ ...copy, set_order: lastSet.setOrder + 1 });
          if (error) ok = false;
        }
      }
    } else if (o.kind === "note") {
      const { error } = await supabase.from("group_workout_exercises").update({ notes: appendedNote(slot.notes, draftFor(o)) }).eq("id", slot.exerciseId);
      if (error) ok = false;
    }
    if (!ok) {
      setMessage("That didn't fully save. Check the workout in the program builder.");
      setBusy(false);
      return;
    }
    await record(APPLIED_PREFIX + card.key, "confirmed", `${summaryBase}: applied "${o.label}" to ${look.exerciseName}`, draftFor(o));
    setBusy(false);
    onResolved(card.key);
  }

  const noteDraft = buildStatusNote({ firstName: first, effort: look?.effort ?? "none" });
  const helpDraft = buildHelpQuestionDraft(first);

  return (
    <li className="py-4">
      <p className="font-body text-sm text-chalk font-medium">{cardHeadline(card, card.clientName)}</p>
      <div className="mt-1 space-y-1">
        {card.flagged.map((l) => (
          <p key={l.exerciseName} className="font-body text-sm text-chalk">
            {describeLook(l)}
          </p>
        ))}
        {card.others.length > 0 && (
          <div className="pt-1">
            <p className="font-body text-xs text-steel">Also in this workout:</p>
            {card.others.map((l) => (
              <p key={l.exerciseName} className="font-body text-xs text-steel">
                {describeLook(l)}
              </p>
            ))}
          </div>
        )}
      </div>
      <p className="font-body text-sm text-chalk mt-2">Did you notice this?</p>
      <div className="flex flex-wrap items-center gap-2 mt-2">
        <button type="button" disabled={busy} onClick={deliberate} className={`${btn} border-steel/30 text-chalk`}>
          Yes, deliberate
        </button>
        <button type="button" disabled={busy} onClick={() => setOptionsOpen((v) => !v)} aria-expanded={optionsOpen} className={`${btn} border-rust text-rust`}>
          Show me options
        </button>
        <button type="button" disabled={busy} onClick={notNow} className={`${btn} border-steel/30 text-steel`}>
          Not now
        </button>
      </div>

      {optionsOpen && look && (
        <div className="mt-3 border border-steel/20 p-3 space-y-3">
          <p className="font-body text-xs text-steel">
            Each is a draft you can edit. Nothing changes in {first ? `${first}'s` : "their"} program until you tap Apply.
          </p>
          {looks.length > 1 && (
            <label className="block font-body text-xs text-steel">
              For
              <select value={exercise} onChange={(e) => setExercise(e.target.value)} className="ml-2 h-10 bg-graphite border border-steel/30 text-chalk px-2 text-sm">
                {looks.map((l) => (
                  <option key={l.exerciseName} value={l.exerciseName}>
                    {l.exerciseName}
                  </option>
                ))}
              </select>
            </label>
          )}
          {!card.programIsPersonal && (
            <p className="font-body text-xs text-steel">
              {first || "This client"} follows a shared program, so changes here would reach everyone.{" "}
              <Link href={`/groups/${card.groupId}/athletes/${card.athleteId}`} className="underline text-chalk">
                Give them their own copy
              </Link>{" "}
              (Programming on their profile) to apply changes to just them.
            </p>
          )}
          <ul className="divide-y divide-steel/10">
            {options.map((o) => (
              <li key={o.id} className="py-2">
                <p className="font-body text-sm text-chalk">{o.label}</p>
                {(o.kind === "load" || o.kind === "reps" || o.kind === "set") && (
                  <div className="flex items-center gap-2 mt-1">
                    {o.kind !== "set" && (
                      <input
                        value={draftFor(o)}
                        onChange={(e) => setDraft(o, e.target.value)}
                        inputMode="decimal"
                        aria-label={`${o.label}, amount`}
                        className="w-20 h-11 bg-graphite border border-steel/30 text-chalk px-2 font-body text-base sm:text-sm"
                      />
                    )}
                    <button type="button" disabled={busy} onClick={() => apply(o)} className={`${btn} border-rust text-rust`}>
                      Apply
                    </button>
                  </div>
                )}
                {o.kind === "note" && (
                  <div className="mt-1 space-y-1">
                    <textarea
                      value={draftFor(o)}
                      onChange={(e) => setDraft(o, e.target.value)}
                      rows={2}
                      aria-label={`${o.label}, wording`}
                      className="w-full bg-graphite border border-steel/30 text-chalk px-2 py-1.5 font-body text-base sm:text-sm"
                    />
                    <button type="button" disabled={busy} onClick={() => apply(o)} className={`${btn} border-rust text-rust`}>
                      Apply to their next workout
                    </button>
                  </div>
                )}
                {o.kind === "later" && (
                  <button type="button" disabled={busy} onClick={lookAgain} className={`${btn} border-steel/30 text-chalk mt-1`}>
                    Look again in 2 weeks
                  </button>
                )}
              </li>
            ))}
          </ul>
          {message && (
            <p className="font-body text-xs text-rust" role="alert">
              {message}
            </p>
          )}
        </div>
      )}
      {!optionsOpen && message && (
        <p className="font-body text-xs text-rust mt-2" role="alert">
          {message}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3 font-body text-xs">
        <Link href={`/groups/${card.groupId}/messages/${card.athleteId}?draft=${encodeURIComponent(noteDraft)}`} className="text-rust underline">
          Draft a note to {first || "them"}
        </Link>
        <Link href={`/groups/${card.groupId}/calendar?client=${card.athleteId}&scheduleFor=${card.athleteId}`} className="text-steel underline">
          Suggest a time
        </Link>
        <Link href={`/groups/${card.groupId}/messages/${card.athleteId}?draft=${encodeURIComponent(helpDraft)}`} className="text-steel underline">
          Ask what they need most help with
        </Link>
      </div>
    </li>
  );
}
