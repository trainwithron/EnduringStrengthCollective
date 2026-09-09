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
  const [state, setState] = useState<{ visible: boolean; error: string | null }>({
    visible: false,
    error: null,
  });
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return subscribeSaveToast((event) => {
      setState({ visible: true, error: event.kind === "error" ? event.message : null });
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      // Errors stay up longer — a flashed "Saved" pulse is fine to miss,
      // a silently-lost edit isn't.
      timeoutRef.current = setTimeout(
        () => setState((s) => ({ ...s, visible: false })),
        event.kind === "error" ? 5000 : 1400
      );
    });
  }, []);

  return (
    <div
      className={`fixed bottom-5 right-5 z-40 font-body text-xs font-medium px-3 py-2 shadow-lg transition-opacity duration-200 ${
        state.error ? "bg-rust text-chalk" : "bg-positive text-graphite"
      } ${state.visible ? "opacity-100" : "opacity-0 pointer-events-none"}`}
    >
      {state.error ?? "Saved"}
    </div>
  );
}
