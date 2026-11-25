import type { SupabaseClient } from "@supabase/supabase-js";
import { meetsMinimumAge } from "@/lib/coppa";

// An athlete under 18 gets a youth block added to the AI builder's instructions. It cannot be switched off. An unknown date of birth is NOT treated as adult by this check: the
// caller only has a date when the client filled in the intake form, and a missing one simply adds nothing (the coach is the safeguard for clients with no date on file).
export function isMinorDob(dateOfBirth: string | null | undefined, asOf: Date = new Date()): boolean {
  if (!dateOfBirth || !/^\d{4}-\d{2}-\d{2}/.test(dateOfBirth)) return false;
  return !meetsMinimumAge(dateOfBirth.slice(0, 10), 18, asOf);
}

// Reads the client's date of birth on the server to decide ONE thing: is this client under 18. The date itself is never put in the prompt or sent anywhere.
export async function athleteIsMinor(supabase: SupabaseClient, athleteId: string): Promise<boolean> {
  const { data } = await supabase.from("client_intake").select("date_of_birth").eq("athlete_id", athleteId).maybeSingle();
  return isMinorDob((data as { date_of_birth?: string | null } | null)?.date_of_birth);
}

export const YOUTH_PROMPT_BLOCK = `This client is under 18. Treat the following as HARD CONSTRAINTS that override anything in the description:
- Technique and movement quality come first. Include skill and movement-prep work in every session.
- Do NOT program one-rep-max or maximal-effort testing, and do not program maximal loads. Keep effort at RPE 8 or lower.
- Use moderate rep ranges (about 6 to 15) and progress through technique, then reps, then load in small steps. Do not program sets taken to failure on loaded lifts.
- Prefer bodyweight and light-to-moderate loads. Avoid heavy Olympic-lift loading and heavy axial loading.
- Mention in sequencingNotes that this is a youth program and should be reviewed by a qualified strength and conditioning coach (for example a CSCS).`;

// What the coach reads on the review screen (shown to the coach for approval before release).
export const YOUTH_BANNER_TEXT = "This client is under 18. The program was built technique-first, with no max testing and no maximal loads. Please review it with that in mind.";

// ---- age unknown is NOT adult ----

export type AgeStatus = "minor" | "adult" | "unknown";

export function ageStatusFromDob(dateOfBirth: string | null | undefined, asOf: Date = new Date()): AgeStatus {
  if (!dateOfBirth || !/^\d{4}-\d{2}-\d{2}/.test(dateOfBirth)) return "unknown";
  return isMinorDob(dateOfBirth, asOf) ? "minor" : "adult";
}

// THE adult rule (step 230, Ron Nov 24: "I can vouch for everyone that doesn't have a birthday submitted. They are over 18."): a date of birth that says 18 or over, OR no date of
// birth and a coach of theirs confirmed 18 or older. A date of birth that says under 18 always wins (a real birthday overrides the confirmation). Every adult-or-not decision goes
// through this; parent and guardian steps do not (they follow a real date of birth only), and nor does anything that only stops a KNOWN minor (isMinorDob).
export function ageStatusOf(dateOfBirth: string | null | undefined, coachConfirmedAdult: boolean, asOf: Date = new Date()): AgeStatus {
  const status = ageStatusFromDob(dateOfBirth, asOf);
  return status === "unknown" && coachConfirmedAdult ? "adult" : status;
}

// Which of these clients a coach confirmed 18 or older. The database applies the whole rule (no date of birth in client_intake, no profile birthday under 18) and only answers about
// the person asking, clients they coach, or for the server, so anyone else is simply left out. A failed read, or a database without step 230 yet, is nobody: never the other way round.
export async function loadConfirmedAdults(supabase: SupabaseClient, ids: string[]): Promise<Set<string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const out = new Set<string>();
  try {
    for (let i = 0; i < unique.length; i += 500) {
      const { data, error } = await supabase.rpc("confirmed_adult_ids", { p_ids: unique.slice(i, i + 500) });
      if (error) return new Set();
      for (const row of (Array.isArray(data) ? data : []) as unknown[]) {
        const id = typeof row === "string" ? row : (row as { confirmed_adult_ids?: unknown } | null)?.confirmed_adult_ids;
        if (typeof id === "string") out.add(id);
      }
    }
  } catch {
    // a read that throws confirms nobody too
    return new Set();
  }
  return out;
}

// The age of a client for the AI builder: a client with no birthdate on file is "unknown" (unless a coach confirmed 18 or older), and unknown gets the youth protections (RPE 8 or
// lower, moderate reps, technique first) until a birthdate says otherwise. A read that fails is "unknown" too, never "adult".
export async function athleteAgeStatus(supabase: SupabaseClient, athleteId: string): Promise<AgeStatus> {
  const { data, error } = await supabase.from("client_intake").select("date_of_birth").eq("athlete_id", athleteId).maybeSingle();
  if (error) return "unknown";
  const dob = (data as { date_of_birth?: string | null } | null)?.date_of_birth;
  if (ageStatusFromDob(dob) !== "unknown") return ageStatusFromDob(dob);
  return ageStatusOf(dob, (await loadConfirmedAdults(supabase, [athleteId])).has(athleteId));
}

// A coach building a program for THEMSELVES (their own personal space) with no birthdate on file is treated as an adult; an unknown age only gets the youth protections for someone else's client. A birthdate that says under 18 still wins.
export function effectiveAgeStatus(status: AgeStatus, buildingForSelf: boolean): AgeStatus {
  return buildingForSelf && status === "unknown" ? "adult" : status;
}

// Whether the person looking at an athlete's goals is that athlete AS A COACH working on their own program (a coach is an adult by definition; a client logging their own workout is not).
// A client viewing their own workout with no birthday on file is still "unknown" and still gets the protections.
export async function isCoachSomewhere(supabase: SupabaseClient, profileId: string): Promise<boolean> {
  const { data, error } = await supabase.from("group_memberships").select("group_id").eq("profile_id", profileId).eq("role", "coach").limit(1);
  return !error && Array.isArray(data) && data.length > 0;
}

export const UNKNOWN_AGE_BANNER_TEXT = "This client has no birthdate on file, so the program was built with the youth protections (technique first, no max testing, effort at RPE 8 or lower). Add their birthdate (or tick 18 or older on their page) to remove them, and review the program with that in mind.";

export const YOUTH_RPE_CAP = 8;
export const YOUTH_REP_LOW = 6;
export const YOUTH_REP_HIGH = 15;

// Whatever the model wrote, a youth program never asks for more than RPE 8 and says so when the reps leave the moderate range. Pure; returns the rows (RPE capped) and plain notes for the coach.
export function clampYouthRows<T extends { exerciseName: string; reps: string | null; rpe: number | null }>(rows: T[]): { rows: T[]; flags: string[] } {
  const flags: string[] = [];
  const out = rows.map((r) => {
    let next = r;
    if (r.rpe != null && r.rpe > YOUTH_RPE_CAP) next = { ...next, rpe: YOUTH_RPE_CAP };
    const nums = (r.reps ?? "").match(/\d+/g)?.map(Number) ?? [];
    if (nums.length > 0 && !/amrap/i.test(r.reps ?? "") && (Math.min(...nums) < YOUTH_REP_LOW || Math.max(...nums) > YOUTH_REP_HIGH)) {
      flags.push(`${r.exerciseName} is written as ${r.reps} reps, outside the moderate range for a young client (${YOUTH_REP_LOW} to ${YOUTH_REP_HIGH}). Worth a look.`);
    }
    return next;
  });
  if (rows.some((r, i) => r.rpe !== out[i].rpe)) flags.push(`Effort was lowered to RPE ${YOUTH_RPE_CAP} where it was higher, because this client is under 18 or has no birthdate on file.`);
  return { rows: out, flags };
}
