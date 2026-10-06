import type { SupabaseClient } from "@supabase/supabase-js";
import { signToken, verifyToken } from "./signed-token";
import {
  describeAction,
  matchAction,
  validateAction,
  type ActionId,
  type ActionRequest,
  type BookingMode,
  type TermParams,
} from "./assistant-actions";
import type { TermOverride, TerminologyOverrides } from "./terminology";

// The server half of Ask Spot's action layer (docs/ASK_SPOT_ACTIONS_DESIGN.md). Three steps, and nothing happens before the second:
//   propose  turn the coach's plain words into ONE typed action, read what the setting is right now, and return a before/after card with a signed token;
//   confirm  only with that token, from the same coach, within 10 minutes: re-check the numbers, re-read the setting, make the same write the settings screen would
//            (under the coach's own sign-in, so the database's own rules decide who may change it), and record it;
//   undo     only with the token confirm returned, and only if the setting still has the value the change set (so it never overwrites a later edit by hand).
// There is no free-form SQL and no new back door: every write is the one the matching settings screen already makes, with the same limits.

const PROPOSE_TTL = 10 * 60;
const UNDO_TTL = 60 * 60;

export interface ProposalCard {
  actionId: ActionId;
  title: string;
  beforeText: string;
  afterText: string;
  token: string;
  confirmLabel: string;
}

export type ProposeResult = { ok: true; card: ProposalCard } | { ok: false; message: string };

interface Before {
  amount?: number | null;
  mode?: string | null;
  term?: TermParams | null;
}

const POLICY_COLUMN: Partial<Record<ActionId, string>> = {
  set_buffer: "buffer_minutes",
  set_cancellation_hours: "cancellation_window_hours",
  set_notice_hours: "minimum_notice_hours",
  set_expiry_days: "credit_expiry_days",
  set_booking_mode: "booking_mode",
};

const POLICY_DEFAULT: Partial<Record<ActionId, number>> = { set_buffer: 0, set_cancellation_hours: 24, set_notice_hours: 0, set_expiry_days: 0 };

async function orgIdFor(supabase: SupabaseClient, userId: string, groupId: string | null): Promise<string | null> {
  if (groupId) {
    const { data: group } = await supabase.from("groups").select("organization_id").eq("id", groupId).maybeSingle();
    if (group?.organization_id) return group.organization_id as string;
  }
  const { data: membership } = await supabase.from("organization_memberships").select("organization_id").eq("profile_id", userId).limit(1).maybeSingle();
  return (membership?.organization_id as string | undefined) ?? null;
}

async function readTerm(supabase: SupabaseClient, userId: string, groupId: string | null): Promise<{ orgId: string; overrides: TerminologyOverrides } | null> {
  const orgId = await orgIdFor(supabase, userId, groupId);
  if (!orgId) return null;
  const { data: org } = await supabase.from("organizations").select("terminology_overrides").eq("id", orgId).maybeSingle();
  if (!org) return null;
  return { orgId, overrides: ((org.terminology_overrides as TerminologyOverrides | null) ?? {}) as TerminologyOverrides };
}

function overrideToParams(o: TermOverride | undefined): TermParams {
  if (!o) return { kind: "default", value: "client" };
  return { kind: o.kind, value: o.value };
}

// What the setting is right now, read with the coach's own access. Null when it cannot be read (the setting's database update is not applied yet, or no access).
async function readBefore(supabase: SupabaseClient, userId: string, groupId: string | null, req: ActionRequest): Promise<Before | null> {
  if (req.id === "set_term") {
    const t = await readTerm(supabase, userId, groupId);
    return t ? { term: overrideToParams(t.overrides.client) } : null;
  }
  if (req.id === "set_session_length") {
    const { data, error } = await supabase.from("coach_availability_windows").select("session_minutes").eq("coach_id", userId);
    if (error) return null;
    const values = Array.from(new Set(((data ?? []) as { session_minutes: number | null }[]).map((r) => r.session_minutes ?? 0)));
    return { amount: values.length === 1 ? values[0] : null };
  }
  const column = POLICY_COLUMN[req.id];
  if (!column) return null;
  const { data, error } = await supabase.from("coach_booking_policies").select(column).eq("coach_id", userId).maybeSingle();
  if (error) return null;
  const row = (data ?? {}) as unknown as Record<string, unknown>;
  if (req.id === "set_booking_mode") return { mode: (row.booking_mode as string | undefined) ?? "coach_schedules" };
  return { amount: typeof row[column] === "number" ? (row[column] as number) : POLICY_DEFAULT[req.id] ?? 0 };
}

interface TokenPayload extends Record<string, unknown> {
  kind: "confirm" | "undo";
  coachId: string;
  groupId: string | null;
  action: ActionRequest;
  before: Before;
  // For an undo: the value the change set, so the undo only runs while it is still that.
  expect?: Before;
}

export async function proposeAction(supabase: SupabaseClient, userId: string, message: string, groupId: string | null): Promise<ProposeResult | null> {
  const req = matchAction(message);
  if (!req) return null;
  const problem = validateAction(req);
  if (problem) return { ok: false, message: problem };
  const before = await readBefore(supabase, userId, groupId, req);
  if (!before) return { ok: false, message: "I can't read that setting right now, so I haven't changed anything. You can change it by hand in your settings." };
  const d = describeAction(req, before);
  const payload: TokenPayload = { kind: "confirm", coachId: userId, groupId, action: req, before };
  return { ok: true, card: { actionId: req.id, title: d.title, beforeText: d.beforeText, afterText: d.afterText, token: signToken("assistant-action", payload, PROPOSE_TTL), confirmLabel: "Yes, change it" } };
}

// The write itself: the same one the matching settings screen makes, under the coach's own session.
async function apply(supabase: SupabaseClient, userId: string, groupId: string | null, req: ActionRequest): Promise<string | null> {
  const problem = validateAction(req);
  if (problem) return problem;
  if (req.id === "set_term") {
    const t = await readTerm(supabase, userId, groupId);
    if (!t) return "I couldn't find your organization, so nothing was changed.";
    const next: TerminologyOverrides = { ...t.overrides };
    const term = req.params.term!;
    if (term.kind === "default") delete next.client;
    else next.client = { kind: term.kind, value: term.value };
    const { data, error } = await supabase.from("organizations").update({ terminology_overrides: next }).eq("id", t.orgId).select("id");
    if (error || !data || data.length === 0) return "Only an organization owner or admin can change that word, so nothing was changed.";
    return null;
  }
  if (req.id === "set_session_length") {
    const minutes = req.params.amount!;
    const { data: windows, error: readError } = await supabase.from("coach_availability_windows").select("weekday, start_time, end_time").eq("coach_id", userId);
    if (readError) return "I couldn't read your hours, so nothing was changed.";
    const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
    const tooShort = ((windows ?? []) as { start_time: string; end_time: string }[]).filter((w) => mins(w.end_time) - mins(w.start_time) < minutes);
    if (tooShort.length > 0) return `${tooShort.length} of your windows of hours are shorter than ${minutes} minutes, so nothing was changed. Make them longer first, or choose a shorter session.`;
    if ((windows ?? []).length === 0) return "You have no hours set yet, so there is nothing to change.";
    const { error } = await supabase.from("coach_availability_windows").update({ session_minutes: minutes }).eq("coach_id", userId);
    if (error) return /session_minutes_range/.test(error.message) ? "A session longer than the time between starts needs a database update that has not been applied yet. Nothing was changed." : "That didn't save. Nothing was changed.";
    return null;
  }
  const column = POLICY_COLUMN[req.id];
  if (!column) return "I can't do that one yet.";
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
      edit_detail: JSON.stringify({ before, after }).slice(0, 500),
    });
  } catch {
    // A failed note never undoes the change itself.
  }
}

function afterOf(req: ActionRequest): Before {
  return { amount: req.params.amount ?? null, mode: req.params.mode ?? null, term: req.params.term ?? null };
}

function sameValue(a: Before | null, b: Before | undefined): boolean {
  if (!a || !b) return false;
  return (a.amount ?? null) === (b.amount ?? null) && (a.mode ?? null) === (b.mode ?? null) && termKey(a.term) === termKey(b.term);
}
const termKey = (t: TermParams | null | undefined) => (t ? `${t.kind}:${t.value}` : "");

export type ConfirmResult = { ok: true; message: string; undoToken: string | null; reload: boolean } | { ok: false; message: string };

export async function confirmAction(supabase: SupabaseClient, userId: string, token: unknown): Promise<ConfirmResult> {
  const payload = verifyToken<TokenPayload>("assistant-action", token);
  if (!payload || payload.kind !== "confirm" || payload.coachId !== userId) return { ok: false, message: "That request expired. Ask me again and I'll show it to you." };
  const req = payload.action;
  const before = await readBefore(supabase, userId, payload.groupId, req);
  if (!before) return { ok: false, message: "I can't read that setting right now, so I haven't changed anything." };
  const failed = await apply(supabase, userId, payload.groupId, req);
  if (failed) return { ok: false, message: failed };
  const d = describeAction(req, before);
  await record(supabase, userId, "change", req, `${d.title.replace(/\?$/, "")}: ${d.beforeText} to ${d.afterText}`, before, afterOf(req));
  const undo: TokenPayload = { kind: "undo", coachId: userId, groupId: payload.groupId, action: undoRequest(req, before), before: afterOf(req), expect: afterOf(req) };
  return { ok: true, message: `Done. ${d.afterText.charAt(0).toUpperCase()}${d.afterText.slice(1)}.`, undoToken: signToken("assistant-action", undo, UNDO_TTL), reload: req.id === "set_term" };
}

// The change that puts the setting back to what it was.
function undoRequest(req: ActionRequest, before: Before): ActionRequest {
  if (req.id === "set_term") return { id: "set_term", params: { term: before.term ?? { kind: "default", value: "client" } } };
  if (req.id === "set_booking_mode") return { id: "set_booking_mode", params: { mode: (before.mode as BookingMode) ?? "coach_schedules" } };
  // A session length that was a mix of values (or none) goes back to "the same as the slot" only by hand: refuse the undo rather than guess.
  return { id: req.id, params: { amount: before.amount ?? 0 } };
}

export async function undoAction(supabase: SupabaseClient, userId: string, token: unknown): Promise<ConfirmResult> {
  const payload = verifyToken<TokenPayload>("assistant-action", token);
  if (!payload || payload.kind !== "undo" || payload.coachId !== userId) return { ok: false, message: "That undo has expired. You can change the setting back by hand in your settings." };
  const req = payload.action;
  if (req.id === "set_session_length" && payload.before.amount == null) {
    return { ok: false, message: "I can't undo that one safely (your hours had different lengths before). You can change them back by hand." };
  }
  const current = await readBefore(supabase, userId, payload.groupId, req);
  if (!sameValue(current, payload.expect)) return { ok: false, message: "That setting has changed since, so I left it alone. You can change it by hand in your settings." };
  const failed = await apply(supabase, userId, payload.groupId, req);
  if (failed) return { ok: false, message: failed };
  const d = describeAction(req, current ?? {});
  await record(supabase, userId, "undo", req, `Undone: ${d.title.replace(/\?$/, "")}`, current ?? {}, afterOf(req));
  return { ok: true, message: "Undone. It is back the way it was.", undoToken: null, reload: req.id === "set_term" };
}
