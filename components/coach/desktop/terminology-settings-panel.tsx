"use client";

import { SwappableTerm } from "@/components/coach/swappable-term";
import { TERM_LABELS, type TermKey } from "@/lib/terminology";

// coach_terminology_word_swap_system_idea.md's canonical discovery home —
// reuses SwappableTerm as the actual control (same click-a-word mechanic
// already live everywhere else) rather than a separate dropdown
// implementation, so there's exactly one place this logic lives.
const TERM_ORDER: TermKey[] = ["client", "group", "coach", "session", "roster", "program"];

const TERM_DESCRIPTIONS: Record<TermKey, string> = {
  client: "The people you coach — nav labels, client-profile headers, roster lists.",
  group: "The container a client or team belongs to — nav and group pickers.",
  coach: "What you and your staff are called throughout the app.",
  session: "A single completed workout — client profile, feed, and dashboard.",
  roster: "Your full list of clients or athletes for one group.",
  program: "A multi-week training plan assigned to a client or group.",
};

export function TerminologySettingsPanel() {
  return (
    <div className="max-w-[70ch]">
      <p className="font-body text-sm text-steel mb-6">
        This app defaults to personal-trainer language (&quot;clients,&quot; &quot;sessions&quot;) —
        click any word below to change it everywhere it appears: nav, client profiles, Program
        Builder, the Business dashboard. Applies coach-wide, not just here.
      </p>
      <div className="space-y-4">
        {TERM_ORDER.map((key) => (
          <div
            key={key}
            className="flex items-center justify-between gap-4 border-b border-steel/10 pb-4"
          >
            <div>
              <p className="font-body text-sm font-medium text-chalk">{TERM_LABELS[key]}</p>
              <p className="font-body text-xs text-steel mt-0.5">{TERM_DESCRIPTIONS[key]}</p>
            </div>
            <div className="font-display text-lg uppercase shrink-0">
              <SwappableTerm termKey={key} form="plural" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
