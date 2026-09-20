// Spotter confirm/deny/edit feedback loop
// (spotter_feedback_learning_loop_research_sept19.md, Part 3). A plain
// minimum-sample majority rule, deliberately NOT a Wilson-score bound —
// this is one coach's own repeated reaction to one recommendation type,
// not a comparative ranking across many items (Wilson's real use case).
export interface SpotterFeedbackEvent {
  action: "confirmed" | "denied" | "edited";
}

export interface StopSuggestingThreshold {
  sampleSize: number;
  majorityThreshold: number;
}

export const DEFAULT_STOP_SUGGESTING_THRESHOLD: StopSuggestingThreshold = {
  sampleSize: 5,
  majorityThreshold: 3,
};

// `events` must already be the coach's most recent events for this
// (spotter_kind, dismissal_key), sorted newest-first. Only the first
// `sampleSize` are considered — an older 6th event never dilutes a real,
// recent pattern.
export function shouldPromptStopSuggesting(
  events: SpotterFeedbackEvent[],
  threshold: StopSuggestingThreshold = DEFAULT_STOP_SUGGESTING_THRESHOLD
): boolean {
  const recent = events.slice(0, threshold.sampleSize);
  if (recent.length < threshold.sampleSize) return false;
  const negativeCount = recent.filter((e) => e.action === "denied" || e.action === "edited").length;
  return negativeCount >= threshold.majorityThreshold;
}
