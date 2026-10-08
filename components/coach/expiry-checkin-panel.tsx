"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createBrowserClient } from "@/lib/supabase/client";
import {
  DEFAULT_HEADS_UP_DAYS,
  buildCheckInDraft,
  expiringSoon,
  expiryDismissalKey,
  expiryFinalKey,
  holdUntilAfterExtension,
  isSnoozed,
  pauseUntil,
  returningClient,
  type ExpiringSoon,
  type ReturningClient,
} from "@/lib/expiry-checkin";

interface SoonItem extends ExpiringSoon {
  name: string;
  lastWorkoutAt: string | null;
}
interface ReturnItem extends ReturningClient {
  name: string;
}

const fmtDate = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

// Two quiet prompts for the coach (suggestions only, nothing is sent or changed on its own):
//  * before a client's sessions expire: "Sam has 9 sessions and 14 days left", with a drafted check-in to edit and send, an Extend or pause for
//    this client, and Not now (which stays away for two weeks);
//  * when a client returns after some sessions already expired: "Back after 9 months. 9 sessions expired on Jan 10", with Reinstate.
// Everything lives behind the 0280 database update; before it is applied the lookups fail quietly and nothing shows.
export function ExpiryCheckInPanel({ groupIds: scopeGroupIds }: { groupIds?: string[] } = {}) {
  const scopeKey = scopeGroupIds ? scopeGroupIds.join(",") : "";
  const [coachId, setCoachId] = useState<string | null>(null);
  const [soon, setSoon] = useState<SoonItem[]>([]);
  const [returning, setReturning] = useState<ReturnItem[]>([]);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [openExtend, setOpenExtend] = useState<string | null>(null);
  const [openReinstate, setOpenReinstate] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const supabase = createBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      if (!cancelled) setCoachId(user.id);
      const now = new Date();

      const { data: policy, error: policyError } = await supabase
        .from("coach_booking_policies")
        .select("credit_expiry_days, expiry_heads_up_days")
        .eq("coach_id", user.id)
        .maybeSingle();
      if (policyError) return;
      const expiryDays = (policy?.credit_expiry_days as number | undefined) ?? 0;
      if (expiryDays <= 0) return;
      const headsUp = (policy?.expiry_heads_up_days as number | undefined) ?? DEFAULT_HEADS_UP_DAYS;

      const { data: coached } = await supabase.from("group_memberships").select("group_id").eq("profile_id", user.id).eq("role", "coach");
      const groupIds = (coached ?? []).map((r: any) => r.group_id as string).filter((id: string) => !scopeGroupIds || scopeGroupIds.includes(id));
      if (groupIds.length === 0) return;

      const { data: credits, error: creditsError } = await supabase
        .from("session_credits")
        .select("athlete_id, group_id, balance, last_granted_at, expiry_hold_until")
        .in("group_id", groupIds);
      if (creditsError) return;

      const rows = ((credits ?? []) as any[]).map((r) => ({
        athleteId: r.athlete_id as string,
        groupId: r.group_id as string,
        balance: r.balance as number,
        lastGrantedAt: (r.last_granted_at as string | null) ?? null,
        holdUntil: (r.expiry_hold_until as string | null) ?? null,
      }));
      const upcoming = expiringSoon(rows, expiryDays, headsUp, now);

      // Past decisions: "Not now" stays away for two weeks.
      const { data: feedback } = await supabase
        .from("spotter_recommendation_feedback")
        .select("dismissal_key, created_at")
        .eq("coach_id", user.id)
        .eq("spotter_kind", "expiry")
        .order("created_at", { ascending: false })
        .limit(200);
      const lastDenied = new Map<string, string>();
      for (const f of (feedback ?? []) as any[]) if (!lastDenied.has(f.dismissal_key)) lastDenied.set(f.dismissal_key, f.created_at);

      // Expired sessions that were not given back, with the client's last activity after that.
      const { data: expiredRows } = await supabase
        .from("session_credit_ledger")
        .select("athlete_id, group_id, created_at")
        .eq("kind", "expired")
        .in("group_id", groupIds)
        .order("created_at", { ascending: false });
      const expiredOn = new Map<string, Date>();
      for (const e of (expiredRows ?? []) as any[]) {
        const k = `${e.athlete_id}:${e.group_id}`;
        if (!expiredOn.has(k)) expiredOn.set(k, new Date(e.created_at));
      }

      // "No, leave them expired" answers are final for that expiry date.
      const { data: finals } = await supabase
        .from("spotter_recommendation_feedback")
        .select("dismissal_key")
        .eq("coach_id", user.id)
        .eq("spotter_kind", "expiry")
        .like("dismissal_key", "expiry-returning-final::%");
      const finalKeys = new Set(((finals ?? []) as any[]).map((f) => f.dismissal_key as string));

      const athleteIds = Array.from(new Set([...upcoming.map((u) => u.athleteId), ...Array.from(expiredOn.keys()).map((k) => k.split(":")[0])]));
      if (athleteIds.length === 0) return;
      // Each client's latest workout is looked up on its own, so a busy coach's many other clients can never crowd one out of a shared list.
      const [{ data: profiles }, lastLogRows] = await Promise.all([
        supabase.from("profiles").select("id, full_name").in("id", athleteIds),
        Promise.all(
          athleteIds.map(async (id) => {
            const { data } = await supabase.from("workout_logs").select("created_at").eq("athlete_id", id).order("created_at", { ascending: false }).limit(1);
            return [id, ((data ?? [])[0] as any)?.created_at as string | undefined] as const;
          })
        ),
      ]);
      const nameById = new Map(((profiles ?? []) as any[]).map((p) => [p.id as string, (p.full_name as string) ?? "Client"]));
      const lastLog = new Map<string, string>();
      for (const [id, at] of lastLogRows) if (at) lastLog.set(id, at);

      const soonItems: SoonItem[] = upcoming
        .filter((u) => !isSnoozed(lastDenied.get(expiryDismissalKey(u.athleteId, u.groupId, "soon")) ?? null, now))
        .map((u) => ({ ...u, name: nameById.get(u.athleteId) ?? "Client", lastWorkoutAt: lastLog.get(u.athleteId) ?? null }));

      const candidates = Array.from(expiredOn.entries())
        .map(([k, on]) => {
          const [athleteId, groupId] = k.split(":");
          return { athleteId, groupId, on };
        })
        .filter((c) => !finalKeys.has(expiryFinalKey(c.athleteId, c.groupId, c.on)))
        .filter((c) => !isSnoozed(lastDenied.get(expiryDismissalKey(c.athleteId, c.groupId, "returning")) ?? null, now))
        // Only clients who have been active since the sessions expired can be a returning client; skip the lookup for the rest.
        .filter((c) => lastLog.get(c.athleteId) && new Date(lastLog.get(c.athleteId) as string).getTime() > c.on.getTime());
      const lefts = await Promise.all(
        candidates.map(async (c) => {
          const { data: left } = await supabase.rpc("reinstatable_expired_credits", { p_athlete_id: c.athleteId, p_group_id: c.groupId });
          return typeof left === "number" ? left : 0;
        })
      );
      const returnItems: ReturnItem[] = [];
      candidates.forEach((c, i) => {
        const lastActivity = new Date(lastLog.get(c.athleteId) as string);
        const r = returningClient({ athleteId: c.athleteId, groupId: c.groupId, expiredOn: c.on, reinstatable: lefts[i], lastActivityAt: lastActivity, now });
        if (r) returnItems.push({ ...r, name: nameById.get(c.athleteId) ?? "Client" });
      });
      if (cancelled) return;
      setSoon(soonItems);
      setReturning(returnItems);
    }
    load().catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey]);

  async function notNow(athleteId: string, groupId: string, kind: "soon" | "returning", summary: string) {
    if (!coachId) return;
    const supabase = createBrowserClient();
    await supabase.from("spotter_recommendation_feedback").insert({
      coach_id: coachId,
      spotter_kind: "expiry",
      dismissal_key: expiryDismissalKey(athleteId, groupId, kind),
      option_summary: summary,
      action: "denied",
    });
    if (kind === "soon") setSoon((p) => p.filter((i) => !(i.athleteId === athleteId && i.groupId === groupId)));
    else setReturning((p) => p.filter((i) => !(i.athleteId === athleteId && i.groupId === groupId)));
  }

  // A final answer for this expiry: the prompt does not come back for these expired sessions (a later expiry would ask again).
  async function leaveExpired(item: ReturnItem) {
    if (!coachId) return;
    const supabase = createBrowserClient();
    await supabase.from("spotter_recommendation_feedback").insert({
      coach_id: coachId,
      spotter_kind: "expiry",
      dismissal_key: expiryFinalKey(item.athleteId, item.groupId, item.expiredOn),
      option_summary: `${item.name} returned; ${item.reinstatable} expired sessions left expired`,
      action: "denied",
    });
    setReturning((p) => p.filter((i) => !(i.athleteId === item.athleteId && i.groupId === item.groupId)));
  }

  async function extend(item: SoonItem, days: number | "pause") {
    const key = `soon:${item.athleteId}:${item.groupId}`;
    setBusyKey(key);
    setError(null);
    const now = new Date();
    const until = days === "pause" ? pauseUntil(now) : holdUntilAfterExtension(item.expiresOn, days, now);
    const supabase = createBrowserClient();
    const { error: rpcError } = await supabase.rpc("set_credit_expiry_hold", {
      p_athlete_id: item.athleteId,
      p_group_id: item.groupId,
      p_until: until.toISOString(),
      p_note: note.trim() || null,
    });
    setBusyKey(null);
    if (rpcError) {
      setError("That didn't save. Nothing was changed. Try again.");
      return;
    }
    setNote("");
    setOpenExtend(null);
    setSoon((p) => p.filter((i) => !(i.athleteId === item.athleteId && i.groupId === item.groupId)));
  }

  async function reinstate(item: ReturnItem) {
    const key = `ret:${item.athleteId}:${item.groupId}`;
    const n = Number(amount);
    if (!Number.isInteger(n) || n < 1 || n > item.reinstatable) {
      setError(`Choose a number from 1 to ${item.reinstatable}.`);
      return;
    }
    setBusyKey(key);
    setError(null);
    const supabase = createBrowserClient();
    const { error: rpcError } = await supabase.rpc("reinstate_expired_credits", {
      p_athlete_id: item.athleteId,
      p_group_id: item.groupId,
      p_amount: n,
      p_note: note.trim() || null,
    });
    setBusyKey(null);
    if (rpcError) {
      setError("That didn't save. Nothing was changed. Try again.");
      return;
    }
    setNote("");
    setAmount("");
    setOpenReinstate(null);
    setReturning((p) => p.filter((i) => !(i.athleteId === item.athleteId && i.groupId === item.groupId)));
  }

  if (soon.length === 0 && returning.length === 0) return null;

  const btn = "h-11 px-4 border font-body text-sm disabled:opacity-50";

  return (
    <section className="border border-steel/30 bg-surface/40 rounded-token-lg p-4 mb-6" aria-label="Sessions about to expire">
      <h2 className="font-body text-xs text-steel uppercase tracking-wide font-bold">A check-in worth making</h2>
      <ul className="divide-y divide-steel/15 mt-1">
        {soon.map((i) => {
          const key = `soon:${i.athleteId}:${i.groupId}`;
          const draft = buildCheckInDraft({ firstName: i.name.split(" ")[0] ?? "", balance: i.balance, daysLeft: i.daysLeft });
          return (
            <li key={key} className="py-3">
              <p className="font-body text-sm text-chalk">
                {i.name} has {i.balance} {i.balance === 1 ? "session" : "sessions"} and {i.daysLeft} {i.daysLeft === 1 ? "day" : "days"} left.
              </p>
              <p className="font-body text-xs text-steel mt-0.5">
                Expires {fmtDate(i.expiresOn)}.{" "}
                {i.lastWorkoutAt ? `Last workout ${fmtDate(new Date(i.lastWorkoutAt))}.` : "No workout logged yet."} Maybe reach out and see how they are doing.
              </p>
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <Link
                  href={`/groups/${i.groupId}/messages/${i.athleteId}?draft=${encodeURIComponent(draft)}`}
                  className={`${btn} border-rust text-rust inline-flex items-center`}
                >
                  Message them
                </Link>
                <button type="button" onClick={() => { setOpenExtend(openExtend === key ? null : key); setNote(""); }} className={`${btn} border-steel/30 text-chalk`}>
                  Extend or pause
                </button>
                <button type="button" onClick={() => notNow(i.athleteId, i.groupId, "soon", `${i.name}: ${i.balance} sessions, ${i.daysLeft} days left`)} className={`${btn} border-steel/30 text-steel`}>
                  Not now
                </button>
              </div>
              {openExtend === key && (
                <div className="mt-2 space-y-2">
                  <input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Note (optional), for example: away until winter"
                    className="w-full h-11 bg-graphite border border-steel/30 text-chalk px-2 font-body text-base sm:text-sm"
                  />
                  <p className="font-body text-xs text-steel">The note is saved in their session history, which they can see.</p>
                  <div className="flex flex-wrap gap-2">
                    {[30, 60, 90].map((d) => (
                      <button key={d} type="button" disabled={busyKey === key} onClick={() => extend(i, d)} className={`${btn} border-rust text-rust`}>
                        {d} more days
                      </button>
                    ))}
                    <button type="button" disabled={busyKey === key} onClick={() => extend(i, "pause")} className={`${btn} border-steel/30 text-chalk`}>
                      Pause for now
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
        {returning.map((i) => {
          const key = `ret:${i.athleteId}:${i.groupId}`;
          return (
            <li key={key} className="py-3">
              <p className="font-body text-sm text-chalk">
                {i.name} is back after about {i.monthsAway} {i.monthsAway === 1 ? "month" : "months"}.
              </p>
              <p className="font-body text-xs text-steel mt-0.5">
                {i.reinstatable} {i.reinstatable === 1 ? "session" : "sessions"} expired on {fmtDate(i.expiredOn)}. Reinstate any, or none: your call.
              </p>
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <button type="button" onClick={() => { setOpenReinstate(openReinstate === key ? null : key); setAmount(String(i.reinstatable)); setNote(""); }} className={`${btn} border-rust text-rust`}>
                  Reinstate sessions
                </button>
                <button type="button" onClick={() => notNow(i.athleteId, i.groupId, "returning", `${i.name} returned; ${i.reinstatable} expired`)} className={`${btn} border-steel/30 text-steel`}>
                  Not now
                </button>
                <button type="button" onClick={() => leaveExpired(i)} className={`${btn} border-steel/30 text-steel`}>
                  No, leave them expired
                </button>
              </div>
              {openReinstate === key && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    inputMode="numeric"
                    aria-label="How many sessions"
                    className="w-20 h-11 bg-graphite border border-steel/30 text-chalk px-2 font-body text-base sm:text-sm"
                  />
                  <input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Note (optional)"
                    className="flex-1 min-w-[10rem] h-11 bg-graphite border border-steel/30 text-chalk px-2 font-body text-base sm:text-sm"
                  />
                  <button type="button" disabled={busyKey === key} onClick={() => reinstate(i)} className={`${btn} bg-rust text-graphite border-rust`}>
                    Give back
                  </button>
                  <p className="basis-full font-body text-xs text-steel">
                    Giving sessions back restarts the expiry clock for all of their sessions, not only these. The note is saved in their session history, which they can see.
                  </p>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {error && (
        <p className="font-body text-xs text-rust mt-1" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
