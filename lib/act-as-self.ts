import { createBrowserClient } from "@/lib/supabase/client";

// feature_redundancy_and_could_work_better_audit_sept29.md — the "Log My
// Own Workout" act-as-self POST was hand-duplicated in both
// spot-clients-groups-panel.tsx and view-as-client-picker.tsx (same real
// behavior, written twice). One shared action, both callers keep their
// own picker UI/state.
export async function actAsSelfInGroup(groupId: string): Promise<void> {
  const supabase = createBrowserClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  await fetch("/api/coach/act-as", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ athleteId: user.id, groupId }),
  });
}
