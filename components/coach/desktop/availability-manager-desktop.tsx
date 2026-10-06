"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { Copy, Pencil, Trash2 } from "lucide-react";
import type { AvailabilityWindowRow } from "../availability-manager";
import { copyTargets, validateWindow, type WindowDraft } from "@/lib/availability-edit";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const sortWindows = (list: AvailabilityWindowRow[]) =>
  [...list].sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime));

const toRow = (d: any): AvailabilityWindowRow => ({
  id: d.id,
  weekday: d.weekday,
  startTime: d.start_time,
  endTime: d.end_time,
  slotDurationMinutes: d.slot_duration_minutes,
  sessionMinutes: d.session_minutes ?? null,
});

const inputCls = "h-9 px-2 bg-surface border border-steel/30 text-chalk font-body text-xs";

// The coach's recurring weekly hours: add, change (day, start, end, minutes per session), copy to other days, delete. Changing hours never touches a
// session that is already booked; it only changes which times can be booked next.
// The session length is separate from how often slots start (a 55-minute session in 60-minute slots leaves a 5-minute gap). It needs the 0283 database
// update: until that is applied `sessionLengthEnabled` is false and the page works exactly as before.
export function AvailabilityManagerDesktop({
  coachId,
  initialWindows,
  sessionLengthEnabled = false,
}: {
  coachId: string;
  initialWindows: AvailabilityWindowRow[];
  sessionLengthEnabled?: boolean;
}) {
  const COLS = sessionLengthEnabled
    ? "id, weekday, start_time, end_time, slot_duration_minutes, session_minutes"
    : "id, weekday, start_time, end_time, slot_duration_minutes";
  const [windows, setWindows] = useState(initialWindows);
  const [weekday, setWeekday] = useState("1");
  const [startTime, setStartTime] = useState("17:00");
  const [endTime, setEndTime] = useState("20:00");
  const [slotDuration, setSlotDuration] = useState("60");
  const [sessionInput, setSessionInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<WindowDraft | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [copyingId, setCopyingId] = useState<string | null>(null);
  const [copyDays, setCopyDays] = useState<number[]>([]);
  const [rowBusy, setRowBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function handleAdd() {
    setError(null);
    const problem = validateWindow(
      { weekday: Number(weekday), startTime, endTime, slotMinutes: Number(slotDuration), sessionMinutes: sessionLengthEnabled && sessionInput.trim() ? Number(sessionInput) : null },
      windows.map((w) => ({ id: w.id, weekday: w.weekday, startTime: w.startTime, endTime: w.endTime }))
    );
    if (problem) {
      setError(problem);
      return;
    }
    setSubmitting(true);
    const supabase = createBrowserClient();
    const { data, error: insertError } = await supabase
      .from("coach_availability_windows")
      .insert({
        coach_id: coachId,
        weekday: Number(weekday),
        start_time: startTime,
        end_time: endTime,
        slot_duration_minutes: Number(slotDuration),
        ...(sessionLengthEnabled && sessionInput.trim() ? { session_minutes: Number(sessionInput) } : {}),
      })
      .select(COLS)
      .single();

    if (data) {
      setWindows((prev) => sortWindows([...prev, toRow(data)]));
    } else if (insertError) {
      setError("Couldn't save that window.");
    }
    setSubmitting(false);
  }

  async function handleDelete(id: string) {
    const supabase = createBrowserClient();
    const { error: deleteError } = await supabase.from("coach_availability_windows").delete().eq("id", id);
    if (deleteError) {
      setRowError("Couldn't delete that window. Nothing was changed.");
      return;
    }
    setWindows((prev) => prev.filter((w) => w.id !== id));
    if (editingId === id) setEditingId(null);
    if (copyingId === id) setCopyingId(null);
  }

  function startEdit(w: AvailabilityWindowRow) {
    setRowError(null);
    setCopyingId(null);
    setNotice(null);
    setEditingId(w.id);
    setDraft({ weekday: w.weekday, startTime: w.startTime.slice(0, 5), endTime: w.endTime.slice(0, 5), slotMinutes: w.slotDurationMinutes, sessionMinutes: w.sessionMinutes ?? null });
  }

  async function saveEdit() {
    if (!editingId || !draft) return;
    const problem = validateWindow(
      draft,
      windows.map((w) => ({ id: w.id, weekday: w.weekday, startTime: w.startTime, endTime: w.endTime })),
      editingId
    );
    if (problem) {
      setRowError(problem);
      return;
    }
    setRowBusy(true);
    setRowError(null);
    const supabase = createBrowserClient();
    const { data, error: updateError } = await supabase
      .from("coach_availability_windows")
      .update({
        weekday: draft.weekday,
        start_time: draft.startTime,
        end_time: draft.endTime,
        slot_duration_minutes: draft.slotMinutes,
        ...(sessionLengthEnabled ? { session_minutes: draft.sessionMinutes ?? null } : {}),
      })
      .eq("id", editingId)
      .select(COLS)
      .single();
    setRowBusy(false);
    if (updateError || !data) {
      setRowError("That didn't save. Nothing was changed. Try again.");
      return;
    }
    setWindows((prev) => sortWindows(prev.map((w) => (w.id === editingId ? toRow(data) : w))));
    setEditingId(null);
    setDraft(null);
    setNotice("Hours updated. Sessions that are already booked stay as they are.");
  }

  function startCopy(w: AvailabilityWindowRow) {
    setRowError(null);
    setEditingId(null);
    setNotice(null);
    setCopyingId(w.id);
    setCopyDays([]);
  }

  async function saveCopy(w: AvailabilityWindowRow) {
    const { create, skipped } = copyTargets(
      { weekday: w.weekday, startTime: w.startTime, endTime: w.endTime },
      copyDays,
      windows.map((x) => ({ id: x.id, weekday: x.weekday, startTime: x.startTime, endTime: x.endTime }))
    );
    if (create.length === 0) {
      setRowError(skipped.length > 0 ? "Those days already have overlapping hours." : "Pick at least one day.");
      return;
    }
    setRowBusy(true);
    setRowError(null);
    const supabase = createBrowserClient();
    const { data, error: insertError } = await supabase
      .from("coach_availability_windows")
      .insert(
        create.map((day) => ({
          coach_id: coachId,
          weekday: day,
          start_time: w.startTime,
          end_time: w.endTime,
          slot_duration_minutes: w.slotDurationMinutes,
          ...(sessionLengthEnabled && w.sessionMinutes ? { session_minutes: w.sessionMinutes } : {}),
        }))
      )
      .select(COLS);
    setRowBusy(false);
    if (insertError || !data) {
      setRowError("That didn't save. Nothing was changed. Try again.");
      return;
    }
    setWindows((prev) => sortWindows([...prev, ...data.map(toRow)]));
    setCopyingId(null);
    setNotice(
      `Copied to ${create.map((d) => SHORT[d]).join(", ")}.` +
        (skipped.length > 0 ? ` Skipped ${skipped.map((d) => SHORT[d]).join(", ")}: those days already have overlapping hours.` : "")
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6 lg:gap-10 items-start">
      <div>
        <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-3">
          Recurring hours
        </h2>
        {sessionLengthEnabled && windows.length > 0 && (
          <SessionLengthForAll
            coachId={coachId}
            current={Array.from(new Set(windows.map((w) => w.sessionMinutes ?? null)))}
            onChanged={(minutes) => setWindows((prev) => prev.map((w) => ({ ...w, sessionMinutes: minutes })))}
          />
        )}
        {notice && (
          <p className="font-body text-xs text-chalk border border-steel/30 bg-surface p-2 mb-3" role="status">
            {notice}
          </p>
        )}
        {rowError && !editingId && !copyingId && (
          <p className="font-body text-xs text-rust mb-3" role="alert">
            {rowError}
          </p>
        )}
        {windows.length === 0 ? (
          <p className="font-body text-sm text-steel py-3">
            No recurring hours set yet — add one on the right.
          </p>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-steel/20">
                <th className="text-left font-body text-xs text-steel uppercase tracking-wide font-medium py-2">
                  Day
                </th>
                <th className="text-left font-body text-xs text-steel uppercase tracking-wide font-medium py-2">
                  Time
                </th>
                <th className="text-left font-body text-xs text-steel uppercase tracking-wide font-medium py-2">
                  Session length
                </th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {windows.map((w) => {
                const editing = editingId === w.id && draft;
                return (
                  <tr key={w.id} className="border-b border-steel/15 align-top">
                    {editing ? (
                      <td colSpan={4} className="py-3">
                        <div className="flex flex-wrap items-end gap-3">
                          <label className="flex flex-col gap-1">
                            <span className="font-body text-xs text-steel uppercase tracking-wide">Day</span>
                            <select value={draft.weekday} onChange={(e) => setDraft({ ...draft, weekday: Number(e.target.value) })} className={inputCls}>
                              {WEEKDAYS.map((label, i) => (
                                <option key={i} value={i}>
                                  {label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="flex flex-col gap-1">
                            <span className="font-body text-xs text-steel uppercase tracking-wide">Start</span>
                            <input type="time" value={draft.startTime} onChange={(e) => setDraft({ ...draft, startTime: e.target.value })} className={inputCls} />
                          </label>
                          <label className="flex flex-col gap-1">
                            <span className="font-body text-xs text-steel uppercase tracking-wide">End</span>
                            <input type="time" value={draft.endTime} onChange={(e) => setDraft({ ...draft, endTime: e.target.value })} className={inputCls} />
                          </label>
                          <label className="flex flex-col gap-1">
                            <span className="font-body text-xs text-steel uppercase tracking-wide">{sessionLengthEnabled ? "Slot every (min)" : "Minutes/session"}</span>
                            <input
                              type="number"
                              min={5}
                              value={draft.slotMinutes}
                              onChange={(e) => setDraft({ ...draft, slotMinutes: Number(e.target.value) })}
                              className={`${inputCls} w-24`}
                            />
                          </label>
                          {sessionLengthEnabled && (
                            <label className="flex flex-col gap-1">
                              <span className="font-body text-xs text-steel uppercase tracking-wide">Session (min)</span>
                              <input
                                type="number"
                                min={5}
                                value={draft.sessionMinutes ?? ""}
                                placeholder="Same"
                                onChange={(e) => setDraft({ ...draft, sessionMinutes: e.target.value === "" ? null : Number(e.target.value) })}
                                className={`${inputCls} w-24`}
                              />
                            </label>
                          )}
                          <button type="button" onClick={saveEdit} disabled={rowBusy} className="h-9 px-4 bg-rust text-graphite font-body text-xs font-medium disabled:opacity-40">
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(null);
                              setRowError(null);
                            }}
                            className="h-9 px-3 border border-steel/30 text-steel font-body text-xs"
                          >
                            Cancel
                          </button>
                        </div>
                        {rowError && (
                          <p className="font-body text-xs text-rust mt-2" role="alert">
                            {rowError}
                          </p>
                        )}
                      </td>
                    ) : (
                      <>
                        <td className="py-3 font-body text-sm">{WEEKDAYS[w.weekday]}</td>
                        <td className="py-3 font-body text-sm text-steel">
                          {w.startTime.slice(0, 5)}–{w.endTime.slice(0, 5)}
                        </td>
                        <td className="py-3 font-body text-sm text-steel">
                          {w.sessionMinutes && w.sessionMinutes !== w.slotDurationMinutes
                            ? `${w.sessionMinutes} min, a slot every ${w.slotDurationMinutes} min`
                            : `${w.slotDurationMinutes} min`}
                        </td>
                        <td className="py-3 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => startEdit(w)}
                            aria-label={`Edit ${WEEKDAYS[w.weekday]} hours`}
                            title="Edit"
                            className="w-8 h-8 inline-flex items-center justify-center text-steel hover:text-chalk transition-colors"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => startCopy(w)}
                            aria-label={`Copy ${WEEKDAYS[w.weekday]} hours to other days`}
                            title="Copy to other days"
                            className="w-8 h-8 inline-flex items-center justify-center text-steel hover:text-chalk transition-colors"
                          >
                            <Copy className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(w.id)}
                            aria-label="Delete window"
                            title="Delete"
                            className="w-8 h-8 inline-flex items-center justify-center text-steel active:text-rust transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {copyingId && (() => {
          const w = windows.find((x) => x.id === copyingId);
          if (!w) return null;
          return (
            <div className="mt-3 border border-steel/30 bg-surface p-3">
              <p className="font-body text-sm text-chalk mb-2">
                Copy {WEEKDAYS[w.weekday]} {w.startTime.slice(0, 5)}–{w.endTime.slice(0, 5)} ({w.slotDurationMinutes} min) to:
              </p>
              <div className="flex flex-wrap gap-2 mb-3">
                {SHORT.map((label, d) => {
                  if (d === w.weekday) return null;
                  const on = copyDays.includes(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setCopyDays((prev) => (on ? prev.filter((x) => x !== d) : [...prev, d]))}
                      className={`h-9 px-3 border font-body text-xs ${on ? "border-rust bg-rust/10 text-chalk" : "border-steel/30 text-steel"}`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => saveCopy(w)} disabled={rowBusy || copyDays.length === 0} className="h-9 px-4 bg-rust text-graphite font-body text-xs font-medium disabled:opacity-40">
                  Copy
                </button>
                <button type="button" onClick={() => { setCopyingId(null); setRowError(null); }} className="h-9 px-3 border border-steel/30 text-steel font-body text-xs">
                  Cancel
                </button>
              </div>
              {rowError && (
                <p className="font-body text-xs text-rust mt-2" role="alert">
                  {rowError}
                </p>
              )}
            </div>
          );
        })()}
      </div>

      <div className="border border-steel/20 p-4 space-y-3">
        <p className="font-display uppercase text-xs tracking-wide text-steel">
          Add recurring window
        </p>
        <label className="flex flex-col gap-1">
          <span className="font-body text-xs text-steel uppercase tracking-wide">Day</span>
          <select
            value={weekday}
            onChange={(e) => setWeekday(e.target.value)}
            className={inputCls}
          >
            {WEEKDAYS.map((label, i) => (
              <option key={i} value={i}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-body text-xs text-steel uppercase tracking-wide">Start</span>
          <input
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            className={inputCls}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-body text-xs text-steel uppercase tracking-wide">End</span>
          <input
            type="time"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            className={inputCls}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-body text-xs text-steel uppercase tracking-wide">
            {sessionLengthEnabled ? "Slot every (minutes)" : "Minutes/session"}
          </span>
          <input
            type="number"
            min={5}
            value={slotDuration}
            onChange={(e) => setSlotDuration(e.target.value)}
            className={inputCls}
          />
        </label>
        {sessionLengthEnabled && (
          <label className="flex flex-col gap-1">
            <span className="font-body text-xs text-steel uppercase tracking-wide">Session length (minutes)</span>
            <input
              type="number"
              min={5}
              value={sessionInput}
              placeholder="Same as the slot"
              onChange={(e) => setSessionInput(e.target.value)}
              className={inputCls}
            />
          </label>
        )}
        <button
          type="button"
          onClick={handleAdd}
          disabled={submitting}
          className="w-full h-9 bg-rust text-graphite font-body text-xs font-medium disabled:opacity-40"
        >
          Add
        </button>
        {error && <p className="font-body text-xs text-rust">{error}</p>}
      </div>
    </div>
  );
}

const PRESETS = [30, 40, 45, 50, 55, 60];

// One control for the common case: "my sessions are 55 minutes" for every window at once. A window can still differ (edit it on its row).
function SessionLengthForAll({ coachId, current, onChanged }: { coachId: string; current: (number | null)[]; onChanged: (minutes: number | null) => void }) {
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const single = current.length === 1 ? current[0] : undefined;

  async function apply(minutes: number | null) {
    if (minutes != null && (!Number.isInteger(minutes) || minutes < 5 || minutes > 480)) {
      setErr("Session length must be a whole number from 5 to 480 minutes.");
      return;
    }
    setBusy(true);
    setErr(null);
    const supabase = createBrowserClient();
    const { error } = await supabase.from("coach_availability_windows").update({ session_minutes: minutes }).eq("coach_id", coachId);
    setBusy(false);
    if (error) {
      setErr("That didn't save. Nothing was changed. Try again.");
      return;
    }
    onChanged(minutes);
  }

  return (
    <div className="border border-steel/20 p-3 mb-3">
      <p className="font-body text-xs text-steel uppercase tracking-wide mb-2">Session length for all your hours</p>
      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map((m) => (
          <button
            key={m}
            type="button"
            disabled={busy}
            aria-pressed={single === m}
            onClick={() => apply(m)}
            className={`h-9 px-3 border font-body text-xs disabled:opacity-40 ${single === m ? "border-rust bg-rust/10 text-chalk" : "border-steel/30 text-steel"}`}
          >
            {m} min
          </button>
        ))}
        <input
          type="number"
          min={5}
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          placeholder="Other"
          aria-label="Other session length in minutes"
          className={`${inputCls} w-20`}
        />
        <button type="button" disabled={busy || !custom.trim()} onClick={() => apply(Number(custom))} className="h-9 px-3 border border-steel/30 text-chalk font-body text-xs disabled:opacity-40">
          Set
        </button>
        <button type="button" disabled={busy || single === null} onClick={() => apply(null)} className="h-9 px-3 text-steel font-body text-xs underline underline-offset-2 disabled:opacity-40">
          Same as the slot
        </button>
      </div>
      <p className="font-body text-xs text-steel mt-2">
        Slots keep starting on your slot step; each booking lasts this long. A 55-minute session in 60-minute slots leaves a 5-minute gap. Set the gap rule (buffer) under Booking rules.
      </p>
      {current.length > 1 && <p className="font-body text-xs text-steel mt-1">Your windows currently differ; picking a length sets it on all of them.</p>}
      {err && (
        <p className="font-body text-xs text-rust mt-2" role="alert">
          {err}
        </p>
      )}
    </div>
  );
}
