import type { SupabaseClient } from "@supabase/supabase-js";
import { signToken, verifyToken } from "./signed-token";
import {
  describeAction,
  matchAction,
  refusedSetting,
  validateAction,
  type ActionId,
  type ActionRequest,
  type BookingMode,
  type TermParams,
} from "./assistant-actions";
import type { TermOverride, TerminologyOverrides } from "./terminology";
import { type PastSessionCardFacts } from "./assistant-actions";
import { matchClientByName, resolvePastWindow, timeRangeLabel, type NamedClient } from "./past-session-request";
import { dateKeyInZone, getGroupCoachTimezone, nowInZone, zonedTimeToUtc } from "./timezone";

// The server half of Ask Spot's action layer (docs/ASK_SPOT_ACTIONS_DESIGN.md). Three steps, and nothing happens before the second:
//   propose  turn the coach's plain words into ONE typed action, read what the setting is right now, and return a before/after card with a signed token;
//   confirm  only with that token, from the same coach, within 10 minutes, and only while the setting still has the value the card showed: re-check the numbers,
//            make the same write the settings screen would (under the coach's own sign-in, so the database's own rules decide who may), and record it;
//   undo     only with the token confirm returned, and only while the setting still has the value the change set (so it never overwrites a later edit by hand).
// There is no free-form SQL and no new back door: every write is the one the matching settings screen already makes, with the same limits.
// Each setting here is read only at booking or cancel time, so setting it back reverses it, except the buffer (the nightly series top-up leaves a clashing week empty; the card warns). Session expiry is NOT here on purpose.

const PROPOSE_TTL = 10 * 60;
const UNDO_TTL = 60 * 60;
// Each window's previous length rides in the signed token, so a coach with very many windows changes this one by hand.
const MAX_WINDOWS = 30;

export interface ProposalCard {
  actionId: ActionId;
  title: string;
  beforeText: string;
  afterText: string;
  token: string;
  confirmLabel: string;
  // One plain extra line when the change has a side effect worth knowing about.
  caution?: string;
}

export type ProposeResult = { ok: true; card: ProposalCard } | { ok: false; message: string };

interface WindowLength {
  id: string;
  minutes: number | null;
}

interface Before {
  amount?: number | null;
  mode?: string | null;
  term?: TermParams | null;
  // set_session_length: every window's exact length, so an undo restores each one.
  windows?: WindowLength[];
  // add_past_session: who and when, for the card.
  session?: PastSessionCardFacts | null;
}

// add_past_session: everything the confirm needs, fixed (and signed) when the card was shown.
interface PastSessionToken {
  athleteId: string;
  groupId: string;
  clientName: string;
  startIso: string;
  endIso: string;
  timeLabel: string;
  // The coach's own booking for that client at that time, already on the calendar: THAT one is marked came in, never a second one made.
  existingBookingId: string | null;
}

const POLICY_COLUMN: Partial<Record<ActionId, string>> = {
  set_buffer: "buffer_minutes",
  set_cancellation_hours: "cancellation_window_hours",
  set_notice_hours: "minimum_notice_hours",
  set_booking_mode: "booking_mode",
};

const POLICY_DEFAULT: Partial<Record<ActionId, number>> = { set_buffer: 0, set_cancellation_hours: 24, set_notice_hours: 0 };

type OrgLookup = { ok: true; orgId: string; orgName: string } | { ok: false; message: string };

// The organization a word change applies to: the group the coach is looking at, else the only organization they own or administer. Never "whichever row comes first".
async function orgFor(supabase: SupabaseClient, userId: string, groupId: string | null): Promise<OrgLookup> {
  let orgId: string | null = null;
  if (groupId) {
    const { data: group } = await supabase.from("groups").select("organization_id").eq("id", groupId).maybeSingle();
    orgId = (group?.organization_id as string | undefined) ?? null;
  } else {
    const { data: memberships } = await supabase.from("organization_memberships").select("organization_id, role").eq("profile_id", userId);
    const admin = ((memberships ?? []) as { organization_id: string; role: string }[]).filter((m) => m.role === "owner" || m.role === "admin");
    if (admin.length > 1) return { ok: false, message: "You run more than one organization, and the word is set for each one. Open a page inside the one you mean, then ask me again." };
    orgId = admin[0]?.organization_id ?? null;
  }
  if (!orgId) return { ok: false, message: "I couldn't tell which organization you mean, so nothing was changed. You can change the word in Settings." };
  const { data: org } = await supabase.from("organizations").select("name").eq("id", orgId).maybeSingle();
  return { ok: true, orgId, orgName: (org?.name as string | undefined) ?? "your organization" };
}

async function readOverrides(supabase: SupabaseClient, orgId: string): Promise<TerminologyOverrides | null> {
  const { data: org } = await supabase.from("organizations").select("terminology_overrides").eq("id", orgId).maybeSingle();
  if (!org) return null;
  return ((org.terminology_overrides as TerminologyOverrides | null) ?? {}) as TerminologyOverrides;
}

function overrideToParams(o: TermOverride | undefined): TermParams {
  if (!o) return { kind: "default", value: "client" };
  return { kind: o.kind, value: o.value };
}

async function readWindows(supabase: SupabaseClient, userId: string): Promise<WindowLength[] | null> {
  const { data, error } = await supabase.from("coach_availability_windows").select("id, session_minutes").eq("coach_id", userId);
  if (error) return null;
  return ((data ?? []) as { id: string; session_minutes: number | null }[])
    .map((r) => ({ id: r.id, minutes: r.session_minutes ?? null }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

// What the setting is right now, read with the coach's own access. Null when it cannot be read (no access, or its database update is not applied yet).
async function readBefore(supabase: SupabaseClient, userId: string, orgId: string | null, req: ActionRequest): Promise<Before | null> {
  if (req.id === "set_term") {
    if (!orgId) return null;
    const overrides = await readOverrides(supabase, orgId);
    return overrides ? { term: overrideToParams(overrides.client) } : null;
  }
  if (req.id === "set_session_length") {
    const windows = await readWindows(supabase, userId);
    if (!windows) return null;
    const values = Array.from(new Set(windows.map((w) => w.minutes)));
    return { amount: values.length === 1 ? values[0] : null, windows };
  }
  const column = POLICY_COLUMN[req.id];
  if (!column) return null;
  const { data, error } = await supabase.from("coach_booking_policies").select(column).eq("coach_id", userId).maybeSingle();
  if (error) return null;
  const row = (data ?? {}) as unknown as Record<string, unknown>;
  if (req.id === "set_booking_mode") return { mode: (row.booking_mode as string | undefined) ?? "coach_schedules" };
  return { amount: typeof row[column] === "number" ? (row[column] as number) : POLICY_DEFAULT[req.id] ?? 0 };
}

const termKey = (t: TermParams | null | undefined) => (t ? `${t.kind}:${t.value}` : "");
const windowsKey = (w: WindowLength[] | undefined) => (w ? w.map((x) => `${x.id}=${x.minutes ?? ""}`).join(",") : "");

function sameValue(a: Before | null, b: Before | undefined): boolean {
  if (!a || !b) return false;
  return (a.amount ?? null) === (b.amount ?? null) && (a.mode ?? null) === (b.mode ?? null) && termKey(a.term) === termKey(b.term) && windowsKey(a.windows) === windowsKey(b.windows);
}

interface TokenPayload extends Record<string, unknown> {
  kind: "confirm" | "undo";
  coachId: string;
  // The organization a word change was shown for (set_term only), fixed at proposal time.
  orgId: string | null;
  action: ActionRequest;
  before: Before;
  // For an undo: the value the change set, so the undo only runs while it is still that.
  expect?: Before;
  // For an undo of a session length: each window's previous length.
  restore?: WindowLength[];
  // add_past_session only.
  session?: PastSessionToken;
}

export async function proposeAction(
  supabase: SupabaseClient,
  userId: string,
  message: string,
  pageGroupId: string | null,
  // The coach's clients in the organization they are in (the same list Ask Spot finds people in). Needed only to put a past session on the calendar.
  roster: NamedClient[] = [],
  now: Date = new Date()
): Promise<ProposeResult | null> {
  const refused = refusedSetting(message);
  if (refused) return { ok: false, message: refused };
  const req = matchAction(message);
  if (!req) return null;
  const problem = validateAction(req);
  if (problem) return { ok: false, message: problem };
  if (req.id === "add_past_session") return proposePastSession(supabase, userId, req, roster, now);

  let orgId: string | null = null;
  let orgName = "";
  if (req.id === "set_term") {
    const org = await orgFor(supabase, userId, pageGroupId);
    if (!org.ok) return { ok: false, message: org.message };
    orgId = org.orgId;
    orgName = org.orgName;
  }
  const before = await readBefore(supabase, userId, orgId, req);
  if (!before) return { ok: false, message: "I can't read that setting right now, so I haven't changed anything. You can change it by hand in your settings." };
  if (req.id === "set_session_length" && (before.windows?.length ?? 0) > MAX_WINDOWS) {
    return { ok: false, message: "You have a lot of windows of hours, so change the session length by hand in Availability." };
  }
  const d = describeAction(req, before);
  let title = d.title;
  let beforeText = d.beforeText;
  let caution: string | undefined;
  if (req.id === "set_term") title = title.replace(/ everywhere\?$/, ` in ${orgName}?`);
  if (req.id === "set_session_length" && new Set((before.windows ?? []).map((w) => w.minutes)).size > 1) beforeText = "different lengths on different days";
  if (req.id === "set_booking_mode" && req.params.mode === "free") {
    caution = "Clients will be able to book any open time themselves, with no check from you first.";
  }
  // The nightly top-up of repeating weekly sessions reads the current gap: a week that would clash with a bigger gap is left empty for good (the coach is told),
  // and setting the gap back does not bring it back.
  if (req.id === "set_buffer" && (req.params.amount ?? 0) > (before.amount ?? 0)) {
    caution = "Weekly repeating sessions that would clash with the bigger gap are left empty, and you are told. Setting it back does not bring those weeks back.";
  }
  const payload: TokenPayload = { kind: "confirm", coachId: userId, orgId, action: req, before };
  return {
    ok: true,
    card: { actionId: req.id, title, beforeText, afterText: d.afterText, token: signToken("assistant-action", payload, PROPOSE_TTL), confirmLabel: "Yes, change it", caution },
  };
}

// The write itself: the same one the matching settings screen makes, under the coach's own session.
async function apply(supabase: SupabaseClient, userId: string, orgId: string | null, req: ActionRequest, restore?: WindowLength[]): Promise<string | null> {
  const problem = restore ? null : validateAction(req);
  if (problem) return problem;
  if (req.id === "set_term") {
    if (!orgId) return "I couldn't find your organization, so nothing was changed.";
    const current = await readOverrides(supabase, orgId);
    if (!current) return "I couldn't read your organization, so nothing was changed.";
    const next: TerminologyOverrides = { ...current };
    const term = req.params.term!;
    if (term.kind === "default") delete next.client;
    else next.client = { kind: term.kind, value: term.value };
    const { data, error } = await supabase.from("organizations").update({ terminology_overrides: next }).eq("id", orgId).select("id");
    if (error || !data || data.length === 0) return "Only an organization owner or admin can change that word, so nothing was changed.";
    return null;
  }
  if (req.id === "set_session_length") {
    if (restore) {
      for (const w of restore) {
        const { error } = await supabase.from("coach_availability_windows").update({ session_minutes: w.minutes }).eq("id", w.id).eq("coach_id", userId);
        if (error) return "That didn't save everything. Check your hours in Availability.";
      }
      return null;
    }
    const minutes = req.params.amount!;
    const { data: spans, error: spanError } = await supabase.from("coach_availability_windows").select("start_time, end_time").eq("coach_id", userId);
    if (spanError) return "I couldn't read your hours, so nothing was changed.";
    if ((spans ?? []).length === 0) return "You have no hours set yet, so there is nothing to change.";
    const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
    const tooShort = ((spans ?? []) as { start_time: string; end_time: string }[]).filter((w) => mins(w.end_time) - mins(w.start_time) < minutes);
    if (tooShort.length > 0) return `${tooShort.length} of your windows of hours are shorter than ${minutes} minutes, so nothing was changed. Make them longer first, or choose a shorter session.`;
    const { error } = await supabase.from("coach_availability_windows").update({ session_minutes: minutes }).eq("coach_id", userId);
    if (error) return /session_minutes_range/.test(error.message) ? "A session longer than the time between starts needs a database update that has not been applied yet. Nothing was changed." : "That didn't save. Nothing was changed.";
    return null;
  }
  const column = POLICY_COLUMN[req.id];
  if (!column) return "I can't do that one from here.";
  const value = req.id === "set_booking_mode" ? req.params.mode : req.params.amount;
  const { error } = await supabase.from("coach_booking_policies").upsert({ coach_id: userId, [column]: value }, { onConflict: "coach_id" });
  return error ? "That didn't save. Nothing was changed." : null;
}

// The coach's own record of what Ask Spot changed (their feedback rows, kind "assistant_action"): what, when, and the before and after. A record for the coach,
// not a tamper-proof audit: that waits for the audit log (docs/ASK_SPOT_ACTIONS_DESIGN.md).
async function record(supabase: SupabaseClient, userId: string, kind: "change" | "undo", req: ActionRequest, summary: string, before: Before, after: Before) {
  try {
    await supabase.from("spotter_recommendation_feedback").insert({
      coach_id: userId,
      spotter_kind: "assistant_action",
      dismissal_key: `action::${req.id}::${kind}::${Date.now()}`,
      option_summary: summary.slice(0, 200),
      action: kind === "change" ? "confirmed" : "edited",
      edit_detail: JSON.stringify({ before: { ...before, windows: undefined }, after }).slice(0, 500),
    });
  } catch {
    // A failed note never undoes the change itself.
  }
}

function afterOf(req: ActionRequest): Before {
  return { amount: req.params.amount ?? null, mode: req.params.mode ?? null, term: req.params.term ?? null };
}

export type ConfirmResult = { ok: true; message: string; undoToken: string | null; reload: boolean } | { ok: false; message: string };

// ---- add_past_session (FIX 3B) ----
// Only what the calendar already does: book_session (the calendar's own add-a-session call; a coach may book any time, and it takes no session) and then mark_booking_attended (the
// one settle path FIX 3 uses: it takes exactly one session from an unsettled booking, nothing from one the client paid for when booking, and never a second time). When the coach
// already has a booking for that client overlapping that time, THAT booking is marked, never a second one made.

interface OverlapRow {
  id: string;
  start_at: string;
  end_at: string;
  credit_state: string | null;
  attended_at: string | null;
  no_show: boolean | null;
}

async function overlappingBookings(supabase: SupabaseClient, coachId: string, athleteId: string, startIso: string, endIso: string): Promise<OverlapRow[] | null> {
  const { data, error } = await supabase
    .from("bookings")
    .select("id, start_at, end_at, credit_state, attended_at, no_show")
    .eq("coach_id", coachId)
    .eq("athlete_id", athleteId)
    .eq("status", "confirmed")
    .lt("start_at", endIso)
    .gt("end_at", startIso)
    .order("start_at", { ascending: true })
    .limit(5);
  if (error) return null;
  return (data ?? []) as OverlapRow[];
}

// What is already there, in plain words when it settles the matter (already marked came in, or a no-show), else the booking to mark (or none).
// Minutes after midnight in the coach's time zone.
const localMinutes = (iso: string, tz: string) => {
  const d = nowInZone(tz, new Date(iso));
  return d.getUTCHours() * 60 + d.getUTCMinutes();
};
const bookingLabel = (r: { start_at: string; end_at: string }, tz: string) => timeRangeLabel(localMinutes(r.start_at, tz), localMinutes(r.end_at, tz));

function readOverlap(rows: OverlapRow[], clientName: string, tz: string): { stop: string } | { booking: OverlapRow | null } {
  const label = (r: OverlapRow) => bookingLabel(r, tz);
  const attended = rows.find((r) => r.attended_at);
  if (attended) return { stop: `${clientName}'s ${label(attended)} session today is already marked as came in, so nothing more was taken.` };
  const noShow = rows.find((r) => r.no_show);
  if (noShow) return { stop: `${clientName}'s ${label(noShow)} session today is marked as a no-show. Open it on your calendar to change that.` };
  return { booking: rows[0] ?? null };
}

async function sessionMinutesFor(supabase: SupabaseClient, userId: string): Promise<number> {
  const windows = await readWindows(supabase, userId);
  const lengths = Array.from(new Set((windows ?? []).map((w) => w.minutes).filter((m): m is number => typeof m === "number" && m > 0)));
  return lengths.length === 1 ? lengths[0] : 60;
}

const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

async function proposePastSession(supabase: SupabaseClient, userId: string, req: ActionRequest, roster: NamedClient[], now: Date): Promise<ProposeResult> {
  const spec = req.params.pastSession!;
  if (roster.length === 0) return { ok: false, message: "I couldn't find your clients right now, so nothing was added. You can add the session from your calendar." };
  const found = matchClientByName(spec.name, roster);
  if ("none" in found) return { ok: false, message: `I couldn't find a client called "${spec.name}". Check the name, or add the session from your calendar.` };
  if ("many" in found) return { ok: false, message: `Which one: ${found.many.map((c) => c.fullName).join(", ")}? Say it again with the full name.` };
  const client = found.client;
  const groups = Array.from(new Set(roster.filter((r) => r.id === client.id).map((r) => r.groupId).filter((g): g is string => !!g)));
  if (groups.length !== 1) return { ok: false, message: `${client.fullName} is in more than one of your groups, so I won't guess which one. Add the session from their calendar.` };
  const groupId = groups[0];

  const tz = await getGroupCoachTimezone(supabase, groupId);
  const local = nowInZone(tz, now);
  const nowMin = local.getUTCHours() * 60 + local.getUTCMinutes();
  const todayKey = dateKeyInZone(tz, now);
  const resolved = resolvePastWindow(spec.window, nowMin, await sessionMinutesFor(supabase, userId));
  if ("problem" in resolved) return { ok: false, message: resolved.problem };
  const startIso = zonedTimeToUtc(todayKey, hhmm(resolved.startMin), tz).toISOString();
  const endIso = new Date(zonedTimeToUtc(todayKey, hhmm(resolved.startMin), tz).getTime() + (resolved.endMin - resolved.startMin) * 60000).toISOString();

  const rows = await overlappingBookings(supabase, userId, client.id, startIso, endIso);
  if (!rows) return { ok: false, message: "I can't read your calendar right now, so nothing was added." };
  const overlap = readOverlap(rows, client.fullName, tz);
  if ("stop" in overlap) return { ok: false, message: overlap.stop };
  const existing = overlap.booking;
  // The card shows the booking that will be marked: an existing one's own times.
  const timeLabel = existing ? bookingLabel(existing, tz) : timeRangeLabel(resolved.startMin, resolved.endMin);
  const facts: PastSessionCardFacts = { clientName: client.fullName, timeLabel, existing: !existing ? "none" : existing.credit_state === "unsettled" ? "unmarked" : "prepaid" };
  const d = describeAction(req, { session: facts });
  const session: PastSessionToken = {
    athleteId: client.id,
    groupId,
    clientName: client.fullName,
    startIso: existing ? existing.start_at : startIso,
    endIso: existing ? existing.end_at : endIso,
    timeLabel,
    existingBookingId: existing?.id ?? null,
  };
  const payload: TokenPayload = { kind: "confirm", coachId: userId, orgId: null, action: req, before: { session: facts }, session };
  return { ok: true, card: { actionId: req.id, title: d.title, beforeText: d.beforeText, afterText: d.afterText, token: signToken("assistant-action", payload, PROPOSE_TTL), confirmLabel: "Yes" } };
}

async function confirmPastSession(supabase: SupabaseClient, userId: string, req: ActionRequest, s: PastSessionToken): Promise<ConfirmResult> {
  const tz = await getGroupCoachTimezone(supabase, s.groupId);
  // Read again now: a second Yes on the same card, or a booking made since, finds the booking and never makes another or takes another session.
  const rows = await overlappingBookings(supabase, userId, s.athleteId, s.startIso, s.endIso);
  if (!rows) return { ok: false, message: "I can't read your calendar right now, so nothing was changed." };
  const overlap = readOverlap(rows, s.clientName, tz);
  if ("stop" in overlap) return { ok: false, message: overlap.stop };

  let bookingId = overlap.booking?.id ?? null;
  let created = false;
  if (!bookingId) {
    const { data, error } = await supabase.rpc("book_session", { p_coach_id: userId, p_athlete_id: s.athleteId, p_group_id: s.groupId, p_start_at: s.startIso, p_end_at: s.endIso });
    if (error || !data) {
      const why = error?.message ?? "";
      if (/just taken/.test(why)) return { ok: false, message: "You already have another session on your calendar at that time, so nothing was added. Open your calendar to sort it out." };
      if (/training client/.test(why)) return { ok: false, message: `${s.clientName} isn't set up for sessions there, so nothing was added.` };
      return { ok: false, message: "That didn't go through, so nothing was added. You can add it from your calendar." };
    }
    bookingId = data as string;
    created = true;
  }
  const { data: took, error: markError } = await supabase.rpc("mark_booking_attended", { p_booking_id: bookingId });
  if (markError) {
    return created
      ? { ok: false, message: `${s.clientName} is on your calendar for today ${s.timeLabel}, but I couldn't mark it as came in. Open it on your calendar and mark it there.` }
      : { ok: false, message: "I couldn't mark that session as came in, so nothing was changed. Open it on your calendar and mark it there." };
  }
  await record(supabase, userId, "change", req, `${s.clientName}, today ${s.timeLabel}, came in`, { session: null }, { amount: took === true ? 1 : 0 });
  const tail = took === true ? "1 session used." : "Nothing more taken: it was already paid for.";
  return { ok: true, message: `Done. ${s.clientName} is on your calendar for today ${s.timeLabel}, came in. ${tail}`, undoToken: null, reload: true };
}

export async function confirmAction(supabase: SupabaseClient, userId: string, token: unknown): Promise<ConfirmResult> {
  const payload = verifyToken<TokenPayload>("assistant-action", token);
  if (!payload || payload.kind !== "confirm" || payload.coachId !== userId) return { ok: false, message: "That request expired. Ask me again and I'll show it to you." };
  const req = payload.action;
  if (req.id === "add_past_session") {
    if (!payload.session) return { ok: false, message: "That request expired. Ask me again and I'll show it to you." };
    return confirmPastSession(supabase, userId, req, payload.session);
  }
  const before = await readBefore(supabase, userId, payload.orgId, req);
  if (!before) return { ok: false, message: "I can't read that setting right now, so I haven't changed anything." };
  // The card showed one starting value. If it is not that any more (changed by hand, already confirmed, undone), the card is wrong: refuse rather than write.
  if (!sameValue(before, payload.before)) return { ok: false, message: "That setting changed since I showed it to you, so I left it alone. Ask me again to see where it is now." };
  const failed = await apply(supabase, userId, payload.orgId, req);
  if (failed) return { ok: false, message: failed };
  const d = describeAction(req, before);
  await record(supabase, userId, "change", req, `${d.title.replace(/\?$/, "")}: ${d.beforeText} to ${d.afterText}`, before, afterOf(req));
  const undo: TokenPayload = {
    kind: "undo",
    coachId: userId,
    orgId: payload.orgId,
    action: undoRequest(req, before),
    before: afterOf(req),
    expect: afterOf(req),
    restore: req.id === "set_session_length" ? before.windows : undefined,
  };
  return { ok: true, message: `Done. ${d.afterText.charAt(0).toUpperCase()}${d.afterText.slice(1)}.`, undoToken: signToken("assistant-action", undo, UNDO_TTL), reload: req.id === "set_term" };
}

// The change that puts the setting back to what it was.
function undoRequest(req: ActionRequest, before: Before): ActionRequest {
  if (req.id === "set_term") return { id: "set_term", params: { term: before.term ?? { kind: "default", value: "client" } } };
  if (req.id === "set_booking_mode") return { id: "set_booking_mode", params: { mode: (before.mode as BookingMode) ?? "coach_schedules" } };
  // A session length goes back window by window (see `restore`); the amount here is only the length the change set, for the compare.
  if (req.id === "set_session_length") return { id: req.id, params: { amount: req.params.amount ?? 5 } };
  return { id: req.id, params: { amount: before.amount ?? 0 } };
}

export async function undoAction(supabase: SupabaseClient, userId: string, token: unknown): Promise<ConfirmResult> {
  const payload = verifyToken<TokenPayload>("assistant-action", token);
  if (!payload || payload.kind !== "undo" || payload.coachId !== userId) return { ok: false, message: "That undo has expired. You can change the setting back by hand in your settings." };
  const req = payload.action;
  const changedSince = { ok: false as const, message: "That setting has changed since, so I left it alone. You can change it by hand in your settings." };

  if (req.id === "set_session_length") {
    const restore = payload.restore ?? [];
    const windows = await readWindows(supabase, userId);
    if (!windows || restore.length === 0) return changedSince;
    // Only while every window still has the length the change set (and no window was added or removed since).
    const set = payload.expect?.amount ?? null;
    const sameIds = windows.length === restore.length && windows.every((w) => restore.some((r) => r.id === w.id));
    if (!sameIds || windows.some((w) => w.minutes !== set)) return changedSince;
    const failed = await apply(supabase, userId, null, req, restore);
    if (failed) return { ok: false, message: failed };
    await record(supabase, userId, "undo", req, "Undone: session length", { amount: set }, {});
    return { ok: true, message: "Undone. Your hours have their old session lengths back.", undoToken: null, reload: false };
  }

  const current = await readBefore(supabase, userId, payload.orgId, req);
  if (!sameValue(current, payload.expect)) return changedSince;
  const failed = await apply(supabase, userId, payload.orgId, req);
  if (failed) return { ok: false, message: failed };
  const d = describeAction(req, current ?? {});
  await record(supabase, userId, "undo", req, `Undone: ${d.title.replace(/\?$/, "")}`, current ?? {}, afterOf(req));
  return { ok: true, message: "Undone. It is back the way it was.", undoToken: null, reload: req.id === "set_term" };
}
