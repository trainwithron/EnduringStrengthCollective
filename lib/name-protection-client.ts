// Browser side of the rule in lib/post-name-protection.ts: ask the server which of these people must be shown as a first name and last initial. If the answer cannot be had, everyone is protected ("*"), never the other way round.
// A long list is asked in batches of at most BATCH ids, the answers joined, and any batch that fails protects everyone.
export const BATCH = 300;

export async function fetchProtectedIds(groupId: string, ids: string[]): Promise<Set<string>> {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (unique.length === 0) return new Set();
  const out = new Set<string>();
  for (let i = 0; i < unique.length; i += BATCH) {
    try {
      const res = await fetch(`/api/groups/${groupId}/name-protection`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: unique.slice(i, i + BATCH) }) });
      if (!res.ok) return new Set(["*"]);
      const data = (await res.json()) as { protectedIds?: string[] };
      if (!Array.isArray(data.protectedIds)) return new Set(["*"]);
      for (const id of data.protectedIds) out.add(id);
    } catch {
      return new Set(["*"]);
    }
  }
  return out;
}

// A name for a notice or a mention that goes to OTHER people: the person's full name unless they must be shown as a first name and last initial.
export async function nameForOthers(groupId: string, personId: string, fullName: string): Promise<string> {
  const { shownName } = await import("@/lib/shown-name");
  return shownName(fullName, personId, await fetchProtectedIds(groupId, [personId]));
}
