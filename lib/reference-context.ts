import type { SupabaseClient } from "@supabase/supabase-js";
import { loadApplicableRules, linesFor } from "@/lib/learned-for-prompt";
import { loadClientNotes } from "@/lib/client-notes-server";

// "Like Rob": the AI LOOKS at how the coach programs for another of their clients and uses it as REFERENCE for this one request. Nothing is copied or stored on anyone: the reference client's saved
// notes, the coach's rules that apply to them and an outline of their current program are put in the prompt, under the safety rules, and gone after the request. Only the coach's own client, inside the same
// organization as the work.

const MAX_DAYS = 12;
const MAX_EXERCISES = 8;

export function outlineLines(days: { week: number; day: number; title: string; exercises: string[] }[]): string[] {
  return days.slice(0, MAX_DAYS).map((d) => `Week ${d.week}, Day ${d.day} (${d.title}): ${d.exercises.slice(0, MAX_EXERCISES).join("; ") || "no exercises"}`);
}

export function referenceBlock(firstName: string, parts: { notes: string[]; rules: string[]; outline: string[] }): string | null {
  if (parts.notes.length + parts.rules.length + parts.outline.length === 0) return null;
  const sections = [
    `Reference, for this request only: how this coach programs for ${firstName}. Use it as a guide to what this coach keeps and avoids for a client in a similar situation, adapted to the person this request is for. Do not copy it blindly. The safety, injury and youth rules above always win.`,
    parts.notes.length > 0 ? `What the coach has told you about ${firstName}:\n${parts.notes.map((n) => `- ${n}`).join("\n")}` : "",
    parts.rules.length > 0 ? `The coach's rules that apply to ${firstName}:\n${parts.rules.map((n) => `- ${n}`).join("\n")}` : "",
    parts.outline.length > 0 ? `${firstName}'s current program:\n${parts.outline.join("\n")}` : "",
  ].filter(Boolean);
  return sections.join("\n\n");
}

export async function loadReferenceBlock(supabase: SupabaseClient, coachId: string, referenceId: string | null, contextGroupId: string): Promise<string | null> {
  if (!referenceId) return null;
  try {
    // Same organization only, and the coach must coach the group the reference client is in.
    const { data: here } = await supabase.from("groups").select("organization_id").eq("id", contextGroupId).maybeSingle();
    const orgId = (here as { organization_id?: string | null } | null)?.organization_id ?? null;
    const { data: seats } = await supabase.from("group_memberships").select("group_id").eq("profile_id", referenceId);
    const refGroupIds = ((seats ?? []) as { group_id: string }[]).map((s) => s.group_id);
    if (refGroupIds.length === 0) return null;
    const { data: groups } = await supabase.from("groups").select("id, organization_id").in("id", refGroupIds);
    const inOrg = ((groups ?? []) as { id: string; organization_id: string | null }[]).filter((g) => g.organization_id === orgId).map((g) => g.id);
    if (inOrg.length === 0) return null;
    const { data: coachSeats } = await supabase.from("group_memberships").select("group_id").eq("profile_id", coachId).eq("role", "coach").in("group_id", inOrg);
    const allowed = ((coachSeats ?? []) as { group_id: string }[]).map((s) => s.group_id);
    if (allowed.length === 0) return null;

    const [{ data: ref }, notes, rules, { data: programs }] = await Promise.all([
      supabase.from("profiles").select("full_name").eq("id", referenceId).maybeSingle(),
      loadClientNotes(supabase, coachId, referenceId),
      loadApplicableRules(supabase, coachId, referenceId),
      supabase.from("programs").select("id").eq("athlete_id", referenceId).in("group_id", allowed).eq("is_active", true).limit(2),
    ]);
    const programIds = ((programs ?? []) as { id: string }[]).map((p) => p.id);
    const { data: workouts } = programIds.length
      ? await supabase
          .from("workouts")
          .select("title, week_number, day_index, group_workout_exercises ( exercise_name, exercise_order )")
          .in("program_id", programIds)
          .order("week_number", { ascending: true })
          .order("day_index", { ascending: true })
          .limit(MAX_DAYS * 2)
      : { data: [] as any[] };
    const days = ((workouts ?? []) as any[]).map((w) => ({
      week: w.week_number as number,
      day: w.day_index as number,
      title: (w.title as string) ?? "",
      exercises: ((w.group_workout_exercises ?? []) as { exercise_name: string; exercise_order: number }[]).slice().sort((a, b) => a.exercise_order - b.exercise_order).map((e) => e.exercise_name),
    }));
    const first = (((ref as { full_name?: string | null } | null)?.full_name ?? "").trim().split(/\s+/)[0] as string | undefined) || "that client";
    return referenceBlock(first, { notes: notes.bullets.map((b) => b.text), rules: linesFor(rules), outline: outlineLines(days) });
  } catch {
    return null;
  }
}
