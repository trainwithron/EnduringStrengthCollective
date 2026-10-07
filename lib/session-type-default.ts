// A client's usual session type, worked out from what already exists instead of a new setting (Ron, Oct 6: "whatever type of session the client has just
// populates automatically"). In order: the type of the client's most recent session that had one (changing it on one booking therefore changes what comes next,
// which is the one-tap edit); else, when the coach has exactly one type that fits the client's tier (an Online client and a single Online type), that one;
// else none. Never invents a type, and never touches a session's cost.

export interface TypeLite {
  id: string;
  name: string;
  locationKind?: "in_person" | "online" | "either" | null;
}

export type ClientTierLite = "one_on_one" | "online" | "group" | null | undefined;

export function defaultSessionTypeId(input: { lastTypeId: string | null | undefined; tier: ClientTierLite; types: TypeLite[] }): string | null {
  const { lastTypeId, tier, types } = input;
  if (lastTypeId && types.some((t) => t.id === lastTypeId)) return lastTypeId;
  const wanted = tier === "online" ? "online" : tier === "one_on_one" ? "in_person" : null;
  if (!wanted) return null;
  const fits = types.filter((t) => t.locationKind === wanted);
  return fits.length === 1 ? fits[0].id : null;
}

// The latest type per client from bookings, newest first (rows with no type are skipped).
export function lastTypeByClient(rows: { athlete_id: string; session_type_id: string | null; start_at: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  const sorted = [...rows].sort((a, b) => b.start_at.localeCompare(a.start_at));
  for (const r of sorted) {
    if (r.session_type_id && !(r.athlete_id in out)) out[r.athlete_id] = r.session_type_id;
  }
  return out;
}

// A warning, never a block: an hour the coach tagged for one type is being used for another.
export function typeMismatchWarning(input: { windowTypeId: string | null | undefined; chosenTypeId: string | null | undefined; types: TypeLite[] }): string | null {
  const { windowTypeId, chosenTypeId, types } = input;
  if (!windowTypeId || !chosenTypeId || windowTypeId === chosenTypeId) return null;
  const windowName = types.find((t) => t.id === windowTypeId)?.name;
  const chosenName = types.find((t) => t.id === chosenTypeId)?.name;
  if (!windowName || !chosenName) return null;
  return `This hour is set aside for ${windowName}, and this session is ${chosenName}. You can still book it.`;
}
