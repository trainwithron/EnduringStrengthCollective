// coach_dashboard_redesign_scoping.md — "Quiet-client nudge messages
// (resolved: V1 template drafts...)". Three pre-filled drafts spanning
// formal to casual, first-name-only (never a guessed honorific — every
// draft is editable before it goes anywhere, so a coach who wants more
// formality for one client just types it in themselves).
export interface NudgeTemplate {
  key: "formal" | "warm" | "casual";
  label: string;
  text: string;
}

export function getQuietClientNudgeTemplates(firstName: string): NudgeTemplate[] {
  return [
    {
      key: "formal",
      label: "Formal",
      text: `Hi ${firstName}, just wanted to check in and see how everything's going. If there's anything I can help with, don't hesitate to reach out.`,
    },
    {
      key: "warm",
      label: "Warm",
      text: `Hey ${firstName}, haven't seen you in a bit — just checking in. Everything okay on your end?`,
    },
    {
      key: "casual",
      label: "Casual",
      text: `Hey ${firstName}, you good?`,
    },
  ];
}
