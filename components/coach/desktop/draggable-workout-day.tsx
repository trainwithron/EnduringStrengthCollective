"use client";

export interface DraggedWorkoutDay {
  workoutId: string;
  label: string;
}

export const WORKOUT_DAY_DRAG_MIME = "application/x-esc-workout-day";

// calendar_workout_scheduling_and_adjustable_workspace_idea.md item 3
// (client-level flavor) — drag a specific program day onto a date in
// this one client's own calendar. Writes to the same workout_assignments
// row the existing dropdown-based AssignWorkoutForm already upserts to
// (athlete_id + scheduled_date), not workouts.scheduled_date — that
// column is the whole GROUP's shared program schedule, and overwriting
// it from inside one client's calendar would silently move every other
// client's copy of that same shared workout too.
export function DraggableWorkoutDay({
  workout,
  children,
  className,
}: {
  workout: DraggedWorkoutDay;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(WORKOUT_DAY_DRAG_MIME, JSON.stringify(workout));
        e.dataTransfer.effectAllowed = "copy";
      }}
      className={`cursor-grab active:cursor-grabbing ${className ?? ""}`}
      title="Drag onto a date to assign this workout to this client"
    >
      {children}
    </div>
  );
}
