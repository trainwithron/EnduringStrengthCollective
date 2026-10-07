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
  clientName = "this client",
}: {
  athleteId: string;
  groupId: string;
  initialSuggestions: CheckinSuggestion[];
  todayKey: string;
  floorCalories?: number | null;
  clientName?: string;
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
          clientName={clientName}
          onResolved={() => setSuggestions((prev) => prev.filter((p) => p.id !== s.id))}
        />
      ))}
    </div>
  );
}
