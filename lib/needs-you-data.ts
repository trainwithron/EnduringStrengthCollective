// Gathers the things that need a coach for the "Needs you" strip on Home. Read-only: it uses what Home already works out (today's sessions, clients out of sessions, low readiness,
// who is quiet, threads waiting for a reply) and adds a few small reads for the rest (requests, unread messages, late changes, sessions about to expire, injuries). Every extra read
// is soft: one that fails just leaves its kind out, never the strip and never the page. The ranking and the sentences are lib/needs-you.ts.
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatInTimezone } from "@/lib/format-in-timezone";
import { answerByText, requestDeadline } from "@/lib/request-deadline";
import type { PageQuery } from "@/lib/page-all";
import { readByIds, readRowsByIds } from "@/lib/read-by-ids";
import { DEFAULT_HEADS_UP_DAYS, buildCheckInDraft, expiringSoon, expiryDismissalKey, isSnoozed } from "@/lib/expiry-checkin";
import { BUTTON, sentences, type NeedsYouItem } from "@/lib/needs-you";
import type { QuietTier } from "@/lib/quiet-client-tier";
import { addSessionsHref } from "@/lib/add-sessions-link";
import { requestHref } from "@/lib/requests-center";
import { COACH_CHECKINS_PATH } from "@/lib/weekly-checkin";
import { GOAL_SHEET_ANCHOR, goalReviewCutoffIso, goalReviewDue } from "@/lib/goal-review";
import { SIGN_IN_OPTIONS_ANCHOR } from "@/lib/get-started-checklist";
import { getQuietClientNudgeTemplates } from "@/lib/quiet-client-nudge-templates";
import { loadQuietInChat, quietChatSentence } from "@/lib/quiet-chat";

// A weekly check-in older than this is not news for Home's strip (the Check-ins page keeps the same window).
const CHECKIN_REVIEW_DAYS = 56;

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
  // The signed-in coach's name, so "Message {name}" can send as them from the card (R3). Without it the card links to the conversation instead.
  coachName?: string;
  heroFlag?: { kind: string; athleteId: string; athleteName: string; groupId: string; direction?: string; exerciseName?: string; missedCount?: number } | null;
}

// A session that starts within this long is "starting soon".
export const SESSION_SOON_MINUTES = 120;

const clientPath = (groupId: string, athleteId: string) => `/groups/${groupId}/athletes/${athleteId}`;
// A message thread with a drafted note in its box (the coach edits it before sending; the thread page keeps the draft when it opens the conversation on a computer).
const threadWithDraft = (groupId: string, athleteId: string, draft: string) => `/groups/${groupId}/messages/${athleteId}?draft=${encodeURIComponent(draft)}`;
// A first name for a button or a draft; "" when the name could not be read.
const firstOf = (name: string) => (name === "A client" ? "" : name.trim().split(/\s+/)[0] ?? "");

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
  // A read over the coach's groups that can pass 1000 rows: the ids go in groups of 100 and each group is read a page at a time (1,500 clients is 1,500 groups, past the URL limit of one request, and a
  // request returns at most 1,000 rows). A failed or cut-short read counts as failed.
  const pagedIn = async <T,>(label: string, make: (groupChunk: string[]) => PageQuery): Promise<T[]> => {
    try {
      const r = await readByIds(groupIds, make);
      if (r.failed || r.truncated) failed.push(label);
      return r.rows as T[];
    } catch (e) {
      failed.push(label);
      console.error(`[needs-you] ${label} failed:`, e instanceof Error ? e.message : e);
      return [];
    }
  };
  // The first N rows (by the caller's order) over the coach's groups: the first N of each group of ids, merged and cut to N.
  const firstIn = async <T,>(label: string, n: number, byOrder: (a: T, b: T) => number, make: (groupChunk: string[]) => PageQuery): Promise<T[]> => {
    try {
      const r = await readByIds(groupIds, make, { pageSize: n, maxPages: 1 });
      if (r.failed) failed.push(label);
      return (r.rows as T[]).sort(byOrder).slice(0, n);
    } catch (e) {
      failed.push(label);
      console.error(`[needs-you] ${label} failed:`, e instanceof Error ? e.message : e);
      return [];
    }
  };
  // A read of a table or column that step 215 adds (the first 50 rows): one that fails is a failure only when the table and column are there (a cheap probe tells).
  const stepRead = async <T,>(label: string, table: string, column: string, make: (groupChunk: string[]) => PageQuery): Promise<T[]> => {
    try {
      const r = await readByIds(groupIds, make, { pageSize: 50, maxPages: 1 });
      if (!r.failed) return (r.rows as T[]).slice(0, 50);
      const probe = await supabase.from(table).select(column).limit(1);
      const code = (probe.error as { code?: string } | null)?.code ?? "";
      if (!["42P01", "PGRST205", "42703", "PGRST204"].includes(code)) failed.push(label);
      return [];
    } catch (e) {
      failed.push(label);
      console.error(`[needs-you] ${label} failed:`, e instanceof Error ? e.message : e);
      return [];
    }
  };
  const byCreatedAt = (a: { created_at: string }, b: { created_at: string }) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""));
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
    // Out of sessions: the button goes straight to where sessions are added (FIX 3), the name still opens the profile.
    items.push({ id: `payment:${p.athleteId}:${p.groupId}`, kind: "payment", name: p.name, sentence: sentences.payment(p.balance), button: BUTTON.addSessions, href: addSessionsHref(p.groupId, p.athleteId), profileHref: clientPath(p.groupId, p.athleteId), order: p.balance });
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
  // Weekly check-ins waiting for review and goals set 90 days ago (step 215; Ron, Nov 20). A database without that step has neither: read as nothing, not as a failure.
  const stepReads = Promise.all([
    stepRead<{ id: string; athlete_id: string; group_id: string; submitted_at: string }>("check-ins", "weekly_checkins", "id", (g) => (from, to) =>
      supabase.from("weekly_checkins").select("id, athlete_id, group_id, submitted_at").in("group_id", g).is("reviewed_at", null).gte("submitted_at", new Date(nowMs - CHECKIN_REVIEW_DAYS * 86_400_000).toISOString()).order("submitted_at", { ascending: true }).order("id", { ascending: true }).range(from, to)
    ),
    stepRead<{ athlete_id: string; group_id: string; filled_at: string | null; reviewed_at: string | null }>("goal reviews", "client_goal_sheets", "reviewed_at", (g) => (from, to) =>
      supabase.from("client_goal_sheets").select("athlete_id, group_id, filled_at, reviewed_at").in("group_id", g).lte("filled_at", goalReviewCutoffIso(now)).order("athlete_id", { ascending: true }).order("group_id", { ascending: true }).range(from, to)
    ).then((rows) => rows.filter((r) => goalReviewDue(r, now))),
  ]);
  const quietChatRead = loadQuietInChat(supabase, coachId, [...groupIds].sort().join(","), now.toISOString());
  const [scheduleRequests, bookingRequests, unreadMessages, lateChanges, expiring, injured, athleteRows] = await Promise.all([
    firstIn<{ id: string; athlete_id: string; group_id: string; kind: string; created_at: string }>("schedule requests", 50, byCreatedAt, (g) => (from, to) =>
      supabase.from("schedule_requests").select("id, athlete_id, group_id, kind, created_at").eq("coach_id", coachId).in("group_id", g).in("status", ["pending", "applying"]).order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, to)
    ),
    firstIn<{ id: string; athlete_id: string; group_id: string; created_at: string; kind: string | null; from_start_at: string | null; new_start_at: string }>("booking requests", 50, byCreatedAt, (g) => (from, to) =>
      supabase.from("booking_requests").select("id, athlete_id, group_id, created_at, kind, from_start_at, new_start_at").eq("coach_id", coachId).in("group_id", g).eq("status", "pending").order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, to)
    ),
    pagedIn<{ id: string; sender_id: string; group_id: string; created_at: string }>("unread messages", (g) => (from, to) =>
      supabase.from("direct_messages").select("id, sender_id, group_id, created_at").eq("recipient_id", coachId).in("group_id", g).is("read_at", null).order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, to)
    ),
    firstIn<{ id: string; athlete_id: string; group_id: string; start_at: string }>("late changes", 50, (a, b) => String(a.start_at ?? "").localeCompare(String(b.start_at ?? "")), (g) => (from, to) =>
      supabase.from("bookings").select("id, athlete_id, group_id, start_at").eq("coach_id", coachId).in("group_id", g).eq("late_charge_state", "flagged").order("start_at", { ascending: true }).order("id", { ascending: true }).range(from, to)
    ),
    (async () => {
      try {
        const { data: policy, error: policyError } = await supabase.from("coach_booking_policies").select("credit_expiry_days, expiry_heads_up_days").eq("coach_id", coachId).maybeSingle();
        if (policyError) throw new Error(policyError.message);
        const expiryDays = (policy?.credit_expiry_days as number | undefined) ?? 0;
        if (expiryDays <= 0) return [];
        const headsUp = (policy?.expiry_heads_up_days as number | undefined) ?? DEFAULT_HEADS_UP_DAYS;
        const credits = await pagedIn<{ athlete_id: string; group_id: string; balance: number; last_granted_at: string | null; expiry_hold_until: string | null }>("expiring sessions", (g) => (from, to) =>
          supabase.from("session_credits").select("athlete_id, group_id, balance, last_granted_at, expiry_hold_until").in("group_id", g).order("athlete_id", { ascending: true }).order("group_id", { ascending: true }).range(from, to)
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
    firstIn<{ athlete_id: string; marked_at: string }>("injuries", 200, (a, b) => String(b.marked_at ?? "").localeCompare(String(a.marked_at ?? "")), (g) => (from, to) =>
      supabase.from("athlete_injury_status").select("athlete_id, marked_at").in("group_id", g).eq("is_injured", true).gte("marked_at", new Date(nowMs - INJURY_RECENT_DAYS * 86_400_000).toISOString()).order("marked_at", { ascending: false }).order("athlete_id", { ascending: true }).range(from, to)
    ).then((rows) => rows.map((r) => r.athlete_id)),
    pagedIn<{ group_id: string; profile_id: string }>("roster", (g) => (from, to) =>
      supabase.from("group_memberships").select("group_id, profile_id").in("group_id", g).eq("role", "athlete").order("group_id", { ascending: true }).order("profile_id", { ascending: true }).range(from, to)
    ),
  ]);

  const [checkins, goalReviews] = await stepReads;
  // Quiet in chat (R3): read with the panel below Home (one read for both), in parallel with the rest above.
  const chat = await quietChatRead;
  if (chat.failed) failed.push("quiet in chat");
  const checkinsHere = checkins.filter((c) => c.athlete_id !== coachId);
  // only someone who is still a client in that space (a sheet stays behind when a client leaves)
  const seats = new Set(athleteRows.map((r) => `${r.group_id}:${r.profile_id}`));
  const goalsHere = goalReviews.filter((g) => g.athlete_id !== coachId && seats.has(`${g.group_id}:${g.athlete_id}`));

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
    ...checkinsHere.map((c) => c.athlete_id),
    ...goalsHere.map((g) => g.athlete_id),
  ]);
  const nameById = new Map<string, string>();
  // Whether each client has signed in (their account is claimed). A client who has not is never "gone quiet": they have not started.
  const claimedById = new Map<string, boolean>();
  if (needNames.size > 0) {
    // A name that cannot be read just says "A client": the item itself is still shown.
    const names = await soft("names", () => readRowsByIds([...needNames], (g) => (from, to) => supabase.from("profiles").select("id, full_name, claimed_at").in("id", g).order("id").range(from, to)) as never, [] as { id: string; full_name: string | null; claimed_at: string | null }[]);
    for (const n of names) {
      nameById.set(n.id, n.full_name?.trim() || "A client");
      claimedById.set(n.id, !!n.claimed_at);
    }
  }
  const nameOf = (id: string) => nameById.get(id) ?? "A client";

  for (const r of scheduleRequests) {
    items.push({ id: `schedule:${r.id}`, kind: "schedule_request", name: nameOf(r.athlete_id), sentence: sentences.scheduleRequest(r.kind), button: BUTTON.review, href: requestHref("schedule", r.id), profileHref: clientPath(r.group_id, r.athlete_id), order: new Date(r.created_at).getTime() });
  }
  for (const r of bookingRequests) {
    items.push({ id: `request:${r.id}`, kind: "booking_request", name: nameOf(r.athlete_id), sentence: sentences.bookingRequest(r.kind, answerByText(requestDeadline(r), input.timezone)), button: BUTTON.decide, href: requestHref("booking", r.id), profileHref: clientPath(r.group_id, r.athlete_id), order: new Date(r.created_at).getTime() });
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
    items.push({ id: `late:${l.id}`, kind: "late_change", name: nameOf(l.athlete_id), sentence: sentences.lateChange(), button: BUTTON.decide, href: requestHref("late", l.id), profileHref: clientPath(l.group_id, l.athlete_id), order: new Date(l.start_at).getTime() });
  }
  for (const e of expiring) {
    // The same drafted check-in as the expiry panel's "Message them" (audit, Nov 21: "Open" only jumped down Home).
    const first = firstOf(nameOf(e.athleteId));
    items.push({ id: `expiring:${e.athleteId}:${e.groupId}`, kind: "expiring_credits", name: nameOf(e.athleteId), sentence: sentences.expiringCredits(e.daysLeft), button: first ? `Message ${first}` : BUTTON.message, href: threadWithDraft(e.groupId, e.athleteId, buildCheckInDraft({ firstName: first, balance: e.balance, daysLeft: e.daysLeft })), profileHref: clientPath(e.groupId, e.athleteId), order: e.expiresOn.getTime() });
  }
  for (const c of checkinsHere) {
    items.push({ id: `checkin:${c.id}`, kind: "checkin_review", name: nameOf(c.athlete_id), sentence: sentences.checkinReview(), button: BUTTON.review, href: COACH_CHECKINS_PATH, profileHref: clientPath(c.group_id, c.athlete_id), order: new Date(c.submitted_at).getTime() });
  }
  for (const g of goalsHere) {
    items.push({ id: `goal:${g.athlete_id}:${g.group_id}`, kind: "goal_review", name: nameOf(g.athlete_id), sentence: sentences.goalReview(), button: BUTTON.open, href: `${clientPath(g.group_id, g.athlete_id)}#${GOAL_SHEET_ANCHOR}`, profileHref: clientPath(g.group_id, g.athlete_id), order: new Date(g.filled_at ?? 0).getTime() });
  }
  // someone with a message the coach hasn't read is waiting on the coach, not quiet
  for (const q of chat.quiet) {
    // a name that could not be read: say nothing rather than "Message A"
    const name = chat.names.get(q.athleteId);
    if (!name || q.athleteId === coachId || byClient.has(q.athleteId)) continue;
    items.push({
      id: `quietchat:${q.athleteId}`,
      kind: "quiet_chat",
      name,
      sentence: quietChatSentence(q.days),
      button: `Message ${name.split(" ")[0]}`,
      href: `/groups/${q.groupId}/messages/${q.athleteId}`,
      nudge: { athleteId: q.athleteId, groupId: q.groupId, firstName: name.split(" ")[0] },
      // the longest quiet first
      order: -q.days,
    });
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
      // "Send link" emails it from the card; the link (when the email cannot go) is the profile's sign-in options (audit, Nov 21).
      items.push({ id: `notsignedin:${q.id}`, kind: "not_signed_in", name: nameOf(q.id), sentence: sentences.notSignedIn(), button: BUTTON.sendLink, href: `${clientPath(g, q.id)}?tab=settings#${SIGN_IN_OPTIONS_ANCHOR}`, profileHref: clientPath(g, q.id), claimLink: { athleteId: q.id, groupId: g }, order: 0 });
      continue;
    }
    items.push({
      id: `quiet:${q.id}`,
      kind: q.tier === "strong" ? "quiet_strong" : "quiet_mild",
      name: nameOf(q.id),
      sentence: q.tier === "strong" ? sentences.quietStrong() : sentences.quietMild(),
      button: BUTTON.checkIn,
      // with a check-in drafted in the box, like the panels below (audit, Nov 21)
      href: threadWithDraft(g, q.id, getQuietClientNudgeTemplates(firstOf(nameOf(q.id)) || "there")[1].text),
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
  // An item whose button already goes to the client's page or to their messages gets the client's page as its profile link.
  for (const it of items) {
    if (it.profileHref) continue;
    const m = /^\/groups\/([^/]+)\/(?:athletes|messages)\/([^/?]+)/.exec(it.href);
    if (m) it.profileHref = clientPath(m[1], m[2]);
  }
  return { items, failed };
}
