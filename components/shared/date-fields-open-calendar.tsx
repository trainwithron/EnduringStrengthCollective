"use client";

import { useEffect } from "react";

// A click anywhere in a date box opens its calendar (Ron, Nov 19: "when i try to block time off it should pop up a calendar"). On a computer the browser's date box only
// selected the month, day or year part under the pointer, and the calendar opened only from the small icon at its right edge. One listener for every date box in the app;
// typing a date still works (the calendar opens over the box, and the keyboard keeps editing it). Draws nothing.
const OPENS_CALENDAR = new Set(["date", "datetime-local", "month", "week"]);

export function DateFieldsOpenCalendar() {
  useEffect(() => {
    function onClick(e: MouseEvent) {
      const el = e.target;
      if (!(el instanceof HTMLInputElement) || !OPENS_CALENDAR.has(el.type) || el.disabled || el.readOnly) return;
      // A phone's tap already opens its own date picker; opening it again can show it twice. Only a mouse click needs the help.
      const pointerType = (e as PointerEvent).pointerType;
      if (pointerType ? pointerType !== "mouse" : !window.matchMedia("(pointer: fine)").matches) return;
      try {
        el.showPicker?.();
      } catch {
        // Already open, or a browser that does not allow it here: the box works as before.
      }
    }
    // Capture phase, so a box inside something that stops the click still gets it.
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);
  return null;
}
