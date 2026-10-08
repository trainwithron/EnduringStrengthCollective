"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createBrowserClient } from "@/lib/supabase/client";
import {
  INACTIVE_AFTER_DAYS,
  KEEP_ACTIVE_SNOOZE_DAYS,
  NOT_NOW_SNOOZE_DAYS,
  buildDoorOpenDraft,
  inactiveDismissalKey,
  inactiveKeepActiveKey,
  inactiveSuggestion,
  isSnoozedFor,
  unansweredFromMessages,
  inactiveThread,
} from "@/lib/inactive-client";

interface Item {
  athleteId: string;
  groupId: string;
  name: string;
  reasons: string[];
}

const DAY = 86400000;
const MAX_CANDIDATES = 60;

// A quiet suggestion for the coach, never a decision: "Probably inactive: Sam. Door open or set aside?" Nothing is sent, archived or changed until the
// coach picks. Setting aside is reversible and deletes nothing. Needs the 0281 database update; before it is applied the lookup fails quietly and
// nothing shows.
export function InactiveClientsPanel({ groupIds: scopeGroupIds }: { groupIds?: string[] } = {}) {
  const scopeKey = scopeGroupIds ? scopeGroupIds.join(",") : "";
  const [coachId, setCoachId] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [busyKey, setBusyKey] = useState<string | null>(null);
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

      const { data: coached } = await supabase.from("group_memberships").select("group_id").eq("profile_id", user.id).eq("role", "coach");
      const groupIds = (coached ?? []).map((r: any) => r.group_id as string).filter((id: string) => !scopeGroupIds || scopeGroupIds.includes(id));
      if (groupIds.length === 0) return;

      // Active clients only. If the column is not there yet this errors and the panel stays empty.
      const { data: members, error: memberError } = await supabase
        .from("group_memberships")
        .select("group_id, profile_id, joined_at")
        .in("group_id", groupIds)
        .eq("role", "athlete");
      if (memberError) return;
      // Anyone already set aside is left out. If the table is not there yet (the 0281 update is not applied) the card stays hidden.
      const { data: aside, error: asideError } = await supabase.from("client_inactive").select("group_id, athlete_id").in("group_id", groupIds);
      if (asideError) return;
      const alreadyAside = new Set(((aside ?? []) as { group_id: string; athlete_id: string }[]).map((r) => `${r.group_id}:${r.athlete_id}`));
      const cutoff = new Date(now.getTime() - INACTIVE_AFTER_DAYS * DAY);
      const old = ((members ?? []) as { group_id: string; profile_id: string; joined_at: string | null }[]).filter(
        (m) => m.profile_id !== user.id && !alreadyAside.has(`${m.group_id}:${m.profile_id}`) && (!m.joined_at || new Date(m.joined_at).getTime() < cutoff.getTime())
      );
      if (old.length === 0) return;
      const athleteIds = Array.from(new Set(old.map((m) => m.profile_id)));
      const cutoffIso = cutoff.toISOString();

      // Who WAS active recently (a workout, a session, or a message from them): everyone else on the list has been quiet for the whole stretch.
      const [logs, bookings, msgs] = await Promise.all([
        supabase.from("workout_logs").select("athlete_id").in("athlete_id", athleteIds).gte("created_at", cutoffIso).limit(5000),
        supabase.from("bookings").select("athlete_id").in("athlete_id", athleteIds).gte("start_at", cutoffIso).limit(5000),
        supabase.from("direct_messages").select("sender_id").in("sender_id", athleteIds).eq("recipient_id", user.id).gte("created_at", cutoffIso).limit(5000),
      ]);
      const recent = new Set<string>();
      for (const r of (logs.data ?? []) as any[]) recent.add(r.athlete_id);
      for (const r of (bookings.data ?? []) as any[]) recent.add(r.athlete_id);
      for (const r of (msgs.data ?? []) as any[]) recent.add(r.sender_id);
      const quiet = old.filter((m) => !recent.has(m.profile_id)).slice(0, MAX_CANDIDATES);
      if (quiet.length === 0) return;
      const quietIds = Array.from(new Set(quiet.map((m) => m.profile_id)));
      const quietGroupIds = Array.from(new Set(quiet.map((m) => m.group_id)));

      // The coach's earlier answers.
      const { data: feedback } = await supabase
        .from("spotter_recommendation_feedback")
        .select("dismissal_key, created_at")
        .eq("coach_id", user.id)
        .eq("spotter_kind", "inactive")
        .order("created_at", { ascending: false })
        .limit(500);
      const lastAnswer = new Map<string, string>();
      for (const f of (feedback ?? []) as any[]) if (!lastAnswer.has(f.dismissal_key)) lastAnswer.set(f.dismissal_key, f.created_at);

      const [profiles, credits, ledger, messages, lastLogs, lastBookings, lastReplies] = await Promise.all([
        supabase.from("profiles").select("id, full_name").in("id", quietIds),
        supabase.from("session_credits").select("athlete_id, group_id, balance").in("athlete_id", quietIds).in("group_id", quietGroupIds),
        supabase.from("session_credit_ledger").select("athlete_id, group_id, amount").in("athlete_id", quietIds).in("group_id", quietGroupIds).gt("amount", 0),
        (async () => {
          const read = (columns: string) => supabase.from("direct_messages").select(columns).or(`sender_id.eq.${user.id},recipient_id.eq.${user.id}`).in("group_id", quietGroupIds).limit(5000);
          const first = await read("group_id, sender_id, recipient_id, created_at, auto_reply");
          // Before the 0315 database update there is no auto_reply column and that read errors: read again with the old column list.
          return first.error ? await read("group_id, sender_id, recipient_id, created_at") : first;
        })(),
        Promise.all(quietIds.map(async (id) => [id, ((await supabase.from("workout_logs").select("created_at").eq("athlete_id", id).order("created_at", { ascending: false }).limit(1)).data ?? [])[0]?.created_at as string | undefined] as const)),
        Promise.all(quietIds.map(async (id) => [id, ((await supabase.from("bookings").select("start_at").eq("athlete_id", id).lte("start_at", now.toISOString()).order("start_at", { ascending: false }).limit(1)).data ?? [])[0]?.start_at as string | undefined] as const)),
        Promise.all(quietIds.map(async (id) => [id, ((await supabase.from("direct_messages").select("created_at").eq("sender_id", id).eq("recipient_id", user.id).order("created_at", { ascending: false }).limit(1)).data ?? [])[0]?.created_at as string | undefined] as const)),
      ]);

      const nameById = new Map(((profiles.data ?? []) as any[]).map((p) => [p.id as string, (p.full_name as string) ?? "Client"]));
      const balanceByKey = new Map(((credits.data ?? []) as any[]).map((c) => [`${c.athlete_id}:${c.group_id}`, c.balance as number]));
      const grantedByKey = new Map<string, number>();
      for (const l of (ledger.data ?? []) as any[]) {
        const k = `${l.athlete_id}:${l.group_id}`;
        grantedByKey.set(k, (grantedByKey.get(k) ?? 0) + (l.amount as number));
      }
      const lastActivity = new Map<string, number>();
      for (const list of [lastLogs, lastBookings, lastReplies]) {
        for (const [id, at] of list) if (at) lastActivity.set(id, Math.max(lastActivity.get(id) ?? 0, new Date(at).getTime()));
      }

      const out: Item[] = [];
      for (const m of quiet) {
        const key = `${m.profile_id}:${m.group_id}`;
        if (isSnoozedFor(lastAnswer.get(inactiveDismissalKey(m.profile_id, m.group_id)), NOT_NOW_SNOOZE_DAYS, now)) continue;
        if (isSnoozedFor(lastAnswer.get(inactiveKeepActiveKey(m.profile_id, m.group_id)), KEEP_ACTIVE_SNOOZE_DAYS, now)) continue;
        const thread = inactiveThread((messages.data ?? []) as any[], m.profile_id, m.group_id);
        const { unanswered, daysSinceLastCoachMessage } = unansweredFromMessages(thread, now);
        const last = lastActivity.get(m.profile_id);
        const s = inactiveSuggestion({
          name: nameById.get(m.profile_id) ?? "Client",
          daysSinceActivity: last ? Math.floor((now.getTime() - last) / DAY) : null,
          daysSinceAdded: m.joined_at ? Math.floor((now.getTime() - new Date(m.joined_at).getTime()) / DAY) : null,
          balance: balanceByKey.get(key) ?? 0,
          sessionsEverGranted: grantedByKey.get(key) ?? 0,
          coachMessagesUnanswered: unanswered,
          daysSinceLastCoachMessage,
        });
        if (s) out.push({ athleteId: m.profile_id, groupId: m.group_id, name: nameById.get(m.profile_id) ?? "Client", reasons: s.reasons });
      }
      if (!cancelled) setItems(out.slice(0, 5));
    }
    load().catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey]);

  const remove = (i: Item) => setItems((p) => p.filter((x) => !(x.athleteId === i.athleteId && x.groupId === i.groupId)));

  async function answer(i: Item, kind: "not-now" | "keep") {
    if (!coachId) return;
    const supabase = createBrowserClient();
    await supabase.from("spotter_recommendation_feedback").insert({
      coach_id: coachId,
      spotter_kind: "inactive",
      dismissal_key: kind === "keep" ? inactiveKeepActiveKey(i.athleteId, i.groupId) : inactiveDismissalKey(i.athleteId, i.groupId),
      option_summary: `${i.name}: ${i.reasons.join(", ")}`,
      action: "denied",
    });
    remove(i);
  }

  async function setAside(i: Item) {
    const key = `${i.athleteId}:${i.groupId}`;
    setBusyKey(key);
    setError(null);
    const supabase = createBrowserClient();
    const { error: rpcError } = await supabase.rpc("set_client_inactive", { p_athlete_id: i.athleteId, p_group_id: i.groupId, p_inactive: true, p_note: null });
    setBusyKey(null);
    if (rpcError) {
      setError("That didn't save. Nothing was changed. Try again.");
      return;
    }
    remove(i);
  }

  if (items.length === 0) return null;
  const btn = "h-11 px-4 border font-body text-sm disabled:opacity-50";

  return (
    <section className="border border-steel/30 bg-surface/40 rounded-token-lg p-4 mb-6" aria-label="Clients who may have moved on">
      <h2 className="font-body text-xs text-steel uppercase tracking-wide font-bold">Door open, or set aside?</h2>
      <ul className="divide-y divide-steel/15 mt-1">
        {items.map((i) => {
          const key = `${i.athleteId}:${i.groupId}`;
          const draft = buildDoorOpenDraft(i.name.split(" ")[0] ?? "");
          return (
            <li key={key} className="py-3">
              <p className="font-body text-sm text-chalk">Probably inactive: {i.name}.</p>
              <p className="font-body text-xs text-steel mt-0.5">
                {i.reasons.join(", ")}. Setting someone aside hides them from your dashboard and alerts. Nothing is deleted, and a workout, session or message from them brings them back.
              </p>
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <Link href={`/groups/${i.groupId}/messages/${i.athleteId}?draft=${encodeURIComponent(draft)}`} className={`${btn} border-rust text-rust inline-flex items-center`}>
                  Send a door-open note
                </Link>
                <button type="button" disabled={busyKey === key} onClick={() => setAside(i)} className={`${btn} border-steel/30 text-chalk`}>
                  Set aside as inactive
                </button>
                <button type="button" onClick={() => answer(i, "keep")} className={`${btn} border-steel/30 text-steel`}>
                  Keep active
                </button>
                <button type="button" onClick={() => answer(i, "not-now")} className={`${btn} border-steel/30 text-steel`}>
                  Not now
                </button>
              </div>
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
