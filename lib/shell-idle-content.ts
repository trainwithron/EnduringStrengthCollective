// Empty-state content for the coach-desktop-shell's pinned "Needs
// attention" strip on a zero-flag day (coach_desktop_shell_identity_
// redesign.md, item 6). Ron's own framing: don't show blank space —
// rotate something "positive and relevant" instead. Same governing
// principle as coach_ease_of_use_design_principle.md's idle-time
// framework and the same coach-note-first/generic-fallback delivery
// shape already used for exercise-note-callout.tsx — this is the
// fallback-only half (there's no per-slot "coach note" equivalent here,
// every entry is a real, useful default).

import { LOADING_TIPS } from "@/lib/loading-tips";

export type IdleSlotCategory = "business_tip" | "fun_fact" | "revenue_idea" | "coach_training_nudge" | "client_win";

export interface IdleSlotEntry {
  id: string;
  category: IdleSlotCategory;
  text: string;
}

// Business tips and revenue-growth ideas — real, concrete, not filler.
// The natural home for collective_intelligence_business_growth_tips_idea
// once that's built out further; this is a real starter set, not a
// placeholder.
const BUSINESS_TIPS: IdleSlotEntry[] = [
  {
    id: "tip-referral-ask",
    category: "business_tip",
    text: "Clients who've hit a real PR in the last 2 weeks are your best referral ask — the win is fresh and they're already telling people about it.",
  },
  {
    id: "tip-checkin-cadence",
    category: "business_tip",
    text: "A quick weekly check-in message (even one line) is one of the cheapest retention levers you have — silence is what makes a client quietly cancel.",
  },
  {
    id: "tip-package-review",
    category: "business_tip",
    text: "Worth a periodic glance at your Packages page — a rate that hasn't changed in a year probably should, especially for anyone who's been with you a while.",
  },
];

const REVENUE_IDEAS: IdleSlotEntry[] = [
  {
    id: "revenue-referral-partner",
    category: "revenue_idea",
    text: "Consider inviting your most consistent clients to your Training Partner directory — a client who brags about their coach to a workout partner is a warm lead you didn't have to chase.",
  },
  {
    id: "revenue-pro-shop",
    category: "revenue_idea",
    text: "If your Pro Shop links haven't been updated recently, a seasonal refresh (new gear, a program-specific recommendation) can be worth revisiting.",
  },
  {
    id: "revenue-discovery-calls",
    category: "revenue_idea",
    text: "Discovery calls convert best when they're booked off a real referral, not cold — worth mentioning them explicitly the next time a client says a friend's interested.",
  },
];

const COACH_TRAINING_NUDGES: IdleSlotEntry[] = [
  {
    id: "nudge-own-training",
    category: "coach_training_nudge",
    text: "When's the last time you logged your own training? Coaches who stay in their own program tend to notice things in a client's form cues faster.",
  },
  {
    id: "nudge-own-recovery",
    category: "coach_training_nudge",
    text: "If today's a quiet one, it's a fair day to check your own recovery — sleep, soreness, energy — the same three things you ask your clients about.",
  },
];

export interface IdleSlotContent {
  category: IdleSlotCategory;
  text: string;
}

// Reuses the same real, cited biomechanics facts already shipped for the
// athlete-facing loading screens (lib/loading-tips.ts) — a coach seeing
// "did you know" content is the same delivery shape already proven
// elsewhere in this app, not a new content type invented for this strip.
function funFactEntries(): IdleSlotContent[] {
  return LOADING_TIPS.map((t) => ({ category: "fun_fact" as const, text: t.text }));
}

// One deterministic-per-day-per-coach pick across all five categories —
// stable within a day (doesn't flicker between reloads), varied across
// days. Client-win/shoutout content is intentionally NOT generated here:
// it needs a real recent win to be genuine (per Ron's own "something
// positive and relevant... about their own workout" framing), so that
// category is populated by the caller from real data when one exists,
// and this pool is only ever the fallback once no real win is available.
export function pickIdleSlotContent(seed: string): IdleSlotContent {
  const pool: IdleSlotContent[] = [
    ...BUSINESS_TIPS.map((t) => ({ category: t.category, text: t.text })),
    ...REVENUE_IDEAS.map((t) => ({ category: t.category, text: t.text })),
    ...COACH_TRAINING_NUDGES.map((t) => ({ category: t.category, text: t.text })),
    ...funFactEntries(),
  ];
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return pool[hash % pool.length];
}
