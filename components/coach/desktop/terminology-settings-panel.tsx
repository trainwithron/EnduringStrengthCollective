"use client";

import { SwappableTerm } from "@/components/coach/swappable-term";
import { TerminologyChooser } from "@/components/coach/desktop/terminology-chooser";
import { TERM_LABELS, type TermKey } from "@/lib/terminology";

// The home of the vocabulary choice (Ron, Oct 6): the word for the people a coach coaches is picked in plain buttons at the top ("What do you call your
// people?"), and every other word group can be changed in the list below. These are the only places a word is clickable; everywhere else a swapped word reads
// as ordinary text.
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
      <h2 className="font-body text-sm font-medium text-chalk mb-2">What do you call your people?</h2>
      <div className="mb-8">
        <TerminologyChooser />
      </div>
      <p className="font-body text-sm text-steel mb-6">
        Other words: the app defaults to personal coaching language (&quot;sessions,&quot; &quot;programs&quot;). Click a word below to change it everywhere it appears, coach-wide.
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
              <SwappableTerm termKey={key} form="plural" editable cap />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
