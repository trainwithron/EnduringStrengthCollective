"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { formatInTimezone } from "@/lib/format-in-timezone";
import { dateKeyInZone } from "@/lib/timezone";
import { mirrorGoogleCalendarEvent } from "@/lib/mirror-google-calendar-event";
import { MarkAttendedControl, type CreditState } from "@/components/coach/mark-attended-control";
import { useTerm } from "@/components/coach/terminology-provider";
import { buildCreditPicture } from "@/lib/credit-picture";
import { coachCreditSentence } from "@/lib/credit-sentence";
import { ledgerTotals } from "@/lib/credit-ledger-totals";
import type { DraggedClient } from "./draggable-client-name";

interface BookingRow {
  id: string;
  start_at: string;
  status: string;
  credit_state: CreditState;
  attended_at: string | null;
  session_type_id: string | null;
}

const STATE_TEXT: Record<CreditState, string> = { prepaid: "paid", unsettled: "pending", settled: "used", waived: "not charged" };

// Everything the coach has with one client, in one place, opened by tapping their name: a plain sentence about their sessions, the credit adjusters, the sessions
// coming up (time on the coach's own clock, type, pending or not), the past ones still waiting for Attended, with one tap to mark, cancel or open the day. The
// client's own program days and workouts live on their calendar, one tap away; they are not mixed into the coach's.
export function ClientSchedulePanel({ client, timezone, sessionTypes }: { client: DraggedClient; timezone: string; sessionTypes: { id: string; name: string }[] }) {
  const router = useRouter();
  const t = useTerm();
  const [rows, setRows] = useState<BookingRow[] | null>(null);
  const [ledger, setLedger] = useState<{ bought: number; done: number } | null>(null);
  const [balance, setBalance] = useState(client.balance);
  const [adjusting, setAdjusting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const groupId = client.groupId;

  const load = useCallback(async () => {
    if (!groupId) return;
    const supabase = createBrowserClient();
    const since = new Date(Date.now() - 45 * 86400000).toISOString();
    const { data, error: loadError } = await supabase
      .from("bookings")
      .select("id, start_at, status, credit_state, attended_at, session_type_id")
      .eq("athlete_id", client.athleteId)
      .eq("group_id", groupId)
      .eq("status", "confirmed")
      .gte("start_at", since)
      .order("start_at", { ascending: true })
      .limit(60);
    if (loadError) {
      setError("Couldn't load their sessions.");
      setRows([]);
    } else {
      setError(null);
      setRows((data ?? []) as BookingRow[]);
    }
    // What was bought and what was used, from the credit history. If it cannot be read the sentence simply leaves that part out.
    const { data: ledgerRows, error: ledgerError } = await supabase.from("session_credit_ledger").select("kind, amount").eq("athlete_id", client.athleteId).eq("group_id", groupId).limit(2000);
    if (ledgerError) {
      setLedger(null);
      return;
    }
    setLedger(ledgerTotals((ledgerRows ?? []) as { kind: string; amount: number }[]));
  }, [client.athleteId, groupId]);

  useEffect(() => {
    setRows(null);
    setBalance(client.balance);
    load().catch(() => setRows([]));
  }, [load, client.balance]);

  async function adjustCredits(delta: number) {
    if (!groupId) return;
    setAdjusting(true);
    const { data: newBalance } = await createBrowserClient().rpc("adjust_session_credits", { p_athlete_id: client.athleteId, p_group_id: groupId, p_delta: delta });
    if (typeof newBalance === "number") {
      setBalance(newBalance);
      router.refresh();
    }
    setAdjusting(false);
    load().catch(() => {});
  }

  async function cancel(b: BookingRow) {
    if (!window.confirm("Cancel this session? Anything already taken for it goes back to their sessions.")) return;
    setBusyId(b.id);
    setError(null);
    const { error: cancelError } = await createBrowserClient().rpc("cancel_booking_and_refund_credit", { p_booking_id: b.id });
    setBusyId(null);
    if (cancelError) {
      setError("That didn't cancel. Nothing was changed.");
      return;
    }
    mirrorGoogleCalendarEvent(b.id);
    await load();
    router.refresh();
  }

  const now = Date.now();
  // Only unsettled sessions take a session when they happen; a prepaid one already did.
  const unsettled = (rows ?? []).filter((b) => b.credit_state === "unsettled");
  const upcoming = (rows ?? []).filter((b) => new Date(b.start_at).getTime() >= now);
  const awaiting = (rows ?? []).filter((b) => new Date(b.start_at).getTime() < now && !b.attended_at && (b.credit_state === "unsettled" || b.credit_state === "prepaid"));
  const picture = buildCreditPicture({
    balance,
    booked: unsettled.filter((b) => new Date(b.start_at).getTime() >= now).length,
    toMark: awaiting.length,
    bought: ledger?.bought,
    done: ledger?.done,
  });
  const noun = { singular: t("session", "singular"), plural: t("session", "plural") };
  const typeName = (id: string | null) => (id ? sessionTypes.find((x) => x.id === id)?.name ?? null : null);
  const when = (iso: string) => formatInTimezone(new Date(iso), timezone, "dateTime");

  return (
    <div className="mt-3 border border-steel/25 bg-surface p-3" aria-label={`${client.fullName}'s sessions`}>
      <p className="font-display uppercase text-xs tracking-wide text-steel mb-1">{client.fullName}</p>
      {rows === null ? (
        <p className="font-body text-xs text-steel">Loading…</p>
      ) : (
        <>
          <p className="font-body text-sm text-chalk">{coachCreditSentence(picture, client.fullName, noun)}</p>
          <div className="flex items-center gap-1.5 mt-2 font-body text-xs text-steel">
            <span>{t("session", "plural", { cap: true })}</span>
            <button type="button" onClick={() => adjustCredits(-1)} disabled={adjusting} aria-label={`Remove a ${noun.singular} from ${client.fullName}`} className="w-6 h-6 border border-steel/30 text-steel disabled:opacity-40">
              &minus;
            </button>
            <span className="text-chalk w-6 text-center">{balance}</span>
            <button type="button" onClick={() => adjustCredits(1)} disabled={adjusting} aria-label={`Add a ${noun.singular} to ${client.fullName}`} className="w-6 h-6 border border-steel/30 text-steel disabled:opacity-40">
              +
            </button>
          </div>

          {awaiting.length > 0 && (
            <div className="mt-3">
              <p className="font-body text-[11px] text-steel uppercase tracking-wide mb-1">Waiting to be marked</p>
              <ul className="divide-y divide-steel/15">
                {awaiting.map((b) => (
                  <li key={b.id} className="py-2">
                    <p className="font-body text-xs text-chalk">
                      {when(b.start_at)}
                      {typeName(b.session_type_id) ? ` · ${typeName(b.session_type_id)}` : ""}
                    </p>
                    <div className="mt-1">
                      <MarkAttendedControl bookingId={b.id} initialAttended={false} initialState={b.credit_state} athleteId={client.athleteId} groupId={groupId} />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="font-body text-[11px] text-steel uppercase tracking-wide mt-3 mb-1">Coming up</p>
          {upcoming.length === 0 ? (
            <p className="font-body text-xs text-steel">Nothing scheduled with you.</p>
          ) : (
            <ul className="divide-y divide-steel/15">
              {upcoming.map((b) => (
                <li key={b.id} className="py-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-body text-xs text-chalk flex-1 min-w-[9rem]">
                    {when(b.start_at)}
                    {typeName(b.session_type_id) ? ` · ${typeName(b.session_type_id)}` : ""}
                    <span className="text-steel"> · {STATE_TEXT[b.credit_state]}</span>
                  </span>
                  <Link href={`/groups/${groupId}/calendar/${dateKeyInZone(timezone, new Date(b.start_at))}?client=${client.athleteId}`} className="font-body text-xs text-rust underline underline-offset-2">
                    Open day
                  </Link>
                  <button type="button" onClick={() => cancel(b)} disabled={busyId === b.id} className="font-body text-xs text-steel underline underline-offset-2 disabled:opacity-40">
                    {busyId === b.id ? "Cancelling…" : "Cancel"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {error && <p className="font-body text-xs text-rust mt-2">{error}</p>}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
        <Link href={`/groups/${groupId}/athletes/${client.athleteId}/calendar`} className="font-body text-xs text-rust underline underline-offset-2">
          Their calendar &rarr;
        </Link>
        <Link href={`/groups/${groupId}/athletes/${client.athleteId}`} className="font-body text-xs text-rust underline underline-offset-2">
          Profile &rarr;
        </Link>
      </div>
    </div>
  );
}
