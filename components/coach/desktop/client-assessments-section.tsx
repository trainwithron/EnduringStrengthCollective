import { createServerClient } from "@/lib/supabase/server";
import { ClientAssessments, type AssessmentRow } from "@/components/coach/desktop/client-assessments";

// The coach's own assessments for one client (Forms and notes). Only the coaches of the client's group can read them; before the database update that adds them is applied the lookup simply
// returns nothing and the section shows the empty form.
export async function ClientAssessmentsSection({ groupId, athleteId }: { groupId: string; athleteId: string }) {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("client_assessments")
    .select("id, title, notes, measurements, file_path, file_name, created_at")
    .eq("group_id", groupId)
    .eq("athlete_id", athleteId)
    .order("created_at", { ascending: false });
  const rows: AssessmentRow[] = ((data ?? []) as any[]).map((r) => ({
    id: r.id,
    title: r.title,
    notes: r.notes ?? "",
    measurements: r.measurements ?? "",
    filePath: r.file_path ?? null,
    fileName: r.file_name ?? null,
    createdAt: r.created_at,
  }));
  return <ClientAssessments groupId={groupId} athleteId={athleteId} initial={rows} />;
}
