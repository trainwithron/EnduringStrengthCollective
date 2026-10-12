import type { SupabaseClient } from "@supabase/supabase-js";
import { isUnder13 } from "@/lib/coppa";

// Every client has a date of birth on file (client_intake.date_of_birth, the one place the age rules read). A client who has none is asked once, on a one-field screen (/birthday), before they
// reach their group; a client under 13 without a parent's verified consent stops at that same screen. A coach, or anyone who is not a client, is never asked.
export type DobGate = "ok" | "need_dob" | "blocked";

export const DOB_OK_COOKIE = "dob_ok";

// Pure, so the order of the checks can be tested: no date yet is asked BEFORE anything else, and a child cannot get past it without a verified parent's consent.
export function dobGateState(input: { isClientOnly: boolean; dateOfBirth: string | null; consentVerified: boolean; now?: Date }): DobGate {
  if (!input.isClientOnly) return "ok";
  if (!input.dateOfBirth) return "need_dob";
  if (isUnder13(input.dateOfBirth, input.now ?? new Date()) && !input.consentVerified) return "blocked";
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

export interface DobGateFacts {
  gate: DobGate;
  groupId: string | null;
  dateOfBirth: string | null;
  profileBirthday: string | null;
  consentVerified: boolean;
}

// Reads what the gate needs for one person. "Client only" = at least one client membership and no coach membership (a coach using the app as their own client is a coach).
export async function loadDobGate(supabase: SupabaseClient, userId: string): Promise<DobGateFacts> {
  const { data: memberships } = await supabase.from("group_memberships").select("group_id, role").eq("profile_id", userId);
  const rows = (memberships ?? []) as { group_id: string; role: string }[];
  const isClientOnly = rows.some((m) => m.role === "athlete") && !rows.some((m) => m.role === "coach");
  const groupId = rows.find((m) => m.role === "athlete")?.group_id ?? null;
  if (!isClientOnly) return { gate: "ok", groupId, dateOfBirth: null, profileBirthday: null, consentVerified: false };

  const [{ data: intake }, { data: details }, { data: consent }] = await Promise.all([
    supabase.from("client_intake").select("date_of_birth").eq("athlete_id", userId).maybeSingle(),
    supabase.from("athlete_profile_details").select("birthday").eq("athlete_id", userId).maybeSingle(),
    supabase.from("minor_consent").select("verified").eq("athlete_id", userId).maybeSingle(),
  ]);
  const dateOfBirth = ((intake as { date_of_birth?: string | null } | null)?.date_of_birth ?? null) as string | null;
  const profileBirthday = ((details as { birthday?: string | null } | null)?.birthday ?? null) as string | null;
  const consentVerified = (consent as { verified?: boolean } | null)?.verified === true;
  return { gate: dobGateState({ isClientOnly, dateOfBirth, consentVerified }), groupId, dateOfBirth, profileBirthday, consentVerified };
}
