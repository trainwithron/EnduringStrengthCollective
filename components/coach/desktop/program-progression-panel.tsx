"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { createBrowserClient } from "@/lib/supabase/client";
import { confirmDialog } from "@/components/shared/confirm-dialog";
import type { BuilderDay } from "@/lib/types";
import { DEFAULT_DOUBLE, clearDouble, describeDouble, exerciseNamesOf, readProgramProgression, saveDouble, setIdsOf, validateDouble, withRange, type Rule } from "@/lib/program-progression";
import { useSaveToastChannel } from "./save-toast-channel";

// One choice for the whole program, inside the builder: None, or Double progression (a rep range and a weight jump) applied to every exercise in one save. It writes the same rules and rep ranges the
// rest of the app already reads. A single exercise can still be changed on its own in its Edit details; other progression types are on the old page, one tap away.
export function ProgramProgressionPanel({
  programId,
  groupId,
  days,
  initialRules,
  onDaysChange,
}: {
  programId: string;
  groupId: string;
  days: BuilderDay[];
  initialRules: Rule[];
  onDaysChange: (days: BuilderDay[]) => void;
}) {
  const { flashSaved, flashSaveError } = useSaveToastChannel();
  const names = useMemo(() => exerciseNamesOf(days), [days]);
  const [rules, setRules] = useState<Rule[]>(initialRules);
  const current = useMemo(() => readProgramProgression(names, rules), [names, rules]);
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<"none" | "double">(current.kind === "double" ? "double" : "none");
  const start = current.kind === "double" ? current.settings : DEFAULT_DOUBLE;
  const [low, setLow] = useState(String(start.low));
  const [high, setHigh] = useState(String(start.high));
  const [increment, setIncrement] = useState(String(start.increment));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const settings = { low: Number(low), high: Number(high), increment: Number(increment) };
  const problem = choice === "double" ? validateDouble(settings) : null;
  const covered = current.kind === "double" ? current.covered : 0;
  const newlyAdded = current.kind === "double" ? names.length - covered : 0;

  async function save() {
    if (busy) return;
    setError(null);
    setMessage(null);
    if (names.length === 0) {
      setError("Add some exercises first.");
      return;
    }
    const supabase = createBrowserClient();
    if (choice === "none") {
      setBusy(true);
      const err = await clearDouble(supabase, { programId, names });
      setBusy(false);
      if (err) {
        setError(err);
        flashSaveError(err);
        return;
      }
      setRules((r) => r.filter((x) => x.model !== "double_progression" || !names.includes(x.exercise_name)));
      setMessage("Saved. No progression on this program.");
      flashSaved();
      return;
    }
    if (problem) {
      setError(problem);
      return;
    }
    const other = rules.filter((r) => names.includes(r.exercise_name) && r.model !== "double_progression").length;
    if (other > 0 && !(await confirmDialog({ message: `${other} exercise${other === 1 ? " has" : "s have"} another type of progression. Replace ${other === 1 ? "it" : "them"} with double progression?`, confirmLabel: "Replace" }))) return;
    setBusy(true);
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      setBusy(false);
      setError("You need to sign in again.");
      return;
    }
    const err = await saveDouble(supabase, { programId, groupId, userId: userData.user.id, names, setIds: setIdsOf(days), settings });
    setBusy(false);
    if (err) {
      setError(err);
      flashSaveError(err);
      return;
    }
    setRules((r) => [
      ...r.filter((x) => !names.includes(x.exercise_name)),
      ...names.map((exercise_name) => ({ exercise_name, model: "double_progression", config: { repRangeLow: settings.low, repRangeHigh: settings.high, weightIncrement: settings.increment, unit: "lbs" } })),
    ]);
    onDaysChange(withRange(days, settings.low, settings.high));
    setMessage(`Saved. Double progression on ${names.length} exercise${names.length === 1 ? "" : "s"}.`);
    flashSaved();
  }

  const summary =
    current.kind === "double"
      ? `Double progression, ${current.settings.low} to ${current.settings.high} reps, add ${current.settings.increment} lb${newlyAdded > 0 ? ` (${newlyAdded} newer exercise${newlyAdded === 1 ? "" : "s"} not included yet)` : ""}`
      : current.kind === "mixed"
        ? "Set exercise by exercise"
        : "None";

  return (
    <div className="mt-3 border border-steel/25 p-3 max-w-xl">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="w-full min-h-9 flex items-center justify-between gap-3 text-left">
        <span className="font-display uppercase text-sm tracking-wide text-steel">Progression</span>
        <span className="font-body text-xs text-chalk">{summary}</span>
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap gap-4">
            <label className="inline-flex items-center gap-2 min-h-9 font-body text-sm cursor-pointer">
              <input type="radio" name={`progression-${programId}`} checked={choice === "none"} onChange={() => setChoice("none")} />
              None
            </label>
            <label className="inline-flex items-center gap-2 min-h-9 font-body text-sm cursor-pointer">
              <input type="radio" name={`progression-${programId}`} checked={choice === "double"} onChange={() => setChoice("double")} />
              Double progression
            </label>
          </div>
          {choice === "double" && (
            <>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-2 font-body text-sm">
                <span>Reps from</span>
                <input type="number" inputMode="numeric" value={low} onChange={(e) => setLow(e.target.value)} aria-label="Reps from" className="w-16 h-9 bg-graphite border border-steel/30 text-chalk px-1 text-center focus:outline-none focus:border-rust" />
                <span>to</span>
                <input type="number" inputMode="numeric" value={high} onChange={(e) => setHigh(e.target.value)} aria-label="Reps to" className="w-16 h-9 bg-graphite border border-steel/30 text-chalk px-1 text-center focus:outline-none focus:border-rust" />
              </div>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-2 font-body text-sm">
                <span>Add</span>
                <input type="number" inputMode="decimal" value={increment} onChange={(e) => setIncrement(e.target.value)} aria-label="Pounds to add" className="w-16 h-9 bg-graphite border border-steel/30 text-chalk px-1 text-center focus:outline-none focus:border-rust" />
                <span>lb when you hit the top</span>
              </div>
              <p className="font-body text-xs text-steel max-w-[60ch]">{problem ?? describeDouble(settings)}</p>
              <p className="font-body text-xs text-steel max-w-[60ch]">It needs the exercise to come up again in a later week: the first time there is nothing to compare, so the goal starts from week 2.</p>
            </>
          )}
          <div className="flex flex-wrap items-center gap-4">
            <button type="button" onClick={() => void save()} disabled={busy || (choice === "double" && !!problem)} className="min-h-11 px-5 border border-rust text-rust font-display font-bold uppercase tracking-wide disabled:opacity-40">
              {busy ? "Saving…" : choice === "double" ? `Apply to all ${names.length} exercise${names.length === 1 ? "" : "s"}` : "Save"}
            </button>
            <Link href={`/groups/${groupId}/programs/${programId}/progressions`} className="font-body text-xs text-steel underline underline-offset-2">
              More progression types
            </Link>
          </div>
          {message && (
            <p className="font-body text-sm text-chalk" role="status">
              {message}
            </p>
          )}
          {error && (
            <p className="font-body text-sm text-rust" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
