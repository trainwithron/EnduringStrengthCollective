import type { SupabaseClient } from "@supabase/supabase-js";
import { derivedKeys, labelFor, ruleApplies } from "@/lib/clauses";

// What the coach has taught the AI, as it applies to ONE client, ready to put into any AI prompt. Rules are matched by code (a rule reaches a client only when the client has every clause it names, or it
// is a coach-wide preference, or it was made for that one client); the AI is only handed the sentences. The block always sits UNDER the hard safety, injury and youth rules and says it can only add.

export interface LearnedRuleRow {
  kind: string;
  then_text: string | null;
  when_keys: string[] | null;
  scope: string | null;
  client_id: string | null;
}

// The clause keys a client has: the clauses the coach wrote on their profile plus the level and age band the app can read.
export async function loadClientKeys(supabase: SupabaseClient, coachId: string, athleteId: string | null): Promise<string[]> {
  if (!athleteId) return [];
  try {
    const [{ data: clauses }, { data: seats }, { data: intake }] = await Promise.all([
      supabase.from("client_clauses").select("key").eq("coach_id", coachId).eq("athlete_id", athleteId),
      supabase.from("group_memberships").select("training_level").eq("profile_id", athleteId).not("training_level", "is", null).limit(1),
      supabase.from("client_intake").select("date_of_birth").eq("athlete_id", athleteId).maybeSingle(),
    ]);
    const level = ((seats ?? []) as { training_level: string | null }[])[0]?.training_level ?? null;
    const dob = (intake as { date_of_birth?: string | null } | null)?.date_of_birth ?? null;
    return [...new Set([...((clauses ?? []) as { key: string }[]).map((c) => c.key), ...derivedKeys({ level, dateOfBirth: dob })])];
  } catch {
    return [];
  }
}

// The sentences that apply to this client (at most 20, most specific first).
export function learnedLines(rules: LearnedRuleRow[], client: { athleteId: string | null; keys: string[] }): string[] {
  return rules
    .filter((r) => !!r.then_text && ruleApplies({ scope: r.scope, whenKeys: r.when_keys, clientId: r.client_id }, client))
    .sort((a, b) => (b.when_keys?.length ?? 0) - (a.when_keys?.length ?? 0) || (a.then_text ?? "").localeCompare(b.then_text ?? ""))
    .slice(0, 20)
    .map((r) => {
      const when = (r.when_keys ?? []).length > 0 && r.scope === "clauses" ? ` (for clients with ${(r.when_keys ?? []).map((k) => labelFor(k).toLowerCase()).join(" and ")})` : "";
      return `${r.then_text}${when}`;
    });
}

export async function loadLearnedLines(supabase: SupabaseClient, coachId: string, athleteId: string | null): Promise<string[]> {
  try {
    const { data } = await supabase
      .from("coach_learned_rules")
      .select("kind, then_text, when_keys, scope, client_id")
      .eq("coach_id", coachId)
      .eq("status", "confirmed")
      .not("then_text", "is", null)
      .limit(200);
    const rules = (data ?? []) as LearnedRuleRow[];
    if (rules.length === 0) return [];
    const keys = await loadClientKeys(supabase, coachId, athleteId);
    return learnedLines(rules, { athleteId, keys });
  } catch {
    return [];
  }
}

export const LEARNED_HEADING = "What this coach has taught you (their own preferences for this kind of client). They can only ADD to the hard rules above: the safety, injury and youth rules always win, and anything the coach said in this request wins over these.";

// The block for a prompt, or null when nothing applies.
export function learnedBlock(lines: string[]): string | null {
  return lines.length === 0 ? null : `${LEARNED_HEADING}\n${lines.map((l) => `- ${l}`).join("\n")}`;
}
