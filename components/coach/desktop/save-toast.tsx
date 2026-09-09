"use client";

import { useEffect, useRef, useState } from "react";
import { subscribeSaveToast } from "@/lib/save-toast";

// Every edit in the Program Builder auto-persists with no button to
// press — this is the only positive confirmation a coach gets that a
// change actually saved, instead of silence on success and text only on
// failure. Flashes briefly in the corner on every successful persist,
// coalescing rapid-fire edits (e.g. tabbing through several set fields)
// into one visible pulse instead of a flicker per field.
export function SaveToast() {
  const [visible, setVisible] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return subscribeSaveToast(() => {
      setVisible(true);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => setVisible(false), 1400);
    });
  }, []);

  return (
    <div
      className={`fixed bottom-5 right-5 z-40 bg-positive text-graphite font-body text-xs font-medium px-3 py-2 shadow-lg transition-opacity duration-200 ${
        visible ? "opacity-100" : "opacity-0 pointer-events-none"
      }`}
    >
      Saved
    </div>
  );
}
