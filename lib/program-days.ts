import type { SupabaseClient } from "@supabase/supabase-js";

// Program days (workouts) have a day number that is unique inside a week of a program (migration 0381). Adding a day or a week reads the numbers that are saved right now and takes the next free one; if two
// tabs (or a double click) take the same number at once, the database refuses the second and this reads again and retries, so nobody sees an error for a race.
export interface InsertedDay {
  id: string;
  title: string;
  week_number: number;
  day_index: number;
}

const ATTEMPTS = 4;

export async function insertProgramDay(
  supabase: SupabaseClient,
  { programId, groupId, weekNumber, title }: { programId: string; groupId: string; weekNumber: number | "next"; title: (dayIndex: number) => string }
): Promise<{ row: InsertedDay | null; error: string | null }> {
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    let week: number;
    let dayIndex: number;
    if (weekNumber === "next") {
      const { data } = await supabase.from("workouts").select("week_number").eq("program_id", programId).order("week_number", { ascending: false }).limit(1);
      const topWeek = ((data ?? [])[0] as { week_number?: number } | undefined)?.week_number;
      week = topWeek ? topWeek + 1 : 1;
      dayIndex = 1;
    } else {
      week = weekNumber;
      const { data } = await supabase.from("workouts").select("day_index").eq("program_id", programId).eq("week_number", week).order("day_index", { ascending: false }).limit(1);
      const top = ((data ?? [])[0] as { day_index?: number } | undefined)?.day_index;
      dayIndex = top ? top + 1 : 1;
    }
    const { data, error } = await supabase
      .from("workouts")
      .insert({ program_id: programId, group_id: groupId, title: title(dayIndex), week_number: week, day_index: dayIndex })
      .select("id, title, week_number, day_index")
      .single();
    if (!error && data) return { row: data as InsertedDay, error: null };
    if ((error as { code?: string } | null)?.code !== "23505") return { row: null, error: "Couldn't add that. Try again." };
  }
  return { row: null, error: "Couldn't add that just now because the program changed at the same moment. Try again." };
}

// Puts the days of one week in this order. The numbers are unique inside a week, so two days can never be given the same number at any moment: every day first moves out of the way to a number far above the
// rest, then each takes its place. If it stops half way the order is still kept (the numbers are still all different and in order).
export async function saveDayOrder(supabase: SupabaseClient, orderedDayIds: string[]): Promise<boolean> {
  const OFFSET = 1000;
  const away = await Promise.all(orderedDayIds.map((id, i) => supabase.from("workouts").update({ day_index: OFFSET + i + 1 }).eq("id", id)));
  if (away.some((r) => r.error)) return false;
  const placed = await Promise.all(orderedDayIds.map((id, i) => supabase.from("workouts").update({ day_index: i + 1 }).eq("id", id)));
  return !placed.some((r) => r.error);
}
