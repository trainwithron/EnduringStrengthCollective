// "Rebuild with their requests" (a client's answers about their meal plan, audit Nov 21): the answers panel asks the meal plan builder on the same page to build again with the client's
// requests in it. One browser event, so the two parts of the page need no shared state.
export const REBUILD_WITH_REQUESTS_EVENT = "spotlight:rebuild-meal-plan";

export interface RebuildWithRequests {
  // What goes into "Favorite foods / specific requests" (comma-separated, the box's own form).
  requests: string;
}

// The requests of the answers still open, in the box's own form: each one trimmed, empty ones left out, the same request said twice kept once.
export function requestsFromAnswers(answers: { requestsText: string; status: string }[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const a of answers) {
    if (a.status !== "new") continue;
    const text = a.requestsText.trim().replace(/\s+/g, " ");
    if (!text || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    out.push(text);
  }
  return out.join(", ");
}
