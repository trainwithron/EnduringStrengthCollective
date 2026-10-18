// Report and block in the group feed (Release CM1). The rules, kept in one place so the feed, the comments and the Settings list say the same thing.
//   Block   a member stops seeing another member's posts and comments. Nobody is told, and it changes nothing for anyone else. It is undone from Settings.
//   Report  any member can report a post or comment in their group with a reason; the group's coaches are told and decide. The person reported never learns who reported.
export const REPORT_REASON_MAX = 500;

export const BLOCK_CONFIRM = (name: string) =>
  `Block ${name}? You will no longer see their posts or comments. They are not told. You can undo this any time in Settings.`;
export const REPORTED_THANKS = "Reported. A coach will take a look. Thank you.";

// Leaves out what a blocked member wrote. Works on anything with an author id (a feed post, a comment row).
export function withoutBlocked<T>(items: T[], blocked: ReadonlySet<string>, authorIdOf: (item: T) => string | null | undefined): T[] {
  if (blocked.size === 0) return items;
  return items.filter((item) => {
    const id = authorIdOf(item);
    return !id || !blocked.has(id);
  });
}

// A short name for the buttons ("Block Sam"): the first word, or a plain fallback.
export function firstNameOf(fullName: string | null | undefined): string {
  return (fullName ?? "").trim().split(/\s+/)[0] || "this member";
}
