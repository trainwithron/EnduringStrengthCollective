import type { SupabaseClient } from "@supabase/supabase-js";
import { LearnedList, type LearnedLine } from "@/components/coach/learned-list";
import { CoachConversation } from "@/components/coach/coach-conversation";
import { askingLessThanBefore } from "@/lib/edit-patterns";
import { labelFor } from "@/lib/context-tags";
import { isSilent } from "@/lib/learned-for-prompt";

// Server side of "What I've learned about how you coach": reads the coach's own rows (row security keeps it theirs) and hands the plain list to the screen. If the learning tables are not
// there yet it shows nothing at all.
export async function LearnedSection({ supabase, coachId }: { supabase: SupabaseClient; coachId: string }) {
  const [rulesRes, prefsRes, settingsRes, signoffsRes] = await Promise.all([
    supabase.from("coach_learned_rules").select("id, kind, from_name, to_name, evidence_count, evidence_total, reason_text, rule_text, preference_id, then_text, when_keys, scope, confirmations").eq("coach_id", coachId).eq("status", "confirmed").order("decided_at", { ascending: false }),
    supabase.from("coach_program_preferences").select("id, condition_text, preference_text").eq("coach_id", coachId).order("created_at", { ascending: false }).limit(100),
    supabase.from("coach_learning_settings").select("questions_enabled").eq("coach_id", coachId).maybeSingle(),
    supabase.from("coach_program_signoffs").select("questions_asked").eq("coach_id", coachId).order("signed_at", { ascending: true }).limit(200),
  ]);
  if (rulesRes.error || settingsRes.error) return null;

  const rules = (rulesRes.data ?? []) as { id: string; kind: string; from_name: string | null; to_name: string | null; evidence_count: number; evidence_total: number; reason_text: string | null; rule_text: string | null; preference_id: string | null; then_text: string | null; when_keys: string[] | null; scope: string | null; confirmations: number | null }[];
  const linked = new Set(rules.map((r) => r.preference_id).filter((x): x is string => !!x));
  const lines: LearnedLine[] = [
    ...rules.map((r) => ({
      kind: "rule" as const,
      id: r.id,
      text: r.kind === "swap" ? (r.rule_text ?? `Use ${r.to_name} instead of ${r.from_name}.`) : (r.then_text ?? r.rule_text ?? ""),
      evidence: r.kind === "swap" ? `You made this change in ${r.evidence_count} of ${r.evidence_total} programs.` : `You confirmed this ${r.confirmations ?? 1} ${(r.confirmations ?? 1) === 1 ? "time" : "times"}.${isSilent(r) ? " I apply it without asking." : " I'll check with you if you do this again."}`,
      reason: r.reason_text,
      when: r.kind === "swap" ? null : r.scope === "context" && (r.when_keys ?? []).length > 0 ? `For clients with ${(r.when_keys ?? []).map((k) => labelFor(k).toLowerCase()).join(" and ")}` : r.scope === "client" ? "For one client" : "For all your clients",
    })),
    ...((prefsRes.data ?? []) as { id: string; condition_text: string; preference_text: string }[])
      .filter((p) => !linked.has(p.id))
      .map((p) => ({ kind: "preference" as const, id: p.id, text: `When ${p.condition_text}: ${p.preference_text}`, evidence: null, reason: null, when: null })),
  ];
  const questions = ((signoffsRes.data ?? []) as { questions_asked: number }[]).map((s) => s.questions_asked);
  return (
    <>
      <LearnedList
        lines={lines}
        questionsEnabled={(settingsRes.data as { questions_enabled?: boolean } | null)?.questions_enabled !== false}
        coachId={coachId}
        askingLess={askingLessThanBefore(questions)}
      />
      <div className="mt-4 max-w-2xl">
        <CoachConversation coachId={coachId} invite="none" entry />
      </div>
    </>
  );
}
