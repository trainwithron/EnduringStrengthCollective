"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { bookingFitsAvailability, resolveBlockedRangesForDate, type AvailabilityWindow } from "@/lib/booking-slots";
import { DEFAULT_COACH_TIMEZONE, dateKeyInZone } from "@/lib/timezone";
import { buildCreditPicture, fetchBookingCounts } from "@/lib/credit-picture";
import { coachCreditSentence } from "@/lib/credit-sentence";

interface MoveRequest {
  id: string;
  kind: "new" | "move";
  clientName: string;
  fromStartAt: string | null;
  newStartAt: string;
  newEndAt: string | null;
  // Outside the coach's open hours or on their time off: said plainly on the card (the coach can still confirm).
  outsideHours: boolean;
  athleteId: string;
  groupId: string;
}

interface FlaggedChange {
  id: string;
  startAt: string;
  kind: "cancel" | "reschedule";
  clientName: string;
  athleteId: string;
  groupId: string;
}

// A client who cancels or moves a session inside your cancellation window is flagged here for YOU to decide: Charge takes one session, Waive
// takes nothing. Nothing is taken automatically. Shows nothing at all when no change is waiting (and before the database update that adds the
// flag is applied, the lookup fails quietly and the panel stays empty).
export function LateChangesPanel() {
  const [items, setItems] = useState<FlaggedChange[]>([]);
  const [moves, setMoves] = useState<MoveRequest[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Where each client's sessions stand, in a plain sentence, so the coach can decide with the numbers in view.
  const [creditLines, setCreditLines] = useState<Record<string, string>>({});
  // Times are shown on the coach's own clock, not the browser's, and the card says which clock.
  const [timezone, setTimezone] = useState<string>(DEFAULT_COACH_TIMEZONE);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const supabase = createBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data, error: loadError } = await supabase
        .from("bookings")
        .select("id, start_at, late_change_kind, athlete_id, group_id, profiles!bookings_athlete_id_fkey ( full_name )")
        .eq("coach_id", user.id)
        .eq("late_charge_state", "flagged")
        .order("start_at", { ascending: true })
        .limit(20);
      // Booking requests, new and move (needs the database update that adds them; until then the lookup fails quietly and nothing shows).
      const { data: moveData, error: moveError } = await supabase
        .from("booking_requests")
        .select("id, kind, from_start_at, new_start_at, new_end_at, athlete_id, group_id, profiles!booking_requests_athlete_id_fkey ( full_name )")
        .eq("coach_id", user.id)
        .eq("status", "pending")
        .gt("new_start_at", new Date().toISOString())
        .order("new_start_at", { ascending: true })
        .limit(20);
      if (!cancelled && !moveError) {
        // The coach's clock and open hours, to say where a requested time sits (a session can be asked for at any minute).
        const { data: coachProfile } = await supabase.from("profiles").select("timezone").eq("id", user.id).maybeSingle();
        const tz = (coachProfile?.timezone as string | null) ?? DEFAULT_COACH_TIMEZONE;
        const { data: windowRows } = await supabase.from("coach_availability_windows").select("weekday, start_time, end_time, slot_duration_minutes").eq("coach_id", user.id);
        const { data: exceptionRows } = await supabase.from("coach_availability_exceptions").select("kind, start_at, end_at, weekday, start_time, end_time").eq("coach_id", user.id);
        const windows: AvailabilityWindow[] = ((windowRows ?? []) as any[]).map((w) => ({
          weekday: w.weekday,
          startTime: w.start_time,
          endTime: w.end_time,
          slotDurationMinutes: w.slot_duration_minutes,
        }));
        const rawExceptions = ((exceptionRows ?? []) as any[]).map((e) => ({
          kind: e.kind as "one_off" | "recurring",
          startAt: e.start_at as string | null,
          endAt: e.end_at as string | null,
          weekday: e.weekday as number | null,
          startTime: e.start_time as string | null,
          endTime: e.end_time as string | null,
        }));
        if (!cancelled) setTimezone(tz);
        setMoves(
          ((moveData ?? []) as any[]).map((m) => {
            const start = new Date(m.new_start_at as string);
            const end = m.new_end_at ? new Date(m.new_end_at as string) : null;
            let outsideHours = false;
            if (end && windows.length > 0) {
              const [y, mo, d] = dateKeyInZone(tz, start).split("-").map(Number);
              const localNoon = new Date(y, mo - 1, d, 12, 0, 0);
              outsideHours = !bookingFitsAvailability(start, windows, resolveBlockedRangesForDate(localNoon, rawExceptions, tz), tz, localNoon, end);
            }
            return {
              id: m.id as string,
              kind: (m.kind as "new" | "move") ?? "new",
              clientName: (m.profiles?.full_name as string | undefined) ?? "A client",
              fromStartAt: (m.from_start_at as string | null) ?? null,
              newStartAt: m.new_start_at as string,
              newEndAt: (m.new_end_at as string | null) ?? null,
              outsideHours,
              athleteId: m.athlete_id as string,
              groupId: m.group_id as string,
            };
          })
        );
      }
      if (cancelled || loadError) return;
      setItems(
        ((data ?? []) as any[]).map((b) => ({
          id: b.id as string,
          startAt: b.start_at as string,
          kind: (b.late_change_kind as "cancel" | "reschedule") ?? "cancel",
          clientName: (b.profiles?.full_name as string | undefined) ?? "A client",
          athleteId: b.athlete_id as string,
          groupId: b.group_id as string,
        }))
      );
      // The sentence about each client's sessions. If it cannot load, the rows simply show without it.
      try {
        const names = new Map<string, string>();
        const pairs = new Map<string, { athleteId: string; groupId: string }>();
        for (const b of (data ?? []) as any[]) {
          pairs.set(`${b.athlete_id}:${b.group_id}`, { athleteId: b.athlete_id, groupId: b.group_id });
          names.set(`${b.athlete_id}:${b.group_id}`, (b.profiles?.full_name as string | undefined) ?? "This client");
        }
        for (const m of (moveData ?? []) as any[]) {
          pairs.set(`${m.athlete_id}:${m.group_id}`, { athleteId: m.athlete_id, groupId: m.group_id });
          names.set(`${m.athlete_id}:${m.group_id}`, (m.profiles?.full_name as string | undefined) ?? "This client");
        }
        if (pairs.size > 0) {
          const ids = Array.from(new Set(Array.from(pairs.values()).map((p) => p.athleteId)));
          const [{ data: creditRows }, counts] = await Promise.all([
            supabase.from("session_credits").select("athlete_id, group_id, balance").in("athlete_id", ids),
            fetchBookingCounts(supabase, { coachId: user.id, athleteIds: ids }),
          ]);
          const balanceByKey = new Map(((creditRows ?? []) as any[]).map((r) => [`${r.athlete_id}:${r.group_id}`, r.balance as number]));
          const lines: Record<string, string> = {};
          pairs.forEach((_p, key) => {
            const c = counts.get(key);
            lines[key] = coachCreditSentence(buildCreditPicture({ balance: balanceByKey.get(key) ?? 0, booked: c?.booked ?? 0, toMark: c?.toMark ?? 0 }), names.get(key) ?? "This client");
          });
          if (!cancelled) setCreditLines(lines);
        }
      } catch {
        // No sentence; the decision rows work without it.
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function decide(id: string, charge: boolean) {
    setBusyId(id);
    setError(null);
    const supabase = createBrowserClient();
    const { error: rpcError } = await supabase.rpc("resolve_late_change", { p_booking_id: id, p_charge: charge });
    setBusyId(null);
    if (rpcError) {
      setError("That didn't save. Nothing was changed. Try again.");
      return;
    }
    setItems((prev) => prev.filter((i) => i.id !== id));
  }

  async function answerMove(id: string, confirm: boolean) {
    setBusyId(id);
    setError(null);
    const supabase = createBrowserClient();
    const { data, error: rpcError } = await supabase.rpc("resolve_booking_request", { p_request_id: id, p_confirm: confirm });
    setBusyId(null);
    if (rpcError) {
      setError("That didn't save. Nothing was changed. Try again.");
      return;
    }
    if (data === "closed") setError("That session is no longer scheduled, so the request was closed.");
    if (data === "slot_taken") setError("Someone else took that time first, so the request was declined and the client told.");
    setMoves((prev) => prev.filter((m) => m.id !== id));
  }

  const fmt = (iso: string) =>
    new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: timezone });
  const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: timezone });
  const tzName = (iso: string) => new Intl.DateTimeFormat("en-US", { timeZone: timezone, timeZoneName: "short" }).formatToParts(new Date(iso)).find((p) => p.type === "timeZoneName")?.value ?? timezone;

  if (items.length === 0 && moves.length === 0) return null;

  return (
    <section className="border border-rust/40 bg-rust/5 rounded-token-lg p-4 mb-6" aria-label="Needs your decision">
      <h2 className="font-body text-xs text-rust uppercase tracking-wide font-bold">Needs your decision</h2>
      {moves.length > 0 && (
        <>
          <p className="font-body text-xs text-steel mt-1">
            These clients asked for a session or a move. Nothing is booked or moved until you confirm.
          </p>
          <ul className="divide-y divide-steel/15 mt-2 mb-3">
            {moves.map((m) => (
              <li key={m.id} className="py-2.5 flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-body text-sm text-chalk truncate">{m.clientName}</p>
                  <p className="font-body text-xs text-steel">
                    {m.kind === "move" && m.fromStartAt ? `Move ${fmt(m.fromStartAt)} to ${fmt(m.newStartAt)}` : `New session ${fmt(m.newStartAt)}`}
                    {m.newEndAt ? ` to ${fmtTime(m.newEndAt)}` : ""} ({tzName(m.newStartAt)})
                  </p>
                  {m.outsideHours && <p className="font-body text-xs text-rust">Outside your open hours or on your time off. You can still confirm it.</p>}
                  {creditLines[`${m.athleteId}:${m.groupId}`] && <p className="font-body text-xs text-steel">{creditLines[`${m.athleteId}:${m.groupId}`]}</p>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={busyId === m.id}
                    onClick={() => answerMove(m.id, true)}
                    className="h-11 px-4 border border-rust text-rust font-body text-sm disabled:opacity-50"
                  >
                    Confirm
                  </button>
                  <button
                    type="button"
                    disabled={busyId === m.id}
                    onClick={() => answerMove(m.id, false)}
                    className="h-11 px-4 border border-steel/30 text-chalk font-body text-sm disabled:opacity-50"
                  >
                    Decline
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      {items.length > 0 && (
      <p className="font-body text-xs text-steel mt-1">
        These clients cancelled or moved a session inside your cancellation window. Nothing was taken. Charge takes one session; Waive takes none.
      </p>
      )}
      <ul className="divide-y divide-steel/15 mt-2">
        {items.map((i) => (
          <li key={i.id} className="py-2.5 flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="font-body text-sm text-chalk truncate">{i.clientName}</p>
              <p className="font-body text-xs text-steel">
                {i.kind === "reschedule" ? "Moved" : "Cancelled"} a session for{" "}
                {new Date(i.startAt).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
              </p>
              {creditLines[`${i.athleteId}:${i.groupId}`] && <p className="font-body text-xs text-steel">{creditLines[`${i.athleteId}:${i.groupId}`]}</p>}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                disabled={busyId === i.id}
                onClick={() => decide(i.id, true)}
                className="h-11 px-4 border border-rust text-rust font-body text-sm disabled:opacity-50"
              >
                Charge
              </button>
              <button
                type="button"
                disabled={busyId === i.id}
                onClick={() => decide(i.id, false)}
                className="h-11 px-4 border border-steel/30 text-chalk font-body text-sm disabled:opacity-50"
              >
                Waive
              </button>
            </div>
          </li>
        ))}
      </ul>
      {error && (
        <p className="font-body text-xs text-rust mt-2" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
