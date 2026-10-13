"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { createBrowserClient } from "@/lib/supabase/client";
import { loadAssignableClients, type AssignClient } from "@/lib/assign-clients";
import { assignProgramToClient, duplicateProgram } from "@/lib/program-duplication";
import { localDateKey } from "@/lib/timezone";
import type { LadderRung, Level, Side, SlotTier } from "@/lib/slot-templates";
import { LEVELS, MAKE_FAILED_MESSAGE, NO_LADDER_MESSAGE, buildReview, dayHeading, defaultProgramName, everySlotFilled, madeMessage, type TemplateSlot } from "@/lib/use-template";

const field = "h-11 w-full bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm focus:outline-none focus:border-rust";

// "Use this template…": pick a level (and a client if you like), look over the exercise chosen for every slot, change any, and make a normal library program with real exercises. The template is never changed.
export function UseTemplatePanel({ programId, programName, groupId, onClose, onChanged }: { programId: string; programName: string; groupId: string; onClose: () => void; onChanged: () => void }) {
  const [slots, setSlots] = useState<TemplateSlot[] | null>(null);
  const [ladders, setLadders] = useState<Record<string, LadderRung[]>>({});
  const [clients, setClients] = useState<AssignClient[]>([]);
  const [level, setLevel] = useState<Level>("intermediate");
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [clientId, setClientId] = useState("");
  const [changed, setChanged] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createBrowserClient();
    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data: rows } = await supabase
        .from("workouts")
        .select("week_number, day_index, group_workout_exercises!inner ( id, exercise_order, movement_pattern_id, slot_side, slot_tier )")
        .eq("program_id", programId)
        .eq("group_workout_exercises.is_slot", true);
      const found: TemplateSlot[] = [];
      for (const w of (rows ?? []) as any[]) {
        for (const e of w.group_workout_exercises ?? []) {
          if (e.movement_pattern_id) found.push({ rowId: e.id, week: w.week_number, day: w.day_index, order: e.exercise_order, patternId: e.movement_pattern_id, patternName: "", side: (e.slot_side as Side | null) ?? null, tier: (e.slot_tier as SlotTier | null) ?? null });
        }
      }
      const patternIds = [...new Set(found.map((s) => s.patternId))];
      const [{ data: patternRows }, { data: rungRows }, assignable] = await Promise.all([
        patternIds.length ? supabase.from("movement_patterns").select("id, name").in("id", patternIds) : Promise.resolve({ data: [] as any[] }),
        patternIds.length ? supabase.from("movement_pattern_exercises").select("movement_pattern_id, exercise_name, difficulty_rank, tier, is_unilateral").in("movement_pattern_id", patternIds) : Promise.resolve({ data: [] as any[] }),
        loadAssignableClients(supabase, user.id, groupId),
      ]);
      const nameById = new Map<string, string>(((patternRows ?? []) as any[]).map((p) => [p.id as string, p.name as string]));
      const byPattern: Record<string, LadderRung[]> = {};
      for (const r of (rungRows ?? []) as any[]) {
        (byPattern[r.movement_pattern_id] ??= []).push({ exerciseName: r.exercise_name, rank: Number(r.difficulty_rank) || 0, tier: (r.tier as SlotTier | null) ?? null, unilateral: !!r.is_unilateral });
      }
      setLadders(byPattern);
      setClients(assignable);
      setSlots(found.map((s) => ({ ...s, patternName: nameById.get(s.patternId) ?? "Pattern" })));
    })();
  }, [programId, groupId]);

  const review = useMemo(() => (slots ? buildReview(slots, ladders, level) : []), [slots, ladders, level]);
  const pickOf = (rowId: string, fallback: string | null) => changed[rowId] ?? fallback;
  const picks = Object.fromEntries(review.map((r) => [r.rowId, pickOf(r.rowId, r.pick)]));
  const shownName = nameTouched ? name : defaultProgramName(programName, level);
  const client = clients.find((c) => c.id === clientId) ?? null;
  const firstName = client ? client.fullName.trim().split(/\s+/)[0] : null;
  const ready = everySlotFilled(review, picks) && shownName.trim() !== "";

  async function make() {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    const supabase = createBrowserClient();
    let copyId: string | null = null;
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("not signed in");
      const copy = await duplicateProgram(supabase, { sourceProgramId: programId, destinationGroupId: groupId, createdBy: user.id });
      if ("error" in copy) throw new Error(copy.error);
      copyId = copy.programId;
      // The copy keeps the template's slots; each one is now replaced by the exercise chosen for it (found by its week, day and place in the day), pattern kept.
      const { data: copyRows } = await supabase
        .from("workouts")
        .select("week_number, day_index, group_workout_exercises!inner ( id, exercise_order )")
        .eq("program_id", copyId)
        .eq("group_workout_exercises.is_slot", true);
      const copyIdByPlace = new Map<string, string>();
      for (const w of (copyRows ?? []) as any[]) for (const e of w.group_workout_exercises ?? []) copyIdByPlace.set(`${w.week_number}:${w.day_index}:${e.exercise_order}`, e.id as string);
      for (const r of review) {
        const target = copyIdByPlace.get(`${r.week}:${r.day}:${r.order}`);
        const exercise = picks[r.rowId];
        if (!target || !exercise) throw new Error("slot not found in the copy");
        const { error: updateError } = await supabase.from("group_workout_exercises").update({ exercise_name: exercise, is_slot: false, slot_side: null, slot_tier: null, display_name: null }).eq("id", target);
        if (updateError) throw updateError;
      }
      const { error: nameError } = await supabase.from("programs").update({ name: shownName.trim() }).eq("id", copyId);
      if (nameError) throw nameError;
      if (client) {
        const assigned = await assignProgramToClient(supabase, { sourceProgramId: copyId, destinationGroupId: client.destinationGroupId, athleteId: client.id, startDate: localDateKey() });
        if ("error" in assigned) throw new Error(assigned.error);
      }
      setDone(madeMessage(shownName.trim()));
      onChanged();
    } catch {
      // Nothing is kept: the half-made copy is removed again.
      if (copyId) await supabase.from("programs").delete().eq("id", copyId);
      setError(MAKE_FAILED_MESSAGE);
    }
    setBusy(false);
  }

  let lastHeading = "";
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60" onClick={onClose}>
      <div role="dialog" aria-label="Use this template" className="w-full sm:max-w-xl bg-graphite border-t sm:border border-steel/30 p-5 max-h-[90dvh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display font-bold uppercase text-lg leading-none">Use this template</h2>
          <button type="button" onClick={onClose} className="min-h-11 px-2 font-body text-xs text-steel uppercase tracking-wide">
            Close
          </button>
        </div>
        <p className="font-body text-sm text-steel mt-2">Pick a level and the exercises are chosen from your ladders. Look them over, change any, then make the program.</p>

        {done ? (
          <p className="font-body text-sm text-chalk mt-4" role="status">
            {done}
          </p>
        ) : slots === null ? (
          <p className="font-body text-sm text-steel mt-4">One moment…</p>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
              <label className="font-body text-xs text-steel">
                Level
                <select
                  value={level}
                  onChange={(e) => {
                    setLevel(e.target.value as Level);
                    // A new level re-picks every slot.
                    setChanged({});
                  }}
                  className={`${field} mt-1`}
                >
                  {LEVELS.map((l) => (
                    <option key={l.value} value={l.value}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="font-body text-xs text-steel">
                For a client (optional)
                <select value={clientId} onChange={(e) => setClientId(e.target.value)} className={`${field} mt-1`}>
                  <option value="">No one yet (keep it in my library)</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.fullName}
                    </option>
                  ))}
                </select>
              </label>
              <label className="font-body text-xs text-steel sm:col-span-2">
                Program name
                <input
                  type="text"
                  value={shownName}
                  onChange={(e) => {
                    setName(e.target.value);
                    setNameTouched(true);
                  }}
                  className={`${field} mt-1`}
                />
              </label>
            </div>

            <div className="mt-4 space-y-1">
              {review.map((r) => {
                const heading = dayHeading(r.week, r.day);
                const showHeading = heading !== lastHeading;
                lastHeading = heading;
                const value = picks[r.rowId] ?? "";
                return (
                  <div key={r.rowId}>
                    {showHeading && <p className="font-display uppercase text-xs tracking-wide text-steel pt-3 pb-1">{heading}</p>}
                    <div className="border border-steel/20 p-2.5">
                      <p className="font-body text-xs text-steel">{r.label}</p>
                      {r.choices.length === 0 ? (
                        <p className="font-body text-xs text-rust mt-1" role="alert">
                          {NO_LADDER_MESSAGE}
                        </p>
                      ) : (
                        <select value={value} onChange={(e) => setChanged((prev) => ({ ...prev, [r.rowId]: e.target.value }))} aria-label={`Exercise for ${r.label}`} className={`${field} mt-1`}>
                          {r.choices.map((c) => (
                            <option key={c.exerciseName} value={c.exerciseName}>
                              {c.exerciseName}
                            </option>
                          ))}
                        </select>
                      )}
                      {r.fallback && <p className="font-body text-xs text-steel mt-1">{r.fallback}</p>}
                    </div>
                  </div>
                );
              })}
            </div>

            {error && (
              <p className="font-body text-xs text-rust mt-3" role="alert">
                {error}
              </p>
            )}
            <div className="flex items-center gap-3 mt-4">
              <button type="button" onClick={make} disabled={!ready || busy} className="min-h-12 px-5 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40">
                {busy ? "Making…" : firstName ? `Make and assign to ${firstName}` : "Make the program"}
              </button>
              <button type="button" onClick={onClose} className="min-h-12 px-3 font-body text-sm text-steel">
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
