// A child under 13 who saves their birthdate stops at a "your coach will contact your parent" screen. Until now the coach was told nothing, so the child could wait indefinitely. This decides, in plain code,
// whether the coaches of a child's groups should be told, and what to say. Pure; the server route reads the facts and writes the notices.
export interface MinorNoticeFacts {
  dateOfBirth: string | null;
  consentVerified: boolean;
  now?: Date;
}

// Under 13 on the given day, the same line the app and the database use.
export function needsConsentNotice({ dateOfBirth, consentVerified, now = new Date() }: MinorNoticeFacts): boolean {
  if (!dateOfBirth || consentVerified) return false;
  const [y, m, d] = now.toISOString().slice(0, 10).split("-");
  return dateOfBirth > `${Number(y) - 13}-${m}-${d}`;
}

export function consentNoticeBody(childName: string | null): string {
  const who = childName?.trim() || "A client";
  return `${who} is under 13 and cannot use the app until parental consent is verified. Open their profile to verify it.`;
}
