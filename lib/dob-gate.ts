import type { SupabaseClient } from "@supabase/supabase-js";
import { ageBand, type AgeBand, type GuardianConsentState } from "@/lib/guardian-consent";

// Every client has a date of birth on file (client_intake.date_of_birth, the one place the age rules read). A client who has none is asked once, on a one-field screen (/birthday), before they
// reach their group. A client under 13 is not accepted at all ("blocked": no consent of any kind lets them in). A client aged 13 to 17 stops at the same screen until a parent or guardian has signed
// ("need_guardian"). A coach, or anyone who is not a client, is never asked.
// "check_failed": the gate could not be read (a failed lookup). It is never "ok" and never remembered: the careful side, and the person is asked to try again.
export type DobGate = "ok" | "need_dob" | "blocked" | "need_guardian" | "check_failed";

// "_v2": passes issued before the rule that a minor is never remembered stopped being honored at that deploy (the name changed and so did the signed text).
export const DOB_OK_COOKIE = "dob_ok_v2";

// The "already checked" cookie is signed (HMAC with a server secret) so a child cannot write it by hand to skip the check. With no secret configured nothing is cached and the check runs every time.
async function hmacHex(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
export async function signDobOk(userId: string, secret: string | undefined): Promise<string | null> {
  return secret ? `${userId}.${await hmacHex(`dob_ok_v2:${userId}`, secret)}` : null;
}
export async function dobOkCookieValid(value: string | undefined, userId: string, secret: string | undefined): Promise<boolean> {
  if (!value || !secret) return false;
  const expected = await signDobOk(userId, secret);
  return !!expected && value === expected;
}

// Pure, so the order of the checks can be tested: no date yet is asked BEFORE anything else; under 13 is always blocked; 13 to 17 needs a signed guardian consent.
export function dobGateState(input: { isClientOnly: boolean; dateOfBirth: string | null; guardianSigned: boolean; now?: Date }): DobGate {
  if (!input.isClientOnly) return "ok";
  if (!input.dateOfBirth) return "need_dob";
  const band = ageBand(input.dateOfBirth, input.now ?? new Date());
  if (band === "under13") return "blocked";
  if (band === "teen" && !input.guardianSigned) return "need_guardian";
  return "ok";
}

// A date the person typed: a real calendar date, not in the future, not more than 120 years ago.
export function validDateOfBirth(value: string, now: Date = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, day] = value.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1, day));
  // Round trip: 2026-02-31 becomes March 3rd, which is not the date that was typed.
  if (d.toISOString().slice(0, 10) !== value) return false;
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  if (d.getTime() > today) return false;
  return y >= now.getFullYear() - 120;
}

export interface GuardianFacts {
  state: GuardianConsentState;
  guardianEmail: string | null;
  requestedAt: string | null;
}

export interface DobGateFacts {
  gate: DobGate;
  groupId: string | null;
  dateOfBirth: string | null;
  profileBirthday: string | null;
  ageBand: AgeBand;
  // May this pass be remembered for a week? Only an adult client whose date of birth is on file, or a coach (a coach seat is what makes someone "not a client only" for a lasting reason). Never when the person has no seat at all
  // (they may become a client any minute: a removed client who is put back, a new account that joins by invite), and never after a failed lookup. A client with no date, a teen and a child are checked on every page.
  cacheable: boolean;
  // Only read for a client aged 13 to 17.
  guardian: GuardianFacts | null;
}

// Reads what the gate needs for one person. "Client only" = at least one client membership and no coach membership (a coach using the app as their own client is a coach).
export async function loadDobGate(supabase: SupabaseClient, userId: string): Promise<DobGateFacts> {
  const { data: memberships, error: membershipError } = await supabase.from("group_memberships").select("group_id, role").eq("profile_id", userId);
  // A lookup that failed says nothing about who this person is: not ok, not remembered.
  if (membershipError) return { gate: "check_failed", groupId: null, dateOfBirth: null, profileBirthday: null, ageBand: "unknown", cacheable: false, guardian: null };
  const rows = (memberships ?? []) as { group_id: string; role: string }[];
  const hasCoachSeat = rows.some((m) => m.role === "coach");
  const hasAthleteSeat = rows.some((m) => m.role === "athlete");
  const groupId = rows.find((m) => m.role === "athlete")?.group_id ?? null;
  // Staff are not "client only" even when their only group seat is an athlete seat (a gym owner who also trains, a front-desk person): anyone who holds an organization role (owner, admin, coach: clients belong to an
  // organization only through a group) or a front-desk seat is treated like a coach seat. Looked up only when it could matter (an athlete seat and no coach seat); a failed lookup is a failed check.
  let isStaff = false;
  if (hasAthleteSeat && !hasCoachSeat) {
    const [{ data: orgRows, error: orgError }, { data: deskRows, error: deskError }] = await Promise.all([
      supabase.from("organization_memberships").select("organization_id").eq("profile_id", userId).limit(1),
      supabase.from("org_front_desk").select("organization_id").eq("profile_id", userId).limit(1),
    ]);
    if (orgError || deskError) return { gate: "check_failed", groupId, dateOfBirth: null, profileBirthday: null, ageBand: "unknown", cacheable: false, guardian: null };
    isStaff = ((orgRows as unknown[] | null) ?? []).length > 0 || ((deskRows as unknown[] | null) ?? []).length > 0;
  }
  const isClientOnly = hasAthleteSeat && !hasCoachSeat && !isStaff;
  if (!isClientOnly) return { gate: "ok", groupId, dateOfBirth: null, profileBirthday: null, ageBand: "unknown", cacheable: hasCoachSeat, guardian: null };

  const [{ data: intake, error: intakeError }, { data: details, error: detailsError }] = await Promise.all([
    supabase.from("client_intake").select("date_of_birth").eq("athlete_id", userId).maybeSingle(),
    supabase.from("athlete_profile_details").select("birthday").eq("athlete_id", userId).maybeSingle(),
  ]);
  // A failed read of the date is not "no date": asking an adult for their birthday again because a lookup failed would be wrong, and so would letting anyone through. Not ok, not remembered.
  if (intakeError || detailsError) return { gate: "check_failed", groupId, dateOfBirth: null, profileBirthday: null, ageBand: "unknown", cacheable: false, guardian: null };
  const dateOfBirth = ((intake as { date_of_birth?: string | null } | null)?.date_of_birth ?? null) as string | null;
  const profileBirthday = ((details as { birthday?: string | null } | null)?.birthday ?? null) as string | null;
  const band = ageBand(dateOfBirth);
  // The guardian's signature is looked up only for a client aged 13 to 17. A failed lookup is "not signed": the careful side.
  let guardian: GuardianFacts | null = null;
  if (band === "teen") {
    const { data, error } = await supabase.rpc("guardian_consent_state", { p_athlete: userId });
    const row = !error && data && typeof data === "object" ? (data as { state?: string; guardian_email?: string | null; requested_at?: string | null }) : null;
    const state = row?.state === "signed" || row?.state === "pending" || row?.state === "withdrawn" || row?.state === "expired" ? row.state : "none";
    guardian = { state, guardianEmail: row?.guardian_email ?? null, requestedAt: row?.requested_at ?? null };
  }
  const gate = dobGateState({ isClientOnly, dateOfBirth, guardianSigned: guardian?.state === "signed" });
  return { gate, groupId, dateOfBirth, profileBirthday, ageBand: band, cacheable: gate === "ok" && band === "adult", guardian };
}

// May this request skip the lookup? Only with the week-long pass (dob_ok_v2), signed for THIS person and this secret. Such a pass is only ever issued to a coach or an adult client with a birthday on file (mayRememberPass),
// never to a person with no seat, a child, a teen, a client without a date or after a failed lookup, so a seatless or unknown person is checked on every request.
export async function mayRememberPass(facts: Pick<DobGateFacts, "gate" | "cacheable">): Promise<boolean> {
  return facts.gate === "ok" && facts.cacheable;
}
export async function maySkipGateCheck(cookieValue: string | undefined, userId: string, secret: string | undefined): Promise<boolean> {
  return dobOkCookieValid(cookieValue, userId, secret);
}
