// Whether a failed read is a real failure ("Couldn't load this. Try again.") or just a not-found. A malformed id in the address (a stale link, /groups/undefined/...) makes the database answer 22P02 (invalid input
// syntax for a uuid), and a single-row read that finds nothing answers PGRST116: both mean "there is nothing here", which the page shows as its no-access or not-available message, not as a retry that can never work.
const NOT_A_FAILURE = new Set(["22P02", "PGRST116"]);

export function isReadFailure(error: { code?: string } | null | undefined): boolean {
  if (!error) return false;
  return !(error.code && NOT_A_FAILURE.has(error.code));
}
