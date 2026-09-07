"use client";

import { useRouter } from "next/navigation";
import { HabitDayChecklist, type DueHabit } from "./habit-day-checklist";
import { AddHabitForm } from "./add-habit-form";

export function DayHabitsPanel({
  athleteId,
  groupId,
  date,
  dueHabits,
}: {
  athleteId: string;
  groupId: string;
  date: string;
  dueHabits: DueHabit[];
}) {
  const router = useRouter();

  return (
    <div>
      <HabitDayChecklist date={date} habits={dueHabits} />
      <div className="mt-4 pt-3 border-t border-steel/15">
        <AddHabitForm athleteId={athleteId} groupId={groupId} onAdded={() => router.refresh()} />
      </div>
    </div>
  );
}
