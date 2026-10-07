// The coach's drafted replies to a client's schedule request (pause, freeze or cancel). The coach reads and edits the text in the message box; nothing is sent for them.
// Warm, short, specific, and never about money or guilt. The drafts are fixed wording: they never read the client's private note (it can be very personal), and no AI is
// involved. Dates arrive already written for the schedule's own time zone ("Nov 3"); this file never works out a date.
export type ScheduleRequestKind = "pause" | "freeze" | "cancel";

export interface ReplyDraftInput {
  firstName: string;
  kind: ScheduleRequestKind;
  // The last day the schedule runs, written for people ("Nov 3").
  effectiveLabel: string;
  // Freeze only: the first day back ("Dec 1").
  resumeLabel?: string | null;
}

const nameOf = (firstName: string) => firstName.trim() || "there";

// A reply that confirms what the client asked for.
export function buildScheduleReplyDraft(input: ReplyDraftInput): string {
  const name = nameOf(input.firstName);
  switch (input.kind) {
    case "pause":
      return `Hi ${name}, thank you for letting me know. Your weekly sessions will pause after ${input.effectiveLabel}. Take the time you need, and tell me whenever you'd like to start again. I'm here when you are.`;
    case "freeze":
      return `Hi ${name}, thank you for letting me know. Your weekly sessions will freeze after ${input.effectiveLabel} and start again on ${input.resumeLabel ?? "the day we agreed"}. I'll have your times back on the calendar then. Take care until then.`;
    case "cancel":
      return `Hi ${name}, thank you for telling me, and for the time we've trained together. Your weekly sessions will end after ${input.effectiveLabel}. If anything changes, you're always welcome back.`;
  }
}

// For a client who asked to cancel: an offer to pause or freeze instead, only if the coach chooses to send it.
export function buildOfferPauseOrFreezeDraft(firstName: string): string {
  const name = nameOf(firstName);
  return `Hi ${name}, I saw your request and I'm glad you told me. Before we end your weekly sessions, would a pause or a freeze fit better? A pause holds your spot until you're ready, and a freeze starts again on a date you pick. Whatever you choose is fine with me. Want to talk it through?`;
}

// For a client who asked for a pause or freeze and the coach wants to check in first.
export function buildCheckInDraft(firstName: string): string {
  const name = nameOf(firstName);
  return `Hi ${name}, I got your request and wanted to check in first. How are you doing? Tell me what would help and we'll sort out your schedule together.`;
}
