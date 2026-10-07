import { belowFloorMessage, isBelowFloor } from "@/lib/calorie-floor";

// An amber line under a calorie target that is below the client's estimated floor. It is a warning only: it never blocks a save and never changes a number.
export function CalorieFloorWarning({
  calories,
  floor,
  who,
  note = null,
}: {
  calories: number | null | undefined;
  floor: number | null;
  who: string;
  // What the floor rests on (an old weight, or inputs that are missing), shown with the warning.
  note?: string | null;
}) {
  if (floor == null || calories == null || !isBelowFloor(calories, floor)) return null;
  return (
    <p role="status" className="font-body text-xs text-amber-400 border border-amber-400/40 bg-amber-400/5 px-2 py-1.5">
      {belowFloorMessage(calories, floor, who)}
      {note && <span className="block text-amber-400/80 mt-0.5">{note}</span>}
    </p>
  );
}
