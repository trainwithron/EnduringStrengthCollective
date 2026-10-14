// "Like Rob": when the coach types that a new client needs what another client needed ("similar to Rob's bad back", "same protocols as Rob Derrick", "like Rob"), the AI LOOKS at how the coach programs for
// that client (their program and saved notes) as reference for this one request. Nothing is copied or stored. Pure, so it is tested.

export interface NamedClient {
  id: string;
  fullName: string;
}

export interface LikeReference<T extends NamedClient> {
  // The text that pointed at a client ("Rob", "Rob Derrick").
  phrase: string;
  // Exactly one client matched.
  client: T | null;
  // More than one matched: the coach picks.
  options: T[];
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const LEAD = /(?:^|[^a-z])(?:like|similar to|same as|same protocols? as|same thing as|just like|as with|same restrictions? as)\s+([a-z][a-z'-]*(?:\s+[a-z][a-z'-]*)?)/i;
const POSSESSIVE = /(?:^|[^a-z])([a-z][a-z-]*(?:\s+[a-z][a-z-]*)?)'s\s+(?:protocols?|restrictions?|limits?|limitations?|bad|back|knee|shoulder|hip|injur)/i;

// Which of the coach's clients does the text point at? Never the client the work is already for (`exceptId`). First name or full name; two clients with that first name => options.
export function findLikeReference<T extends NamedClient>(text: string, clients: T[], exceptId: string | null = null): LikeReference<T> | null {
  const candidates: string[] = [];
  const lead = text.match(LEAD);
  if (lead) candidates.push(lead[1]);
  const poss = text.match(POSSESSIVE);
  if (poss) candidates.push(poss[1]);
  for (const raw of candidates) {
    // "Rob's bad back": the possessive is not part of the name.
    const words = norm(raw).replace(/'s\b/g, "").split(" ").filter(Boolean);
    // Try two words as a full name, then the first word as a first name.
    for (const n of words.length >= 2 ? [words.slice(0, 2).join(" "), words[0]] : [words[0]]) {
      if (!n) continue;
      const hits = clients.filter((c) => c.id !== exceptId && (norm(c.fullName) === n || norm(c.fullName).split(" ")[0] === n));
      if (hits.length === 1) return { phrase: n, client: hits[0], options: [] };
      if (hits.length > 1 && n.includes(" ") === false) return { phrase: n, client: null, options: hits };
      if (hits.length > 1) return { phrase: n, client: null, options: hits };
    }
  }
  return null;
}
