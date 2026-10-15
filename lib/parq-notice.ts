// The one-line health screening notice on a client's Overview (release CF). Shown while the number of flagged answers is higher than the number the coach last acknowledged; nothing acknowledged yet
// counts as zero, so a new flagged answer always brings the line back, and an acknowledged one stays gone.
export function parqNoticeNeeded(flagged: number, acknowledgedCount: number | null | undefined): boolean {
  return flagged > (acknowledgedCount ?? 0);
}
