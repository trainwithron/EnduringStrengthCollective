// Real distance-in-miles between two US ZIP codes, via the `zipcodes`
// npm package's bundled real ZIP-centroid dataset — no external
// geocoding service, no lat/lng columns to maintain, per Ron's own
// "don't make it complicated, just make it work" instruction on
// marketplace_gather_and_browse_ui_data_investigation_sept29.md.
import zipcodes from "zipcodes";

// Returns null (never 0 or a guess) when either ZIP is missing or the
// package can't resolve one — a coach with no zip_code set, or a
// prospect who didn't enter one, means "distance unknown," not "0
// miles away." Matches this codebase's established discipline
// (marketplace-coach-ranking.ts's own null-not-zero handling for a
// coach with no outcome data yet) of never faking a number that isn't
// really known.
export function computeZipDistanceMiles(zipA: string | null, zipB: string | null): number | null {
  if (!zipA || !zipB) return null;
  const miles = zipcodes.distance(zipA, zipB);
  if (miles === undefined || miles === null || Number.isNaN(miles)) return null;
  return miles;
}
