// Whether a member's numbers appear on the shared boards (the leaderboard). profiles.feed_broadcast_level is the member's own choice about what the team sees: everything ("full"), only records
// ("prs_only"), only that they checked in ("checkin_only") or nothing ("private"). Someone who chose "only that I checked in" or "nothing" is not ranked. A level that is not known counts as shared (the
// column default is "full").
export function onSharedBoards(level: string | null | undefined): boolean {
  return level !== "private" && level !== "checkin_only";
}
