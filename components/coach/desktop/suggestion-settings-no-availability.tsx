"use client";

import { useCoachNavFacts } from "@/components/coach/use-coach-type";
import { hiddenForCoach } from "@/lib/team-coach";
import { SuggestionSettings } from "@/components/coach/desktop/suggestion-settings";

export interface SuggestionPrefs {
  suggestion_mode?: string | null;
  suggestion_lead_days?: number | null;
  suggestion_lead_mode?: string | null;
  suggestion_lead_weekday?: number | null;
}

// Suggestion settings (when to be reminded that a program is ending) live on Calendar > Availability (clutter audit DK11, Nov 21). A coach for whom that tab is hidden still needs
// them, so they show here, on Settings > Account, exactly then: a team coach (the menus' own rule, lib/team-coach.ts), or where the money tabs are hidden (a team-sport group or a
// team-only organization, decided by the page and passed in as `force`). Everyone else sets them on Availability and sees nothing here.
export function SuggestionSettingsWhereNoAvailability({ coachId, force, prefs }: { coachId: string; force: boolean; prefs: SuggestionPrefs }) {
  const navFacts = useCoachNavFacts();
  if (!force && !hiddenForCoach(navFacts, "availability")) return null;
  return (
    <div className="mt-4 pt-4 border-t border-steel/15" data-suggestion-settings-account>
      <SuggestionSettings
        coachId={coachId}
        initialMode={(prefs.suggestion_mode ?? "list") as "list" | "auto_add"}
        initialLeadDays={prefs.suggestion_lead_days ?? 3}
        initialLeadMode={(prefs.suggestion_lead_mode ?? "days_before") as "days_before" | "weekday_before"}
        initialLeadWeekday={prefs.suggestion_lead_weekday ?? 5}
      />
    </div>
  );
}
