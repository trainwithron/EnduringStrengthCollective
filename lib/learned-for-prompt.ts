import type { SupabaseClient } from "@supabase/supabase-js";
import { derivedKeys, labelFor, ruleApplies } from "@/lib/clauses";

// What the coach has taught the AI, as it applies to ONE client, ready to put into any AI prompt. Rules are matched by code (a rule reaches a client only when the client has every clause it names, or it
// is a coach-wide preference, or it was made for that one client); the AI is only handed the sentences. The block always sits UNDER the hard safety, injury and youth rules and says it can only add.

export interface LearnedRuleRow {
  id?: string;
  kind: string;
  then_text: string | null;
  when_keys: string[] | null;
  scope: string | null;
  client_id: string | null;
  reason_text?: string | null;
  confirmations?: number | null;
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

// The ladder: a rule the coach has confirmed this many times is applied without asking again. Before that, repeating the same correction asks again (and counts as another confirmation).
export const SILENT_AFTER = 3;

export function isSilent(rule: { confirmations?: number | null }): boolean {
  return (rule.confirmations ?? 1) >= SILENT_AFTER;
}

// The rules that apply to this client (at most 20, most specific first).
export function applicableRules(rules: LearnedRuleRow[], client: { athleteId: string | null; keys: string[] }): LearnedRuleRow[] {
  return rules
    .filter((r) => !!r.then_text && ruleApplies({ scope: r.scope, whenKeys: r.when_keys, clientId: r.client_id }, client))
    .sort((a, b) => (b.when_keys?.length ?? 0) - (a.when_keys?.length ?? 0) || (a.then_text ?? "").localeCompare(b.then_text ?? ""))
    .slice(0, 20);
}

// The sentences for rules already matched to a client.
export function linesFor(rules: LearnedRuleRow[]): string[] {
  return rules.map((r) => {
    const when = (r.when_keys ?? []).length > 0 && r.scope === "clauses" ? ` (for clients with ${(r.when_keys ?? []).map((k) => labelFor(k).toLowerCase()).join(" and ")})` : "";
    return `${r.then_text}${when}`;
  });
}

export function learnedLines(rules: LearnedRuleRow[], client: { athleteId: string | null; keys: string[] }): string[] {
  return linesFor(applicableRules(rules, client));
}

// What the coach sees when rules were used: "Applied your rule: no barbell squats (because: back limits; you confirmed this 3 times)", with Undo.
export interface AppliedRule {
  id: string;
  text: string;
  because: string;
  confirmations: number;
  silent: boolean;
}

export function appliedLine(a: { text: string; because: string; confirmations: number }): string {
  const times = a.confirmations === 1 ? "once" : `${a.confirmations} times`;
  return `Applied your rule: ${a.text.charAt(0).toLowerCase()}${a.text.slice(1)} (because: ${a.because}; you confirmed this ${times})`;
}

export function toApplied(rules: LearnedRuleRow[]): AppliedRule[] {
  return rules
    .filter((r) => !!r.id)
    .map((r) => {
      const keys = r.when_keys ?? [];
      const because = r.reason_text?.trim() ? r.reason_text.trim() : keys.length > 0 && r.scope === "clauses" ? keys.map((k) => labelFor(k).toLowerCase()).join(" and ") : r.scope === "client" ? "this client" : "your preference";
      return { id: r.id as string, text: r.then_text ?? "", because, confirmations: r.confirmations ?? 1, silent: isSilent(r) };
    });
}

// extraKeys: clauses the coach asked to use for THIS request only ("like Rob"), added to the client's own.
export async function loadApplicableRules(supabase: SupabaseClient, coachId: string, athleteId: string | null, extraKeys: string[] = []): Promise<LearnedRuleRow[]> {
  try {
    const { data } = await supabase
      .from("coach_learned_rules")
      .select("id, kind, then_text, when_keys, scope, client_id, reason_text, confirmations")
      .eq("coach_id", coachId)
      .eq("status", "confirmed")
      .not("then_text", "is", null)
      .limit(200);
    const rules = (data ?? []) as LearnedRuleRow[];
    if (rules.length === 0) return [];
    const keys = [...new Set([...(await loadClientKeys(supabase, coachId, athleteId)), ...extraKeys])];
    return applicableRules(rules, { athleteId, keys });
  } catch {
    return [];
  }
}

export async function loadLearnedLines(supabase: SupabaseClient, coachId: string, athleteId: string | null, extraKeys: string[] = []): Promise<string[]> {
  return linesFor(await loadApplicableRules(supabase, coachId, athleteId, extraKeys));
}

// Clause keys the screen sends for one request ("like Rob"): plain slugs only, at most ten.
export function cleanExtraKeys(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((k): k is string => typeof k === "string" && /^[a-z0-9_]{1,40}$/.test(k)).slice(0, 10) : [];
}

export const LEARNED_HEADING = "What this coach has taught you (their own preferences for this kind of client). They can only ADD to the hard rules above: the safety, injury and youth rules always win, and anything the coach said in this request wins over these.";

// The block for a prompt, or null when nothing applies.
export function learnedBlock(lines: string[]): string | null {
  return lines.length === 0 ? null : `${LEARNED_HEADING}\n${lines.map((l) => `- ${l}`).join("\n")}`;
}
