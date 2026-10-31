"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { Copy, Pencil, Plus, Trash2 } from "lucide-react";
import type { AvailabilityWindowRow } from "../availability-manager";
import { copyTargets, currentTiming, isSessionRuleError, previewSessionTimes, sessionCount, stepFor, timingProblem, validateWindow } from "@/lib/availability-edit";

const RULE_PENDING = "A session longer than the time between starts needs a database update that has not been applied yet. Nothing was changed.";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// The week as a coach reads it: Monday first.
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

const sortWindows = (list: AvailabilityWindowRow[]) =>
  [...list].sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime));

const toRow = (d: any): AvailabilityWindowRow => ({
  id: d.id,
  weekday: d.weekday,
  startTime: d.start_time,
  endTime: d.end_time,
  slotDurationMinutes: d.slot_duration_minutes,
  sessionMinutes: d.session_minutes ?? null,
  sessionTypeId: d.session_type_id ?? null,
});

const inputCls = "h-9 px-2 bg-surface border border-steel/30 text-chalk font-body text-xs";
const iconBtn = "w-8 h-8 inline-flex items-center justify-center text-steel hover:text-chalk transition-colors";

// Which kind of session these hours are for (optional): the coach's own session types. A session booked inside tagged hours carries the type. "Any" changes nothing.
function SessionTypeSelect({ types, value, onChange }: { types: { id: string; name: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-body text-xs text-steel uppercase tracking-wide">Session type (optional)</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={inputCls}>
        <option value="">Any</option>
        {types.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </label>
  );
}

type HoursDraft = { startTime: string; endTime: string; sessionTypeId: string | null };

// The coach's weekly hours, one row per day (Ron, Oct 31: two numbers, not three). Two numbers apply to all of them: how long a session lasts and the gap
// after it. A start is offered every session + gap minutes, so a 55-minute session with a 5-minute gap starts on the hour all day and never drifts.
// Each day's hours are added, changed, copied to other days and deleted on that day's row. Changing hours never touches a session that is already booked.
export function AvailabilityManagerDesktop({
  coachId,
  initialWindows,
  sessionLengthEnabled = false,
  initialBufferMinutes,
  sessionTypes = [],
  sessionTypeEnabled = false,
}: {
  coachId: string;
  initialWindows: AvailabilityWindowRow[];
  sessionLengthEnabled?: boolean;
  // The coach's gap between sessions (their buffer, coach_booking_policies.buffer_minutes).
  initialBufferMinutes?: number;
  // The coach's own session types and whether windows can carry one (migration 0289). Until then the select is hidden and nothing changes.
  sessionTypes?: { id: string; name: string }[];
  sessionTypeEnabled?: boolean;
}) {
  const router = useRouter();
  const typeNameById = new Map(sessionTypes.map((s) => [s.id, s.name]));
  const showTypes = sessionTypeEnabled && sessionTypes.length > 0;
  const COLS =
    "id, weekday, start_time, end_time, slot_duration_minutes" + (sessionLengthEnabled ? ", session_minutes" : "") + (sessionTypeEnabled ? ", session_type_id" : "");

  const [windows, setWindows] = useState(initialWindows);
  const start = currentTiming(initialWindows, initialBufferMinutes ?? 0);
  // What is saved, and what is being typed.
  const [timing, setTiming] = useState({ session: start.session, gap: start.gap });
  const [sessionInput, setSessionInput] = useState(String(start.session));
  const [gapInput, setGapInput] = useState(String(start.gap));
  const [timingBusy, setTimingBusy] = useState(false);
  const [timingError, setTimingError] = useState<string | null>(null);
  const [timingSaved, setTimingSaved] = useState(false);

  // One open editor at a time: adding hours to a day, changing one window, or copying one window to other days.
  const [addingDay, setAddingDay] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [copyingId, setCopyingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<HoursDraft>({ startTime: "17:00", endTime: "20:00", sessionTypeId: null });
  const [copyDays, setCopyDays] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const step = stepFor(timing.session, timing.gap);
  const mixed = windows.length > 0 && currentTiming(windows, timing.gap).mixed;
  const typedSession = Number(sessionInput);
  const typedGap = gapInput.trim() === "" ? 0 : Number(gapInput);
  const timingChanged = typedSession !== timing.session || typedGap !== timing.gap;
  const sample = windows[0] ?? { startTime: "08:00", endTime: "12:00" };
  const preview = Number.isInteger(typedSession) && typedSession > 0 && Number.isInteger(typedGap) && typedGap >= 0
    ? previewSessionTimes({ startTime: sample.startTime, endTime: sample.endTime, stepMinutes: stepFor(typedSession, typedGap), sessionMinutes: typedSession, count: 4 })
    : "";

  // The columns every window gets from the two numbers.
  const timingColumns = (session: number, gap: number) => ({
    slot_duration_minutes: stepFor(session, gap),
    ...(sessionLengthEnabled ? { session_minutes: session } : {}),
  });

  function closeEditors() {
    setAddingDay(null);
    setEditingId(null);
    setCopyingId(null);
    setRowError(null);
  }

  async function saveTiming() {
    const session = typedSession;
    const gap = typedGap;
    const problem = timingProblem(session, gap, windows);
    if (problem) {
      setTimingError(problem);
      return;
    }
    setTimingBusy(true);
    setTimingError(null);
    setTimingSaved(false);
    const supabase = createBrowserClient();
    if (windows.length > 0) {
      const { error } = await supabase.from("coach_availability_windows").update(timingColumns(session, gap)).eq("coach_id", coachId);
      if (error) {
        setTimingBusy(false);
        setTimingError(isSessionRuleError(error.message) ? RULE_PENDING : "That didn't save. Nothing was changed. Try again.");
        return;
      }
    }
    if (gap !== timing.gap) {
      const { error } = await supabase.from("coach_booking_policies").upsert({ coach_id: coachId, buffer_minutes: gap }, { onConflict: "coach_id" });
      if (error) {
        setTimingBusy(false);
        setTimingError("Your session length saved, but the gap didn't. Try Save again.");
        setTiming({ session, gap: timing.gap });
        setWindows((prev) => prev.map((w) => ({ ...w, slotDurationMinutes: stepFor(session, gap), sessionMinutes: session })));
        return;
      }
    }
    setTimingBusy(false);
    setTiming({ session, gap });
    setWindows((prev) => prev.map((w) => ({ ...w, slotDurationMinutes: stepFor(session, gap), sessionMinutes: session })));
    setTimingSaved(true);
    router.refresh();
  }

  function startAdd(day: number) {
    closeEditors();
    setNotice(null);
    // A second window on a day starts where the last one ends.
    const last = windows.filter((w) => w.weekday === day).pop();
    setDraft(last ? { startTime: last.endTime.slice(0, 5), endTime: last.endTime.slice(0, 5) < "20:00" ? "20:00" : "23:00", sessionTypeId: null } : { startTime: "17:00", endTime: "20:00", sessionTypeId: null });
    setAddingDay(day);
  }

  const others = () => windows.map((w) => ({ id: w.id, weekday: w.weekday, startTime: w.startTime, endTime: w.endTime }));

  async function saveAdd() {
    if (addingDay === null) return;
    const problem = validateWindow({ weekday: addingDay, startTime: draft.startTime, endTime: draft.endTime, slotMinutes: step, sessionMinutes: timing.session }, others());
    if (problem) {
      setRowError(problem);
      return;
    }
    setBusy(true);
    setRowError(null);
    const { data, error } = await createBrowserClient()
      .from("coach_availability_windows")
      .insert({
        coach_id: coachId,
        weekday: addingDay,
        start_time: draft.startTime,
        end_time: draft.endTime,
        ...timingColumns(timing.session, timing.gap),
        ...(sessionTypeEnabled && draft.sessionTypeId ? { session_type_id: draft.sessionTypeId } : {}),
      })
      .select(COLS)
      .single();
    setBusy(false);
    if (error || !data) {
      setRowError(isSessionRuleError(error?.message) ? RULE_PENDING : "Couldn't save those hours. Nothing was changed. Try again.");
      return;
    }
    setWindows((prev) => sortWindows([...prev, toRow(data)]));
    setAddingDay(null);
  }

  function startEdit(w: AvailabilityWindowRow) {
    closeEditors();
    setNotice(null);
    setDraft({ startTime: w.startTime.slice(0, 5), endTime: w.endTime.slice(0, 5), sessionTypeId: w.sessionTypeId ?? null });
    setEditingId(w.id);
  }

  async function saveEdit(w: AvailabilityWindowRow) {
    const problem = validateWindow({ weekday: w.weekday, startTime: draft.startTime, endTime: draft.endTime, slotMinutes: step, sessionMinutes: timing.session }, others(), w.id);
    if (problem) {
      setRowError(problem);
      return;
    }
    setBusy(true);
    setRowError(null);
    const { data, error } = await createBrowserClient()
      .from("coach_availability_windows")
      .update({
        start_time: draft.startTime,
        end_time: draft.endTime,
        ...timingColumns(timing.session, timing.gap),
        ...(sessionTypeEnabled ? { session_type_id: draft.sessionTypeId ?? null } : {}),
      })
      .eq("id", w.id)
      .select(COLS)
      .single();
    setBusy(false);
    if (error || !data) {
      setRowError(isSessionRuleError(error?.message) ? RULE_PENDING : "That didn't save. Nothing was changed. Try again.");
      return;
    }
    setWindows((prev) => sortWindows(prev.map((x) => (x.id === w.id ? toRow(data) : x))));
    setEditingId(null);
    setNotice("Hours updated. Sessions that are already booked stay as they are.");
  }

  function startCopy(w: AvailabilityWindowRow) {
    closeEditors();
    setNotice(null);
    setCopyDays([]);
    setCopyingId(w.id);
  }

  async function saveCopy(w: AvailabilityWindowRow) {
    const { create, skipped } = copyTargets({ weekday: w.weekday, startTime: w.startTime, endTime: w.endTime }, copyDays, others());
    if (create.length === 0) {
      setRowError(skipped.length > 0 ? "Those days already have overlapping hours." : "Pick at least one day.");
      return;
    }
    setBusy(true);
    setRowError(null);
    const { data, error } = await createBrowserClient()
      .from("coach_availability_windows")
      .insert(
        create.map((day) => ({
          coach_id: coachId,
          weekday: day,
          start_time: w.startTime,
          end_time: w.endTime,
          ...timingColumns(timing.session, timing.gap),
          ...(sessionTypeEnabled && w.sessionTypeId ? { session_type_id: w.sessionTypeId } : {}),
        }))
      )
      .select(COLS);
    setBusy(false);
    if (error || !data) {
      setRowError("That didn't save. Nothing was changed. Try again.");
      return;
    }
    setWindows((prev) => sortWindows([...prev, ...data.map(toRow)]));
    setCopyingId(null);
    setNotice(
      `Copied to ${create.map((d) => SHORT[d]).join(", ")}.` + (skipped.length > 0 ? ` Skipped ${skipped.map((d) => SHORT[d]).join(", ")}: those days already have overlapping hours.` : "")
    );
  }

  async function handleDelete(id: string) {
    closeEditors();
    const { error } = await createBrowserClient().from("coach_availability_windows").delete().eq("id", id);
    if (error) {
      setNotice("Couldn't delete those hours. Nothing was changed.");
      return;
    }
    setWindows((prev) => prev.filter((w) => w.id !== id));
  }

  const timeFields = (
    <>
      <label className="flex flex-col gap-1">
        <span className="font-body text-xs text-steel uppercase tracking-wide">From</span>
        <input type="time" value={draft.startTime} onChange={(e) => setDraft({ ...draft, startTime: e.target.value })} className={inputCls} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-body text-xs text-steel uppercase tracking-wide">To</span>
        <input type="time" value={draft.endTime} onChange={(e) => setDraft({ ...draft, endTime: e.target.value })} className={inputCls} />
      </label>
      {showTypes && <SessionTypeSelect types={sessionTypes} value={draft.sessionTypeId ?? ""} onChange={(v) => setDraft({ ...draft, sessionTypeId: v || null })} />}
    </>
  );

  const editorButtons = (label: string, onSave: () => void) => (
    <div className="flex items-center gap-2">
      <button type="button" onClick={onSave} disabled={busy} className="h-9 px-4 bg-rust text-graphite font-body text-xs font-medium disabled:opacity-40">
        {busy ? "Saving…" : label}
      </button>
      <button type="button" onClick={closeEditors} className="h-9 px-3 border border-steel/30 text-steel font-body text-xs">
        Cancel
      </button>
    </div>
  );

  const errorLine = rowError && (
    <p className="basis-full font-body text-xs text-rust" role="alert">
      {rowError}
    </p>
  );

  return (
    <section aria-labelledby="weekly-hours" className="min-w-0">
      <h2 id="weekly-hours" className="font-display uppercase text-lg tracking-wide mb-3">
        Weekly hours
      </h2>

      <div className="border border-steel/20 bg-surface/40 p-4 mb-4">
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1">
            <span className="font-body text-xs text-steel uppercase tracking-wide">Session length (minutes)</span>
            <input
              type="number"
              min={5}
              max={240}
              value={sessionInput}
              onChange={(e) => {
                setSessionInput(e.target.value);
                setTimingSaved(false);
              }}
              className={`${inputCls} w-24`}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-body text-xs text-steel uppercase tracking-wide">Gap between sessions (minutes)</span>
            <input
              type="number"
              min={0}
              max={240}
              value={gapInput}
              onChange={(e) => {
                setGapInput(e.target.value);
                setTimingSaved(false);
              }}
              className={`${inputCls} w-24`}
            />
          </label>
          <button
            type="button"
            onClick={saveTiming}
            disabled={timingBusy || (!timingChanged && !mixed)}
            className="h-9 px-4 bg-rust text-graphite font-body text-xs font-medium disabled:opacity-40"
          >
            {timingBusy ? "Saving…" : "Save"}
          </button>
          {timingSaved && (
            <span className="font-body text-xs text-positive" role="status">
              Saved
            </span>
          )}
        </div>
        <p className="font-body text-xs text-steel mt-3">
          {Number.isInteger(typedSession) && typedSession > 0 && Number.isInteger(typedGap) && typedGap >= 0
            ? `A session starts every ${stepFor(typedSession, typedGap)} minutes${preview ? `: ${preview}` : ""}${preview.endsWith("…") ? "" : "."}`
            : "Type a session length and a gap."}{" "}
          Applies to all your hours.
        </p>
        {mixed && !timingChanged && (
          <p className="font-body text-xs text-amber mt-2" role="status">
            Some of your hours were set up with different numbers, which shifts their start times. Press Save to line them all up.
          </p>
        )}
        {timingError && (
          <p className="font-body text-xs text-rust mt-2" role="alert">
            {timingError}
          </p>
        )}
      </div>

      {notice && (
        <p className="font-body text-xs text-chalk border border-steel/30 bg-surface p-2 mb-3" role="status">
          {notice}
        </p>
      )}

      <ul className="border-t border-steel/20">
        {WEEK_ORDER.map((day) => {
          const dayWindows = windows.filter((w) => w.weekday === day);
          return (
            <li key={day} className="border-b border-steel/15 py-2 grid grid-cols-[3.5rem_minmax(0,1fr)] gap-x-3 items-start">
              <p className={`font-body text-sm pt-2 ${dayWindows.length > 0 ? "text-chalk" : "text-steel"}`}>{SHORT[day]}</p>
              <div className="min-w-0 space-y-1">
                {dayWindows.length === 0 && addingDay !== day && <p className="font-body text-xs text-steel pt-2.5">Closed</p>}
                {dayWindows.map((w) => {
                  const count = sessionCount(w, timing.session, timing.gap);
                  const typeName = w.sessionTypeId ? typeNameById.get(w.sessionTypeId) : null;
                  if (editingId === w.id) {
                    return (
                      <div key={w.id} className="flex flex-wrap items-end gap-3 py-1">
                        {timeFields}
                        {editorButtons("Save", () => saveEdit(w))}
                        {errorLine}
                      </div>
                    );
                  }
                  return (
                    <div key={w.id}>
                      <div className="flex items-center gap-2 min-h-9">
                        <p className="font-body text-sm text-chalk tabular-nums">
                          {w.startTime.slice(0, 5)}–{w.endTime.slice(0, 5)}
                        </p>
                        <p className="font-body text-xs text-steel truncate">
                          {count} {count === 1 ? "session" : "sessions"}
                          {typeName ? ` · ${typeName}` : ""}
                        </p>
                        <span className="ml-auto shrink-0 whitespace-nowrap">
                          <button type="button" onClick={() => startEdit(w)} aria-label={`Edit ${WEEKDAYS[w.weekday]} hours`} title="Edit" className={iconBtn}>
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button type="button" onClick={() => startCopy(w)} aria-label={`Copy ${WEEKDAYS[w.weekday]} hours to other days`} title="Copy to other days" className={iconBtn}>
                            <Copy className="w-4 h-4" />
                          </button>
                          <button type="button" onClick={() => handleDelete(w.id)} aria-label="Delete window" title="Delete" className={`${iconBtn} active:text-rust`}>
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </span>
                      </div>
                      {copyingId === w.id && (
                        <div className="border border-steel/30 bg-surface p-3 my-1">
                          <p className="font-body text-xs text-chalk mb-2">
                            Copy {w.startTime.slice(0, 5)}–{w.endTime.slice(0, 5)} to:
                          </p>
                          <div className="flex flex-wrap gap-1.5 mb-3">
                            {WEEK_ORDER.filter((d) => d !== w.weekday).map((d) => {
                              const on = copyDays.includes(d);
                              return (
                                <button
                                  key={d}
                                  type="button"
                                  aria-pressed={on}
                                  onClick={() => setCopyDays((prev) => (on ? prev.filter((x) => x !== d) : [...prev, d]))}
                                  className={`h-9 px-3 border font-body text-xs ${on ? "border-rust bg-rust/10 text-chalk" : "border-steel/30 text-steel"}`}
                                >
                                  {SHORT[d]}
                                </button>
                              );
                            })}
                          </div>
                          {editorButtons("Copy", () => saveCopy(w))}
                          {rowError && (
                            <p className="font-body text-xs text-rust mt-2" role="alert">
                              {rowError}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                {addingDay === day ? (
                  <div className="flex flex-wrap items-end gap-3 py-1">
                    {timeFields}
                    {editorButtons("Add", saveAdd)}
                    {errorLine}
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => startAdd(day)}
                    aria-label={`Add ${WEEKDAYS[day]} hours`}
                    className="h-8 inline-flex items-center gap-1 font-body text-xs text-rust"
                  >
                    <Plus className="w-3.5 h-3.5" aria-hidden />
                    Add hours
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
