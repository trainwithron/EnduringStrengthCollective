// Reasons a visitor can give when reporting a demo video on a public scan page (Ron, Nov 20, S4). Kept in step with video_reports.reason (step 211).
export const REPORT_REASONS = ["not_agreed", "minor", "copyright", "unsafe", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

const LABELS: Record<ReportReason, string> = {
  not_agreed: "Someone in it didn't agree to be shown",
  minor: "It shows someone under 18",
  copyright: "It's someone else's video or music",
  unsafe: "The technique is unsafe",
  other: "Something else",
};

// What a coach is told when the database's age rule refuses a video of a client (Ron, Nov 20, S3: step 211's minor_subject_ok).
export const MINOR_VIDEO_REFUSED =
  "This client may be under 18: there is no date of birth showing they are an adult, and no parent consent on file. Ask them to add their date of birth in their app, or record the parent's OK on their profile, then try again. Under 13, never.";

export function reportReasonLabel(reason: string): string {
  return (LABELS as Record<string, string>)[reason] ?? "Something else";
}
