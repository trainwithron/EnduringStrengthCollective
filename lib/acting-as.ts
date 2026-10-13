import { cookies } from "next/headers";
import { prefersAthleteStyleView } from "@/lib/pwa-server";
import { createServerClient } from "@/lib/supabase/server";

export const ACTING_AS_COOKIE = "acting_as_athlete";
// Readable by the page's own script: set while a coach is in THEIR OWN client app ("My training"), so the bar says that instead of "Viewing as someone".
export const ACTING_AS_SELF_COOKIE = "acting_as_self";

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

// The group is the signed-in person's own personal space: a group with no organization that they created.
async function isOwnPersonalSpace(groupId: string, userId: string): Promise<boolean> {
  try {
    const supabase = await createServerClient();
    const { data } = await supabase.from("groups").select("organization_id, created_by").eq("id", groupId).maybeSingle();
    return !!data && (data as { organization_id: string | null }).organization_id === null && (data as { created_by: string }).created_by === userId;
  } catch {
    return false;
  }
}

// Resolves "which athlete's data should this page load" for a coach who
// may be standing in a client's mobile experience. Act-as is a PHONE-only
// tool (it is how a coach logs in person for a client): outside the
// phone/mobile-mode view the cookie is ignored, so a desktop browser can
// never render the athlete mirror, whatever cookie is lying around. The cookie only ever
// changes *which id a page queries with* — every read/write still goes
// through the same RLS policies (coach-or-self) that already govern this
// data, so a stale or forged cookie value just yields empty results, not
// a security hole.
export async function getEffectiveAthlete(
  groupId: string,
  realUserId: string
): Promise<EffectiveAthlete> {
  if (!(await prefersAthleteStyleView())) {
    return { athleteId: realUserId, realUserId, isActingAsOther: false };
  }
  const cookieStore = await cookies();
  const raw = cookieStore.get(ACTING_AS_COOKIE)?.value;
  const resolved = resolveActingAs(raw, groupId, realUserId);
  if (resolved.isActingAsOther) return resolved;
  // A coach's OWN personal space (his own training, no organization) is always his client app, as himself, on the phone, with or without the act-as setting. The setting is a 12 hour cookie: when
  // it ran out while the page was still open, the coach landed on the coaching Home of an empty space ("Welcome, two things get you started") instead of his own training.
  if (await isOwnPersonalSpace(groupId, realUserId)) return { athleteId: realUserId, realUserId, isActingAsOther: true };
  return resolved;
}
