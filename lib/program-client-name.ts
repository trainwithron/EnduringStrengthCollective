// A program named after one of the coach's clients, built inside a shared (team or social) group, is visible to everyone in that
// group. Catch it while it is being named, so a client's name and workouts are not shown to a whole team by accident.
export interface NamedClient {
  fullName: string;
  groupId: string;
}

export function clientNameInProgramName(programName: string, clients: NamedClient[]): NamedClient | null {
  const needle = programName.trim().toLowerCase();
  if (needle.length < 3) return null;
  for (const c of clients) {
    const full = c.fullName.trim().toLowerCase();
    if (full.length >= 3 && (needle === full || needle.includes(full))) return c;
  }
  return null;
}
