// "Clients assigned to this program" (the popover on the program's label at the top of the builder): every client whose own copy was made from this program, plus the members of the group it
// is assigned to. Name only. A client with a copy opens that copy; a member with no copy opens their profile. Each client once, A to Z.
export interface AssignedClient {
  id: string;
  name: string;
  href: string;
}

export function assignedClients(args: {
  groupId: string;
  copies: { programId: string; groupId: string; athleteId: string; name: string | null }[];
  members: { id: string; name: string | null }[];
}): AssignedClient[] {
  const byId = new Map<string, AssignedClient>();
  for (const c of args.copies) {
    if (!byId.has(c.athleteId)) byId.set(c.athleteId, { id: c.athleteId, name: c.name?.trim() || "Client", href: `/groups/${c.groupId}/programs/${c.programId}` });
  }
  for (const m of args.members) {
    if (!byId.has(m.id)) byId.set(m.id, { id: m.id, name: m.name?.trim() || "Client", href: `/groups/${args.groupId}/athletes/${m.id}` });
  }
  return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
}
