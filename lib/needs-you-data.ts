// Gathers the things that need a coach for the "Needs you" strip on Home. Read-only: it uses what Home already works out (today's sessions, clients out of sessions, low readiness,
// who is quiet, threads waiting for a reply) and adds a few small reads for the rest (requests, unread messages, late changes, sessions about to expire, injuries). Every extra read
// is soft: one that fails just leaves its kind out, never the strip and never the page. The ranking and the sentences are lib/needs-you.ts.
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatInTimezone } from "@/lib/format-in-timezone";
import { pageAll } from "@/lib/page-all";
import { DEFAULT_HEADS_UP_DAYS, expiringSoon, expiryDismissalKey, isSnoozed } from "@/lib/expiry-checkin";
import { BUTTON, sentences, type NeedsYouItem } from "@/lib/needs-you";
import type { QuietTier } from "@/lib/quiet-client-tier";

export interface NeedsYouHomeInputs {
  coachId: string;
  timezone: string;
  now: Date;
  // The groups this coach coaches (every kind).
  groupIds: string[];
  todayBookings: { id: string; athleteId: string; groupId: string; athleteName: string; startAt: string }[];
  needsPayment: { athleteId: string; groupId: string; name: string; balance: number }[];
  lowReadiness: { athleteId: string; groupId: string; name: string }[];
  quietTierByAthlete: Map<string, QuietTier>;
  needsReplyThreads: { postId: string; groupId: string; groupName: string; channel: string; authorName: string }[];
  // The one client the "Right now" box names. The strip puts that same client first among its own kind, so the two never name different people for the same reason.
  heroFlag?: { kind: string; athleteId: string; athleteName: string; groupId: string; direction?: string; exerciseName?: string; missedCount?: number } | null;
}

// A session that starts within this long is "starting soon".
export const SESSION_SOON_MINUTES = 120;

const clientPath = (groupId: string, athleteId: string) => `/groups/${groupId}/athletes/${athleteId}`;

// An injury flag older than this is a standing condition, not news: the coach has it on the client's page and in the panels below. The strip is for what changed.
export const INJURY_RECENT_DAYS = 14;

export interface NeedsYouLoad {
  items: NeedsYouItem[];
  // Reads that could not be made (so "nothing" may not be the whole truth).
  failed: string[];
}

export async function loadNeedsYouItems(supabase: SupabaseClient, input: NeedsYouHomeInputs): Promise<NeedsYouLoad> {
  const { coachId, now, groupIds } = input;
  const items: NeedsYouItem[] = [];
  const failed: string[] = [];
  if (groupIds.length === 0) return { items, failed };

  // A read that fails (an error answer, which the database client returns instead of throwing, or a thrown error) is remembered by name and counts as no rows for that kind only.
  const soft = async <T,>(label: string, run: () => Promise<{ data: T | null; error: unknown }>, fallback: T): Promise<T> => {
    try {
      const { data, error } = await run();
      if (error) {
        failed.push(label);
        console.error(`[needs-you] ${label} failed:`, (error as { message?: string })?.message ?? error);
        return fallback;
      }
      return data ?? fallback;
    } catch (e) {
      failed.push(label);
      console.error(`[needs-you] ${label} failed:`, e instanceof Error ? e.message : e);
      return fallback;
    }
  };
  // A read that can pass 1000 rows is read a page at a time; a failed or cut-short read counts as failed.
  const paged = async <T,>(label: string, make: (from: number, to: number) => PromiseLike<{ data: any[] | null; error: unknown }>): Promise<T[]> => {
    try {
      const r = await pageAll(make);
      if (r.failed || r.truncated) failed.push(label);
      return r.rows as T[];
    } catch (e) {
      failed.push(label);
      console.error(`[needs-you] ${label} failed:`, e instanceof Error ? e.message : e);
      return [];
    }
  };
  const nowMs = now.getTime();

  // ---- what Home already knows -------------------------------------------------------------------------------------------------
  for (const b of input.todayBookings) {
    const startMs = new Date(b.startAt).getTime();
    if (b.athleteId === coachId || startMs < nowMs || startMs - nowMs > SESSION_SOON_MINUTES * 60_000) continue;
    items.push({
      id: `session:${b.id}`,
      kind: "session_soon",
      name: b.athleteName,
      sentence: sentences.sessionSoon(formatInTimezone(b.startAt, input.timezone, "time")),
      button: BUTTON.open,
      href: clientPath(b.groupId, b.athleteId),
      order: startMs,
    });
  }
  for (const p of input.needsPayment) {
    items.push({ id: `payment:${p.athleteId}:${p.groupId}`, kind: "payment", name: p.name, sentence: sentences.payment(p.balance), button: BUTTON.open, href: clientPath(p.groupId, p.athleteId), order: p.balance });
  }
  for (const r of input.lowReadiness) {
    items.push({ id: `readiness:${r.athleteId}:${r.groupId}`, kind: "low_readiness", name: r.name, sentence: sentences.lowReadiness(), button: BUTTON.open, href: clientPath(r.groupId, r.athleteId), order: 0 });
  }
  for (const t of input.needsReplyThreads) {
    items.push({
      id: `reply:${t.postId}`,
      kind: "group_reply",
      name: t.authorName,
      sentence: sentences.groupReply(t.groupName),
      button: BUTTON.reply,
      href: `/groups/${t.groupId}/feed?channel=${t.channel}&highlight=${t.postId}`,
      order: 0,
    });
  }

  // ---- the small extra reads, all in parallel and all soft ------------------------------------------------------------------------
  const [scheduleRequests, bookingRequests, unreadMessages, lateChanges, expiring, injured, athleteRows] = await Promise.all([
    soft(
      "schedule requests",
      () => supabase.from("schedule_requests").select("id, athlete_id, group_id, kind, created_at").eq("coach_id", coachId).in("status", ["pending", "applying"]).order("created_at", { ascending: true }).limit(50) as never,
      [] as { id: string; athlete_id: string; group_id: string; kind: string; created_at: string }[]
    ),
    soft(
      "booking requests",
      () => supabase.from("booking_requests").select("id, athlete_id, group_id, created_at").eq("coach_id", coachId).eq("status", "pending").order("created_at", { ascending: true }).limit(50) as never,
      [] as { id: string; athlete_id: string; group_id: string; created_at: string }[]
    ),
    paged<{ id: string; sender_id: string; group_id: string; created_at: string }>("unread messages", (from, to) =>
      supabase.from("direct_messages").select("id, sender_id, group_id, created_at").eq("recipient_id", coachId).is("read_at", null).order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, to)
    ),
    soft(
      "late changes",
      () => supabase.from("bookings").select("id, athlete_id, group_id, start_at").eq("coach_id", coachId).eq("late_charge_state", "flagged").order("start_at", { ascending: true }).limit(50) as never,
      [] as { id: string; athlete_id: string; group_id: string; start_at: string }[]
    ),
    (async () => {
      try {
        const { data: policy, error: policyError } = await supabase.from("coach_booking_policies").select("credit_expiry_days, expiry_heads_up_days").eq("coach_id", coachId).maybeSingle();
        if (policyError) throw new Error(policyError.message);
        const expiryDays = (policy?.credit_expiry_days as number | undefined) ?? 0;
        if (expiryDays <= 0) return [];
        const headsUp = (policy?.expiry_heads_up_days as number | undefined) ?? DEFAULT_HEADS_UP_DAYS;
        const credits = await paged<{ athlete_id: string; group_id: string; balance: number; last_granted_at: string | null; expiry_hold_until: string | null }>("expiring sessions", (from, to) =>
          supabase.from("session_credits").select("athlete_id, group_id, balance, last_granted_at, expiry_hold_until").in("group_id", groupIds).order("athlete_id", { ascending: true }).order("group_id", { ascending: true }).range(from, to)
        );
        const soon = expiringSoon(
          credits.map((r) => ({
            athleteId: r.athlete_id,
            groupId: r.group_id,
            balance: r.balance,
            lastGrantedAt: r.last_granted_at,
            holdUntil: r.expiry_hold_until,
          })),
          expiryDays,
          headsUp,
          now
        );
        if (soon.length === 0) return [];
        // "Not now" on the check-in card stays away for two weeks: it stays away here too.
        const { data: feedback, error: feedbackError } = await supabase
          .from("spotter_recommendation_feedback")
          .select("dismissal_key, created_at")
          .eq("coach_id", coachId)
          .eq("spotter_kind", "expiry")
          .order("created_at", { ascending: false })
          .limit(200);
        if (feedbackError) throw new Error(feedbackError.message);
        const lastDenied = new Map<string, string>();
        for (const f of (feedback ?? []) as { dismissal_key: string; created_at: string }[]) if (!lastDenied.has(f.dismissal_key)) lastDenied.set(f.dismissal_key, f.created_at);
        return soon.filter((u) => !isSnoozed(lastDenied.get(expiryDismissalKey(u.athleteId, u.groupId, "soon")) ?? null, now));
      } catch (e) {
        failed.push("expiring sessions");
        console.error("[needs-you] expiring sessions failed:", e instanceof Error ? e.message : e);
        return [];
      }
    })(),
    soft(
      "injuries",
      () => supabase.from("athlete_injury_status").select("athlete_id, marked_at").eq("is_injured", true).gte("marked_at", new Date(nowMs - INJURY_RECENT_DAYS * 86_400_000).toISOString()).limit(200) as never,
      [] as { athlete_id: string; marked_at: string }[]
    ).then((rows) => rows.map((r) => r.athlete_id)),
    paged<{ group_id: string; profile_id: string }>("roster", (from, to) =>
      supabase.from("group_memberships").select("group_id, profile_id").in("group_id", groupIds).eq("role", "athlete").order("group_id", { ascending: true }).order("profile_id", { ascending: true }).range(from, to)
    ),
  ]);

  // The first group each client is in (for where a button goes), and every name needed, read once.
  const groupOf = new Map<string, string>();
  for (const r of athleteRows) if (!groupOf.has(r.profile_id)) groupOf.set(r.profile_id, r.group_id);
  const quiet = [...input.quietTierByAthlete.entries()].filter(([, tier]) => tier === "mild" || tier === "strong").map(([id, tier]) => ({ id, tier }));
  const injuredHere = injured.filter((id) => groupOf.has(id));
  const needNames = new Set<string>([
    ...scheduleRequests.map((r) => r.athlete_id),
    ...bookingRequests.map((r) => r.athlete_id),
    ...unreadMessages.map((m) => m.sender_id),
    ...lateChanges.map((l) => l.athlete_id),
    ...expiring.map((e) => e.athleteId),
    ...injuredHere,
    ...quiet.map((q) => q.id),
  ]);
  const nameById = new Map<string, string>();
  // Whether each client has signed in (their account is claimed). A client who has not is never "gone quiet": they have not started.
  const claimedById = new Map<string, boolean>();
  if (needNames.size > 0) {
    // A name that cannot be read just says "A client": the item itself is still shown.
    const names = await soft("names", () => supabase.from("profiles").select("id, full_name, claimed_at").in("id", [...needNames]) as never, [] as { id: string; full_name: string | null; claimed_at: string | null }[]);
    for (const n of names) {
      nameById.set(n.id, n.full_name?.trim() || "A client");
      claimedById.set(n.id, !!n.claimed_at);
    }
  }
  const nameOf = (id: string) => nameById.get(id) ?? "A client";

  for (const r of scheduleRequests) {
    items.push({ id: `schedule:${r.id}`, kind: "schedule_request", name: nameOf(r.athlete_id), sentence: sentences.scheduleRequest(r.kind), button: BUTTON.review, href: "/dashboard#schedule-requests", order: new Date(r.created_at).getTime() });
  }
  for (const r of bookingRequests) {
    items.push({ id: `request:${r.id}`, kind: "booking_request", name: nameOf(r.athlete_id), sentence: sentences.bookingRequest(), button: BUTTON.decide, href: "/dashboard#late-changes", order: new Date(r.created_at).getTime() });
  }
  // One entry per client who has unread messages: how many, and the oldest first.
  const byClient = new Map<string, { groupId: string; count: number; oldest: number }>();
  for (const m of unreadMessages) {
    const prev = byClient.get(m.sender_id);
    byClient.set(m.sender_id, { groupId: prev?.groupId ?? m.group_id, count: (prev?.count ?? 0) + 1, oldest: Math.min(prev?.oldest ?? Infinity, new Date(m.created_at).getTime()) });
  }
  for (const [senderId, v] of byClient) {
    items.push({ id: `message:${senderId}`, kind: "client_message", name: nameOf(senderId), sentence: sentences.clientMessage(v.count), button: BUTTON.reply, href: `/groups/${v.groupId}/messages/${senderId}`, order: v.oldest });
  }
  for (const l of lateChanges) {
    items.push({ id: `late:${l.id}`, kind: "late_change", name: nameOf(l.athlete_id), sentence: sentences.lateChange(), button: BUTTON.decide, href: "/dashboard#late-changes", order: new Date(l.start_at).getTime() });
  }
  for (const e of expiring) {
    items.push({ id: `expiring:${e.athleteId}:${e.groupId}`, kind: "expiring_credits", name: nameOf(e.athleteId), sentence: sentences.expiringCredits(e.daysLeft), button: BUTTON.open, href: "/dashboard#expiring", order: e.expiresOn.getTime() });
  }
  for (const id of injuredHere) {
    items.push({ id: `injury:${id}`, kind: "injury", name: nameOf(id), sentence: sentences.injury(), button: BUTTON.open, href: clientPath(groupOf.get(id)!, id), order: 0 });
  }
  for (const q of quiet) {
    const g = groupOf.get(q.id);
    if (!g) continue;
    const claimed = claimedById.get(q.id);
    // Not known (their profile could not be read): say nothing rather than the wrong thing.
    if (claimed === undefined) continue;
    if (!claimed) {
      items.push({ id: `notsignedin:${q.id}`, kind: "not_signed_in", name: nameOf(q.id), sentence: sentences.notSignedIn(), button: BUTTON.sendLink, href: clientPath(g, q.id), order: 0 });
      continue;
    }
    items.push({
      id: `quiet:${q.id}`,
      kind: q.tier === "strong" ? "quiet_strong" : "quiet_mild",
      name: nameOf(q.id),
      sentence: q.tier === "strong" ? sentences.quietStrong() : sentences.quietMild(),
      button: BUTTON.checkIn,
      href: `/groups/${g}/messages/${q.id}`,
      order: 0,
    });
  }
  // The client the "Right now" box names goes first among its own kind (the box's tie-break is the order it first saw them in; this follows it).
  const hero = input.heroFlag;
  if (hero) {
    const heroItem = (kind: NeedsYouItem["kind"], sentence: string, id: string, button: string, href: string): NeedsYouItem => ({ id, kind, name: hero.athleteName, sentence, button, href, order: -1 });
    if (hero.kind === "matched_load_trend" && hero.direction === "fatigue") {
      items.push(heroItem("load_fatigue", sentences.loadFatigue(hero.exerciseName ?? "a lift"), `fatigue:${hero.athleteId}`, BUTTON.open, clientPath(hero.groupId, hero.athleteId)));
    } else if (hero.kind === "missed_habits") {
      items.push(heroItem("missed_habits", sentences.missedHabits(hero.missedCount ?? 1), `habits:${hero.athleteId}`, BUTTON.open, clientPath(hero.groupId, hero.athleteId)));
    } else {
      for (const it of items) if (it.id === `readiness:${hero.athleteId}:${hero.groupId}` || it.id === `quiet:${hero.athleteId}`) it.order = -1;
    }
  }
  return { items, failed };
}
