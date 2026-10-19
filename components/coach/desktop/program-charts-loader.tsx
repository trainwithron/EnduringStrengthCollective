"use client";

import { useEffect, useState } from "react";
import type { ProgramCardVisualData } from "@/lib/program-card-data";

// The card charts, asked for once after the Programs page has shown (SPEED, Oct 19): the page finishes with the list, and the charts appear when they arrive. A failed read just leaves the plain cards.
export function useProgramCharts(programIds: string[]): Record<string, ProgramCardVisualData> {
  const [visuals, setVisuals] = useState<Record<string, ProgramCardVisualData>>({});
  const key = programIds.join(",");
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    fetch(`/api/coach/program-charts?ids=${encodeURIComponent(key)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (!cancelled && body?.visuals) setVisuals(body.visuals as Record<string, ProgramCardVisualData>);
      })
      .catch(() => {
        // the plain cards stay
      });
    return () => {
      cancelled = true;
    };
  }, [key]);
  return visuals;
}
