// Reads of "the people on this organization's team" that leave out a coach who is leaving (migration 0396). The first try filters on the new column; a database that does not have it yet answers with an error, and the
// same read is made again without the filter (before the paste nobody is leaving, so the answer is the same).
export async function readStayingMembers<T = any>(run: (excludeLeaving: boolean) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<{ data: T[] | null; error: { message: string } | null }> {
  const first = await run(true);
  if (!first.error) return first;
  // Only a database that does not have the column yet is answered without the filter; any other failure is reported, never read as "everyone".
  const missingColumn = (first.error as { code?: string }).code === "42703" || /departing_since/i.test(first.error.message) || /column .* does not exist/i.test(first.error.message);
  return missingColumn ? run(false) : first;
}
