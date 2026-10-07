"use client";

import { useState } from "react";
import {
  NutritionCheckinSuggestionCard,
  type CheckinSuggestion,
} from "./nutrition-checkin-suggestion-card";

export function NutritionCheckinSuggestionsList({
  athleteId,
  groupId,
  initialSuggestions,
  todayKey,
  floorCalories = null,
  floorNote = null,
  clientName = "this client",
  ageKnown = true,
}: {
  athleteId: string;
  groupId: string;
  initialSuggestions: CheckinSuggestion[];
  todayKey: string;
  floorCalories?: number | null;
  floorNote?: string | null;
  clientName?: string;
  ageKnown?: boolean;
}) {
  const [suggestions, setSuggestions] = useState(initialSuggestions);
  if (suggestions.length === 0) return null;

  return (
    <div className="space-y-3">
      {suggestions.map((s) => (
        <NutritionCheckinSuggestionCard
          key={s.id}
          athleteId={athleteId}
          groupId={groupId}
          suggestion={s}
          todayKey={todayKey}
          floorCalories={floorCalories}
          floorNote={floorNote}
          clientName={clientName}
          ageKnown={ageKnown}
          onResolved={() => setSuggestions((prev) => prev.filter((p) => p.id !== s.id))}
        />
      ))}
    </div>
  );
}
