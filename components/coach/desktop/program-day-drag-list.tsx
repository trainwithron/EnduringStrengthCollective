"use client";

import type { WorkoutOption } from "./assign-workout-form";
import { DraggableWorkoutDay } from "./draggable-workout-day";

// calendar_workout_scheduling_and_adjustable_workspace_idea.md item 3 —
// the drag source for the client calendar's day-drop targets
// (client-calendar-grid.tsx). Same workoutOptions list the existing
// dropdown-based AssignWorkoutForm already offers, just also draggable —
// picking a day here and dropping it onto a date is equivalent to
// opening that date and choosing it from the dropdown, just faster for
// a coach laying out several weeks at once.
export function ProgramDayDragList({ options }: { options: WorkoutOption[] }) {
  if (options.length === 0) return null;

  return (
    <div className="border border-steel/20 bg-surface p-4">
      <h3 className="font-body text-xs text-steel uppercase tracking-wide mb-2">
        Drag a day onto the calendar
      </h3>
      <p className="font-body text-[11px] text-steel mb-3">
        Assigns that workout to this client on whatever date you drop it on.
      </p>
      <div className="max-h-64 overflow-y-auto space-y-1">
        {options.map((o) => (
          <DraggableWorkoutDay key={o.id} workout={{ workoutId: o.id, label: o.label }}>
            <div className="font-body text-xs text-chalk border border-steel/20 bg-graphite px-2.5 py-2 truncate hover:border-rust/50 transition-colors">
              {o.label}
            </div>
          </DraggableWorkoutDay>
        ))}
      </div>
    </div>
  );
}
