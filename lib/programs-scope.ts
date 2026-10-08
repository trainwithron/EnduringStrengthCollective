// Which programs the Programs page shows (pure). By default the coach sees ALL of their programs, whichever group or client each belongs to. The page is scoped to one client only when the
// address says so (?client=), which is what a client's own Programs tab links to; nothing about the scope is remembered anywhere, so it can never stick after the coach moves on.

export interface ScopablePrograms {
  athleteId: string | null;
}

// The client id from the address, or null for "everyone". Only a plain id is accepted.
export function clientFromSearch(value: string | string[] | null | undefined): string | null {
  const v = Array.isArray(value) ? value[0] : value;
  return typeof v === "string" && /^[0-9a-f-]{8,64}$/i.test(v) ? v : null;
}

// All programs, or only the personal ones of the named client. (A shared group program has no client, so it is not in a client's list.)
export function scopePrograms<T extends ScopablePrograms>(programs: T[], clientId: string | null): T[] {
  return clientId ? programs.filter((p) => p.athleteId === clientId) : programs;
}

export const ALL_PROGRAMS_HREF = "/programs";

// The address of the page scoped to one client, and the plain one that clears the scope.
export const programsHrefForClient = (clientId: string): string => `${ALL_PROGRAMS_HREF}?client=${encodeURIComponent(clientId)}`;
