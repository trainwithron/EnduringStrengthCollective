"use client";

import { useEffect, useState } from "react";
import type { LoggedByExercise } from "@/lib/day-logged";

// For the coach's builder, on a CLIENT'S OWN program: what the client logged on one day (a day already done) or the gray weight suggestions for a day not done yet. Read on demand when
// a day is open, one day at a time, so a long program never loads every logged set. Nothing is read for a shared group program (no single client) or a closed day.
export function useDayLogged(workoutId: string, enabled: boolean): { logged: LoggedByExercise; suggestions: Record<string, number> } {
  const [state, setState] = useState<{ logged: LoggedByExercise; suggestions: Record<string, number> }>({ logged: {}, suggestions: {} });

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/coach/day-logged?workoutId=${encodeURIComponent(workoutId)}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setState({ logged: data.logged ?? {}, suggestions: data.suggestions ?? {} });
      } catch {
        // Soft: the builder simply shows the prescription, as before.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workoutId, enabled]);

  return state;
}
