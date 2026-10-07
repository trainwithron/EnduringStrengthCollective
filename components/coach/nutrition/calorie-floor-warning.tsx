import { belowFloorMessage, isBelowFloor } from "@/lib/calorie-floor";

// An amber line under a calorie target that is below the client's estimated floor. It is a warning only: it never blocks a save and never changes a number.
export function CalorieFloorWarning({
  calories,
  floor,
  who,
}: {
  calories: number | null | undefined;
  floor: number | null;
  who: string;
}) {
  if (floor == null || calories == null || !isBelowFloor(calories, floor)) return null;
  return (
    <p role="status" className="font-body text-xs text-amber-400 border border-amber-400/40 bg-amber-400/5 px-2 py-1.5">
      {belowFloorMessage(calories, floor, who)}
    </p>
  );
}
