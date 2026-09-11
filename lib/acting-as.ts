import { cookies } from "next/headers";

export const ACTING_AS_COOKIE = "acting_as_athlete";

export interface EffectiveAthlete {
  athleteId: string;
  realUserId: string;
  isActingAsOther: boolean;
}

// Pure decision logic, split out from the cookies() read below so it's
// unit-testable without mocking Next.js internals — a stale/malformed/
// wrong-group cookie value must always fall back to the real user, never
// throw or silently resolve to someone else's data.
export function resolveActingAs(
  rawCookieValue: string | null | undefined,
  groupId: string,
  realUserId: string
): EffectiveAthlete {
  if (!rawCookieValue) {
    return { athleteId: realUserId, realUserId, isActingAsOther: false };
  }

  try {
    const parsed = JSON.parse(rawCookieValue) as { athleteId?: string; groupId?: string };
    if (parsed.athleteId && parsed.groupId === groupId) {
      return { athleteId: parsed.athleteId, realUserId, isActingAsOther: true };
    }
  } catch {
    // Malformed cookie — fall through to the real user.
  }

  return { athleteId: realUserId, realUserId, isActingAsOther: false };
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
  return resolveActingAs(raw, groupId, realUserId);
}
