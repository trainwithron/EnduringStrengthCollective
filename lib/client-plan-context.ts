import type { SupabaseClient } from "@supabase/supabase-js";
import { GOAL_TYPE_LABELS } from "@/lib/goal-types";

// What the client said about their plan, for the program builder (Nov 23, Spotters keep up). The goal sheet tells the client "This affects the plan." (lib/goal-sheet.ts), so the
// whole-program builder, the day builder and the template picker read it for a program built for one client: the days a week they can realistically train, how hard they are
// willing to work and what got in the way before, with their main goal and smaller goals. Read as the coach (row security decides what they may see); nothing on file adds
// nothing, and a coach's own program for nobody in particular is unchanged.

export interface PlanSheet {
  days_per_week: number | null;
  work_willing: string | null;
  obstacles: string | null;
}

export interface PlanGoal {
  goal_type: string;
  custom_label: string | null;
  status: string;
  target_date: string | null;
}

export interface PlanSubGoal {
  title: string;
  status: string;
}

const MAX_ANSWER = 300;

function oneLine(text: string | null | undefined): string | null {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  return t.length > MAX_ANSWER ? `${t.slice(0, MAX_ANSWER - 3)}...` : t;
}

// The block the builder reads (pure, tested). Null when there is nothing to say.
export function clientPlanBlock(input: { sheet: PlanSheet | null; goal: PlanGoal | null; subGoals: PlanSubGoal[] }): string | null {
  const lines: string[] = [];
  const { sheet, goal } = input;
  if (goal) {
    const label = goal.goal_type === "custom" && goal.custom_label ? goal.custom_label : GOAL_TYPE_LABELS[goal.goal_type as keyof typeof GOAL_TYPE_LABELS] ?? goal.goal_type;
    lines.push(`- Main goal${goal.status === "confirmed" ? "" : " (proposed, not yet agreed)"}: ${oneLine(label)}${goal.target_date ? ` by ${goal.target_date.slice(0, 10)}` : ""}`);
  }
  const subs = input.subGoals.filter((s) => s.status === "agreed" || s.status === "proposed").map((s) => oneLine(s.title)).filter((t): t is string => !!t);
  if (subs.length > 0) lines.push(`- Smaller goals: ${subs.slice(0, 10).join("; ")}`);
  if (sheet?.days_per_week != null) lines.push(`- Days a week they can realistically train: ${sheet.days_per_week}`);
  const work = oneLine(sheet?.work_willing);
  if (work) lines.push(`- How hard they are willing to work, in their words: "${work}"`);
  const obstacles = oneLine(sheet?.obstacles);
  if (obstacles) lines.push(`- What got in the way before, in their words: "${obstacles}"`);
  if (lines.length === 0) return null;
  return (
    `What this client told their coach about the plan (their goal sheet and goals):\n${lines.join("\n")}\n` +
    `Fit the plan to this: no more training days a week than they can realistically train unless the coach's request says otherwise, a workload that matches how hard they said they will work, and a plan that avoids what got in the way before. The coach's own request always wins.`
  );
}

// The block for one client in one group, read as the signed-in coach.
export async function loadClientPlanBlock(supabase: SupabaseClient, athleteId: string | null | undefined, groupId: string | null | undefined): Promise<string | null> {
  if (!athleteId || !groupId) return null;
  const [{ data: sheet }, { data: goal }, { data: subGoals }] = await Promise.all([
    supabase.from("client_goal_sheets").select("days_per_week, work_willing, obstacles").eq("athlete_id", athleteId).eq("group_id", groupId).maybeSingle(),
    supabase
      .from("client_goals")
      .select("goal_type, custom_label, status, target_date")
      .eq("athlete_id", athleteId)
      .eq("group_id", groupId)
      .in("status", ["confirmed", "proposed"])
      // a confirmed goal before a proposed one (alphabetical), then the newest
      .order("status", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("client_sub_goals").select("title, status").eq("athlete_id", athleteId).eq("group_id", groupId).in("status", ["agreed", "proposed"]).order("created_at", { ascending: true }).limit(10),
  ]);
  return clientPlanBlock({ sheet: (sheet as PlanSheet | null) ?? null, goal: (goal as PlanGoal | null) ?? null, subGoals: (subGoals ?? []) as PlanSubGoal[] });
}
