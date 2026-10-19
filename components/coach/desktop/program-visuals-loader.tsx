import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReactNode } from "react";
import { computeProgramCardVisuals, type ProgramCardVisualData } from "@/lib/program-card-data";

// The program cards' little charts, streamed in (SPEED, Oct 19): the Programs page shows its list at once (the Suspense fallback is the same list without charts) and this fills the charts in when
// they are read. A server component only: `render` never leaves the server.
export async function ProgramVisualsLoader({
  supabase,
  coachId,
  programIds,
  render,
}: {
  supabase: SupabaseClient;
  coachId: string;
  programIds: string[];
  render: (visualsByProgramId: Record<string, ProgramCardVisualData>) => ReactNode;
}) {
  const visuals = await computeProgramCardVisuals(supabase, programIds, coachId);
  return <>{render(Object.fromEntries(visuals))}</>;
}
