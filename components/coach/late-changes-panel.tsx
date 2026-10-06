"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

interface MoveRequest {
  id: string;
  kind: "new" | "move";
  clientName: string;
  fromStartAt: string | null;
  newStartAt: string;
}

interface FlaggedChange {
  id: string;
  startAt: string;
  kind: "cancel" | "reschedule";
  clientName: string;
}

// A client who cancels or moves a session inside your cancellation window is flagged here for YOU to decide: Charge takes one session, Waive
// takes nothing. Nothing is taken automatically. Shows nothing at all when no change is waiting (and before the database update that adds the
// flag is applied, the lookup fails quietly and the panel stays empty).
export function LateChangesPanel() {
  const [items, setItems] = useState<FlaggedChange[]>([]);
  const [moves, setMoves] = useState<MoveRequest[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        .select("id, start_at, late_change_kind, profiles!bookings_athlete_id_fkey ( full_name )")
        .eq("coach_id", user.id)
        .eq("late_charge_state", "flagged")
        .order("start_at", { ascending: true })
        .limit(20);
      // Booking requests, new and move (needs the database update that adds them; until then the lookup fails quietly and nothing shows).
      const { data: moveData, error: moveError } = await supabase
        .from("booking_requests")
        .select("id, kind, from_start_at, new_start_at, profiles!booking_requests_athlete_id_fkey ( full_name )")
        .eq("coach_id", user.id)
        .eq("status", "pending")
        .gt("new_start_at", new Date().toISOString())
        .order("new_start_at", { ascending: true })
        .limit(20);
      if (!cancelled && !moveError) {
        setMoves(
          ((moveData ?? []) as any[]).map((m) => ({
            id: m.id as string,
            kind: (m.kind as "new" | "move") ?? "new",
            clientName: (m.profiles?.full_name as string | undefined) ?? "A client",
            fromStartAt: (m.from_start_at as string | null) ?? null,
            newStartAt: m.new_start_at as string,
          }))
        );
      }
      if (cancelled || loadError) return;
      setItems(
        ((data ?? []) as any[]).map((b) => ({
          id: b.id as string,
          startAt: b.start_at as string,
          kind: (b.late_change_kind as "cancel" | "reschedule") ?? "cancel",
          clientName: (b.profiles?.full_name as string | undefined) ?? "A client",
        }))
      );
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
    new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

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
                  </p>
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
