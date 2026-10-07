import type { CoachedGroup } from "./coach-groups";

// Coach-level pages (Home, Clients) still need one group id to point the rail's links at. It is never shown and never a client's: the first team or social
// group by name, or, for a coach who has only one-on-one clients, one of those (by name). The page itself is the coach's, not that group's.
export function pickCoachAnchor(groups: Pick<CoachedGroup, "id" | "name" | "kind">[]): { id: string; name: string; kind: CoachedGroup["kind"] } | null {
  if (groups.length === 0) return null;
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  const shared = groups.filter((g) => g.kind !== "one_on_one").sort(byName)[0];
  const pick = shared ?? [...groups].sort(byName)[0];
  return { id: pick.id, name: pick.name, kind: pick.kind };
}
