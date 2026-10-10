"use client";

import { confirmDialog } from "@/components/shared/confirm-dialog";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { formatInTimezone } from "@/lib/format-in-timezone";
import { dateKeyInZone } from "@/lib/timezone";
import { mirrorGoogleCalendarEvent } from "@/lib/mirror-google-calendar-event";
import { MarkAttendedControl, type CreditState } from "@/components/coach/mark-attended-control";
import { useTerm } from "@/components/coach/terminology-provider";
import { buildCreditPicture, fetchBookingCounts, type BookingCounts } from "@/lib/credit-picture";
import { coachCreditSentence } from "@/lib/credit-sentence";
import { ledgerTotals } from "@/lib/credit-ledger-totals";
import { pageAll } from "@/lib/page-all";
import type { DraggedClient } from "./draggable-client-name";

interface BookingRow {
  id: string;
  start_at: string;
  credit_state: CreditState;
  session_type_id: string | null;
}

const STATE_TEXT: Record<CreditState, string> = { prepaid: "paid", unsettled: "pending", settled: "used", waived: "not charged" };

// Everything the coach has with one client, in one place, opened by tapping their name: a plain sentence about their sessions, the credit adjusters, the sessions
// coming up (time on the coach's own clock, type, pending or not), the past ones still waiting for Attended, with one tap to mark, cancel or open the day. The
// client's own program days and workouts live on their calendar, one tap away; they are not mixed into the coach's. The numbers are the same server counts the
// list uses (every session, not a window of recent ones), and they are read again after every change made here.
export function ClientSchedulePanel({ client, timezone, sessionTypes }: { client: DraggedClient; timezone: string; sessionTypes: { id: string; name: string }[] }) {
  const router = useRouter();
  const t = useTerm();
  const [upcoming, setUpcoming] = useState<BookingRow[] | null>(null);
  const [awaiting, setAwaiting] = useState<BookingRow[]>([]);
  const [counts, setCounts] = useState<BookingCounts>({ booked: 0, toMark: 0, prepaidAhead: 0 });
  const [ledger, setLedger] = useState<{ bought: number; done: number } | null>(null);
  const [balance, setBalance] = useState(client.balance);
  const [adjusting, setAdjusting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addedNote, setAddedNote] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // A session just marked attended stays in the list until the panel is opened again, so its Undo is still there.
  const [kept, setKept] = useState<Record<string, BookingRow>>({});
  const [showAllUpcoming, setShowAllUpcoming] = useState(false);
  const groupId = client.groupId;

  const load = useCallback(async () => {
    if (!groupId) return;
    const supabase = createBrowserClient();
    const nowIso = new Date().toISOString();
    const [upRes, awaitRes, balanceRes, countMap, ledgerRes] = await Promise.all([
      supabase
        .from("bookings")
        .select("id, start_at, credit_state, session_type_id")
        .eq("athlete_id", client.athleteId)
        .eq("group_id", groupId)
        .eq("status", "confirmed")
        .gte("end_at", nowIso)
        .order("start_at", { ascending: true })
        .limit(60),
      supabase
        .from("bookings")
        .select("id, start_at, credit_state, session_type_id")
        .eq("athlete_id", client.athleteId)
        .eq("group_id", groupId)
        .eq("status", "confirmed")
        .eq("credit_state", "unsettled")
        .is("attended_at", null)
        .eq("no_show", false)
        .lt("end_at", nowIso)
        .order("start_at", { ascending: false })
        .limit(30),
      supabase.from("session_credits").select("balance").eq("athlete_id", client.athleteId).eq("group_id", groupId).maybeSingle(),
      fetchBookingCounts(supabase, { athleteId: client.athleteId, groupId }),
      // What was bought and used, from the whole credit history, a page at a time. If it cannot be read the sentence leaves that part out.
      pageAll((from, to) => supabase.from("session_credit_ledger").select("id, kind, amount").eq("athlete_id", client.athleteId).eq("group_id", groupId).order("id", { ascending: true }).range(from, to)),
    ]);
    if (upRes.error) {
      setError("Couldn't load their sessions.");
      setUpcoming([]);
    } else {
      setError(null);
      setUpcoming((upRes.data ?? []) as BookingRow[]);
    }
    setAwaiting(awaitRes.error ? [] : ((awaitRes.data ?? []) as BookingRow[]));
    if (!balanceRes.error && balanceRes.data) setBalance((balanceRes.data as { balance: number }).balance);
    const mine = countMap.get(`${client.athleteId}:${groupId}`) ?? { booked: 0, toMark: 0, prepaidAhead: 0 };
    setCounts(mine);
    setLedger(ledgerRes.failed ? null : ledgerTotals(ledgerRes.rows as { kind: string; amount: number }[], { prepaidAhead: mine.prepaidAhead }));
  }, [client.athleteId, groupId]);

  useEffect(() => {
    setUpcoming(null);
    setKept({});
    setShowAllUpcoming(false);
    setBalance(client.balance);
    load().catch(() => setUpcoming([]));
  }, [load, client.balance]);

  const noun = { singular: t("session", "singular"), plural: t("session", "plural") };

  async function adjustCredits(delta: number) {
    if (!groupId) return;
    // Taking a session away removes value, so it is asked once; adding one is not (a coach adds sessions by hand for cash and gym packs), and the result is shown instead.
    if (delta < 0 && !await confirmDialog({ message: `Remove one ${noun.singular} from ${client.fullName}?`, confirmLabel: "Remove" })) return;
    setAdjusting(true);
    setError(null);
    setAddedNote(null);
    const { data: newBalance, error: rpcError } = await createBrowserClient().rpc("adjust_session_credits", { p_athlete_id: client.athleteId, p_group_id: groupId, p_delta: delta });
    setAdjusting(false);
    if (rpcError) {
      setError("That didn't save. Nothing was changed.");
      return;
    }
    if (typeof newBalance === "number") setBalance(newBalance);
    if (delta > 0) setAddedNote(`Added one. ${typeof newBalance === "number" ? `Balance is now ${newBalance}.` : ""}`.trim());
    router.refresh();
    load().catch(() => {});
  }

  async function cancel(b: BookingRow) {
    if (!await confirmDialog("Cancel this session? Anything already taken for it goes back to their sessions.")) return;
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

  // The rows waiting to be marked, plus any just marked here (kept so the Undo stays), newest first.
  const waitingRows = [...awaiting, ...Object.values(kept).filter((k) => !awaiting.some((a) => a.id === k.id))].sort((a, b) => b.start_at.localeCompare(a.start_at));
  const picture = buildCreditPicture({ balance, booked: counts.booked, toMark: counts.toMark, bought: ledger?.bought, done: ledger?.done });
  const typeName = (id: string | null) => (id ? sessionTypes.find((x) => x.id === id)?.name ?? null : null);
  const when = (iso: string) => formatInTimezone(new Date(iso), timezone, "dateTime");

  return (
    <div className="mt-3 border border-steel/25 bg-surface p-3" aria-label={`${client.fullName}'s sessions`}>
      <p className="font-display uppercase text-xs tracking-wide text-steel mb-1">{client.fullName}</p>
      {upcoming === null ? (
        <p className="font-body text-xs text-steel">Loading…</p>
      ) : (
        <>
          <p className="font-body text-sm text-chalk">{coachCreditSentence(picture, client.fullName, noun)}</p>
          <div className="flex items-center gap-1.5 mt-2 font-body text-xs text-steel">
            <span>{t("session", "plural", { cap: true })} left</span>
            <button type="button" onClick={() => adjustCredits(-1)} disabled={adjusting} aria-label={`Remove a ${noun.singular} from ${client.fullName}`} className="w-6 h-6 border border-steel/30 text-steel disabled:opacity-40">
              &minus;
            </button>
            <span className="text-chalk w-6 text-center">{balance}</span>
            <button type="button" onClick={() => adjustCredits(1)} disabled={adjusting} aria-label={`Add a ${noun.singular} to ${client.fullName}`} className="w-6 h-6 border border-steel/30 text-steel disabled:opacity-40">
              +
            </button>
          </div>

          {waitingRows.length > 0 && (
            <div className="mt-3">
              <p className="font-body text-[11px] text-steel uppercase tracking-wide mb-1">Waiting to be marked</p>
              <ul className="divide-y divide-steel/15">
                {waitingRows.map((b) => (
                  <li key={b.id} className="py-2">
                    <p className="font-body text-xs text-chalk">
                      {when(b.start_at)}
                      {typeName(b.session_type_id) ? ` · ${typeName(b.session_type_id)}` : ""}
                    </p>
                    <div className="mt-1">
                      <MarkAttendedControl
                        bookingId={b.id}
                        initialAttended={false}
                        initialState={b.credit_state}
                        athleteId={client.athleteId}
                        groupId={groupId}
                        onDone={() => {
                          setKept((k) => ({ ...k, [b.id]: b }));
                          load().catch(() => {});
                        }}
                      />
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
              {upcoming.slice(0, showAllUpcoming ? upcoming.length : 8).map((b) => (
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
              {upcoming.length > 8 && !showAllUpcoming && (
                <li className="py-2">
                  <button type="button" onClick={() => setShowAllUpcoming(true)} className="font-body text-xs text-rust underline underline-offset-2">
                    and {upcoming.length - 8} more
                  </button>
                </li>
              )}
            </ul>
          )}
        </>
      )}
      {error && <p className="font-body text-xs text-rust mt-2">{error}</p>}
      {addedNote && <p className="font-body text-xs text-positive mt-2" role="status">{addedNote}</p>}
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
