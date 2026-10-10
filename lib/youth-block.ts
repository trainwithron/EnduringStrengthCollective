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
