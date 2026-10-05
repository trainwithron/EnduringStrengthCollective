// The one client finder: type part of a name, get the best matches first. Used by the coach header's "Find a client".

export interface FinderClient {
  id: string; // the person's profile id
  fullName: string;
  groupId: string; // the group to open them in
  groupName: string | null; // shown only when it helps tell people apart (a team, not a one-on-one group named after them)
}

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

// Score: 0 = the whole name starts with the query, 1 = a word in it starts with the query, 2 = it appears inside a word. Lower is better.
function score(name: string, q: string): number | null {
  const n = fold(name);
  if (n.startsWith(q)) return 0;
  if (n.split(/[\s'-]+/).some((w) => w.startsWith(q))) return 1;
  if (n.includes(q)) return 2;
  return null;
}

export function rankClientMatches(query: string, clients: FinderClient[], limit = 8): FinderClient[] {
  const q = fold(query);
  const byName = (a: FinderClient, b: FinderClient) => a.fullName.localeCompare(b.fullName);
  if (q === "") return [...clients].sort(byName).slice(0, limit);
  return clients
    .map((c) => ({ c, s: score(c.fullName, q) }))
    .filter((x): x is { c: FinderClient; s: number } => x.s !== null)
    .sort((a, b) => a.s - b.s || byName(a.c, b.c))
    .slice(0, limit)
    .map((x) => x.c);
}

// A person who is in several of the coach's groups appears once, in the group the coach is working in if they are in it, otherwise the first.
export function dedupeClients(rows: FinderClient[], currentGroupId: string | null): FinderClient[] {
  const byId = new Map<string, FinderClient>();
  for (const r of rows) {
    const existing = byId.get(r.id);
    if (!existing || (r.groupId === currentGroupId && existing.groupId !== currentGroupId)) byId.set(r.id, r);
  }
  return [...byId.values()];
}
