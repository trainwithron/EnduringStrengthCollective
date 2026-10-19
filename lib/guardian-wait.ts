import { ageBand } from "@/lib/guardian-consent";

// A client aged 13 to 17 with no signed guardian permission is "waiting on a guardian": the coach sees a mark on the Clients list (Oct 19 audit: Sawyer S., 16, filled the whole health form, hit a dead end, and the coach was
// never told). Pure; the Clients page reads the birth dates and the signed permissions.
export function waitingOnGuardian(dateOfBirth: string | null | undefined, guardianSigned: boolean, now: Date = new Date()): boolean {
  return ageBand(dateOfBirth, now) === "teen" && !guardianSigned;
}

export const WAITING_ON_GUARDIAN_LABEL = "Waiting on a guardian";

/** The note the coach gets when a teen reaches the permission step (one per week per coach at most; lib/minor-consent-notice.ts words the under-13 one). */
export function guardianWaitNoticeBody(childName: string | null | undefined): string {
  const who = childName?.trim() || "A client";
  return `${who} is under 18 and needs a parent or guardian's OK before starting. They are asked for it on their screen; you can send it again from their profile.`;
}
