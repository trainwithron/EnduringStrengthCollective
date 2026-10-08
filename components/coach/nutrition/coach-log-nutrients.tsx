import { createServerClient } from "@/lib/supabase/server";
import { LogNutrients } from "@/components/nutrition/log-nutrients";
import { fetchAgeAndSex, fetchNutrientLog } from "@/lib/nutrient-data";
import { pastDaysFor } from "@/lib/nutrient-view";

// The coach's side of vitamins and minerals, inside "What they ate": the same compact list the client sees with their log (today's figures, the few that matter, every nutrient one tap
// away, a nutrient's detail opening over the page), read for this client with the coach's own access. Server-fed; nothing here is sent to the AI.
export async function CoachLogNutrients({ groupId, athleteId, todayKey, clientName }: { groupId: string; athleteId: string; todayKey: string; clientName: string }) {
  const supabase = await createServerClient();
  const [{ entries, truncated }, { age, sex }] = await Promise.all([fetchNutrientLog(supabase, athleteId, todayKey), fetchAgeAndSex(supabase, athleteId, todayKey)]);
  return (
    <LogNutrients
      groupId={groupId}
      athleteId={athleteId}
      todayKey={todayKey}
      pastDays={pastDaysFor(entries, todayKey)}
      age={age}
      sex={sex}
      entries={entries.filter((e) => e.logDate === todayKey)}
      audience="coach"
      clientName={clientName}
      partialLog={truncated}
    />
  );
}
