// The coach-level Clients list: every client once, with filters for how they work with the coach (1-on-1, online, group) and for the ones set aside, and a
// name search. Set-aside clients are hidden until asked for.

export type ClientFilter = "all" | "one_on_one" | "online" | "group" | "set_aside";

export interface CoachClientRow {
  id: string;
  fullName: string;
  groupId: string;
  groupName: string;
  groupKind: "one_on_one" | "social" | "team";
  tier: "one_on_one" | "online" | "group" | null;
  setAside: boolean;
  // Sessions still to schedule, and sessions already delivered beyond the balance (coach only).
  toBook: number;
  owed: number;
}

export const FILTER_LABELS: Record<ClientFilter, string> = {
  all: "All",
  one_on_one: "1-on-1",
  online: "Online",
  group: "Group",
  set_aside: "Set aside",
};

// How a client works with the coach: their tier when the coach set one, else their space (a one-on-one space is 1-on-1; a team or social group is group).
export function clientKind(c: Pick<CoachClientRow, "tier" | "groupKind">): "one_on_one" | "online" | "group" {
  if (c.tier) return c.tier;
  return c.groupKind === "one_on_one" ? "one_on_one" : "group";
}

export function filterClients(rows: CoachClientRow[], filter: ClientFilter, query: string): CoachClientRow[] {
  const q = query.trim().toLowerCase();
  return rows.filter((c) => {
    if (filter === "set_aside") {
      if (!c.setAside) return false;
    } else {
      if (c.setAside) return false;
      if (filter !== "all" && clientKind(c) !== filter) return false;
    }
    return q === "" || c.fullName.toLowerCase().includes(q);
  });
}

export function filterCounts(rows: CoachClientRow[]): Record<ClientFilter, number> {
  const counts: Record<ClientFilter, number> = { all: 0, one_on_one: 0, online: 0, group: 0, set_aside: 0 };
  for (const c of rows) {
    if (c.setAside) {
      counts.set_aside += 1;
      continue;
    }
    counts.all += 1;
    counts[clientKind(c)] += 1;
  }
  return counts;
}
