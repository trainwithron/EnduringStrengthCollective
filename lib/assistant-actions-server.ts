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
}

export async function proposeAction(supabase: SupabaseClient, userId: string, message: string, pageGroupId: string | null): Promise<ProposeResult | null> {
  const refused = refusedSetting(message);
  if (refused) return { ok: false, message: refused };
  const req = matchAction(message);
  if (!req) return null;
  const problem = validateAction(req);
  if (problem) return { ok: false, message: problem };

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

export async function confirmAction(supabase: SupabaseClient, userId: string, token: unknown): Promise<ConfirmResult> {
  const payload = verifyToken<TokenPayload>("assistant-action", token);
  if (!payload || payload.kind !== "confirm" || payload.coachId !== userId) return { ok: false, message: "That request expired. Ask me again and I'll show it to you." };
  const req = payload.action;
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
