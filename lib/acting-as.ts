import { cookies } from "next/headers";

export const ACTING_AS_COOKIE = "acting_as_athlete";

export interface EffectiveAthlete {
  athleteId: string;
  realUserId: string;
  isActingAsOther: boolean;
}

// Resolves "which athlete's data should this page load" for a coach who
// may be standing in a client's mobile experience. The cookie only ever
// changes *which id a page queries with* — every read/write still goes
// through the same RLS policies (coach-or-self) that already govern this
// data, so a stale or forged cookie value just yields empty results, not
// a security hole.
export async function getEffectiveAthlete(
  groupId: string,
  realUserId: string
): Promise<EffectiveAthlete> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(ACTING_AS_COOKIE)?.value;
  if (!raw) {
    return { athleteId: realUserId, realUserId, isActingAsOther: false };
  }

  try {
    const parsed = JSON.parse(raw) as { athleteId?: string; groupId?: string };
    if (parsed.athleteId && parsed.groupId === groupId) {
      return { athleteId: parsed.athleteId, realUserId, isActingAsOther: true };
    }
  } catch {
    // Malformed cookie — fall through to the real user.
  }

  return { athleteId: realUserId, realUserId, isActingAsOther: false };
}
