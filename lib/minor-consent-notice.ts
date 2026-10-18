// A child under 13 who saves their birthdate is stopped: the app is for people 13 and older, and no consent lets them in. The coach is told once a week at most, so they know why the child is not training. This
// decides, in plain code, whether the coaches of a child's groups should be told, and what to say. Pure; the server route reads the facts and writes the notices.
export interface MinorNoticeFacts {
  dateOfBirth: string | null;
  // No longer matters (nothing a parent or coach does lets a child under 13 in); kept so older callers still compile.
  consentVerified?: boolean;
  now?: Date;
}

// Under 13 on the given day, the same line the app and the database use.
export function needsConsentNotice({ dateOfBirth, now = new Date() }: MinorNoticeFacts): boolean {
  if (!dateOfBirth) return false;
  const [y, m, d] = now.toISOString().slice(0, 10).split("-");
  return dateOfBirth > `${Number(y) - 13}-${m}-${d}`;
}

export function consentNoticeBody(childName: string | null): string {
  const who = childName?.trim() || "A client";
  return `${who} is under 13, so they cannot use the app: Spotlight Coaching is for people 13 and older.`;
}
