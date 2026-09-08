"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export interface AvailabilityException {
  id: string;
  kind: "one_off" | "recurring";
  label: string | null;
  startAt: string | null;
  endAt: string | null;
  weekday: number | null;
  startTime: string | null;
  endTime: string | null;
}

export function AvailabilityExceptionsManager({
  coachId,
  initialExceptions,
}: {
  coachId: string;
  initialExceptions: AvailabilityException[];
}) {
  const [exceptions, setExceptions] = useState(initialExceptions);
  const [mode, setMode] = useState<"one_off" | "recurring">("one_off");
  const [label, setLabel] = useState("");
  const [oneOffStart, setOneOffStart] = useState("");
  const [oneOffEnd, setOneOffEnd] = useState("");
  const [recurWeekday, setRecurWeekday] = useState(1);
  const [recurStart, setRecurStart] = useState("12:00");
  const [recurEnd, setRecurEnd] = useState("13:00");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleAdd() {
    setError(null);
    if (mode === "one_off") {
      if (!oneOffStart || !oneOffEnd) {
        setError("Pick a start and end.");
        return;
      }
      if (new Date(oneOffEnd) <= new Date(oneOffStart)) {
        setError("End must be after start.");
        return;
      }
    }
    setBusy(true);
    const supabase = createBrowserClient();
    const payload =
      mode === "one_off"
        ? {
            coach_id: coachId,
            kind: "one_off",
            label: label.trim() || null,
            start_at: new Date(oneOffStart).toISOString(),
            end_at: new Date(oneOffEnd).toISOString(),
            weekday: null,
            start_time: null,
            end_time: null,
          }
        : {
            coach_id: coachId,
            kind: "recurring",
            label: label.trim() || null,
            start_at: null,
            end_at: null,
            weekday: recurWeekday,
            start_time: recurStart,
            end_time: recurEnd,
          };
    const { data, error: insertError } = await supabase
      .from("coach_availability_exceptions")
      .insert(payload as any)
      .select("id, kind, label, start_at, end_at, weekday, start_time, end_time")
      .single();
    setBusy(false);
    if (insertError || !data) {
      setError("Couldn't save — try again.");
      return;
    }
    setExceptions((prev) => [
      ...prev,
      {
        id: data.id,
        kind: data.kind,
        label: data.label,
        startAt: data.start_at,
        endAt: data.end_at,
        weekday: data.weekday,
        startTime: data.start_time,
        endTime: data.end_time,
      },
    ]);
    setLabel("");
    setOneOffStart("");
    setOneOffEnd("");
    router.refresh();
  }

  async function handleDelete(id: string) {
    setExceptions((prev) => prev.filter((e) => e.id !== id));
    const supabase = createBrowserClient();
    await supabase.from("coach_availability_exceptions").delete().eq("id", id);
    router.refresh();
  }

  return (
    <div className="border border-steel/20 bg-surface/40 p-4 mb-6 max-w-lg">
      <p className="font-body text-xs text-steel uppercase tracking-wide mb-1">
        Block time off
      </p>
      <p className="font-body text-xs text-steel mb-3">
        Time off is subtracted from your recurring hours — clients never see
        it as bookable.
      </p>

      {exceptions.length > 0 && (
        <div className="mb-4 divide-y divide-steel/15">
          {exceptions.map((e) => (
            <div key={e.id} className="py-2 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="font-body text-sm text-chalk truncate">
                  {e.label || (e.kind === "one_off" ? "Time off" : "Recurring block")}
                </p>
                <p className="font-body text-[11px] text-steel">
                  {e.kind === "one_off"
                    ? `${new Date(e.startAt!).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })} – ${new Date(e.endAt!).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}`
                    : `Every ${WEEKDAY_LABELS[e.weekday!]}, ${e.startTime!.slice(0, 5)}–${e.endTime!.slice(0, 5)}`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleDelete(e.id)}
                className="shrink-0 font-body text-xs text-steel active:text-rust"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-1 mb-3">
        <button
          type="button"
          onClick={() => setMode("one_off")}
          className={`h-8 px-3 font-body text-xs border ${
            mode === "one_off" ? "bg-rust text-graphite border-rust" : "border-steel/30 text-steel"
          }`}
        >
          One-off
        </button>
        <button
          type="button"
          onClick={() => setMode("recurring")}
          className={`h-8 px-3 font-body text-xs border ${
            mode === "recurring" ? "bg-rust text-graphite border-rust" : "border-steel/30 text-steel"
          }`}
        >
          Recurring
        </button>
      </div>

      <div className="space-y-2">
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={mode === "one_off" ? "Label (e.g. Vacation)" : "Label (e.g. Lunch break)"}
          className="w-full h-9 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm focus:outline-none focus:border-rust"
        />

        {mode === "one_off" ? (
          <div className="flex items-center gap-2">
            <input
              type="datetime-local"
              value={oneOffStart}
              onChange={(e) => setOneOffStart(e.target.value)}
              className="flex-1 h-9 bg-graphite border border-steel/30 text-chalk px-2 font-body text-xs focus:outline-none focus:border-rust"
            />
            <span className="font-body text-xs text-steel">to</span>
            <input
              type="datetime-local"
              value={oneOffEnd}
              onChange={(e) => setOneOffEnd(e.target.value)}
              className="flex-1 h-9 bg-graphite border border-steel/30 text-chalk px-2 font-body text-xs focus:outline-none focus:border-rust"
            />
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <select
              value={recurWeekday}
              onChange={(e) => setRecurWeekday(Number(e.target.value))}
              className="h-9 bg-graphite border border-steel/30 text-chalk px-2 font-body text-xs focus:outline-none focus:border-rust"
            >
              {WEEKDAY_LABELS.map((label, i) => (
                <option key={i} value={i}>
                  {label}
                </option>
              ))}
            </select>
            <input
              type="time"
              value={recurStart}
              onChange={(e) => setRecurStart(e.target.value)}
              className="h-9 bg-graphite border border-steel/30 text-chalk px-2 font-body text-xs focus:outline-none focus:border-rust"
            />
            <span className="font-body text-xs text-steel">to</span>
            <input
              type="time"
              value={recurEnd}
              onChange={(e) => setRecurEnd(e.target.value)}
              className="h-9 bg-graphite border border-steel/30 text-chalk px-2 font-body text-xs focus:outline-none focus:border-rust"
            />
          </div>
        )}

        {error && (
          <p className="font-body text-xs text-rust" role="alert">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={handleAdd}
          disabled={busy}
          className="h-9 px-4 bg-rust text-graphite font-body text-xs font-medium disabled:opacity-40"
        >
          {busy ? "Saving…" : "Add block"}
        </button>
      </div>
    </div>
  );
}
