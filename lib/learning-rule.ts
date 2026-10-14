import { inferTagKeys, labelFor, splitCorrection } from "@/lib/context-tags";

// The AI you can train. When the coach corrects what the AI built ("no barbell squats, his back"), the app works out WHAT to remember and WHO it applies to, reading the reason from the correction, the
// reason the coach gave, and the client. Rules are never "always" by accident: a rule that has a reason applies only to clients with that clause. Pure, so every step is tested.

export type RuleKind = "avoid" | "prefer" | "rest" | "day_length" | "implement" | "named";
export type RuleScope = "all" | "context" | "client";

export const LEARN_INTRO = "I learn from the changes you make. I'll ask a few questions so I can build it your way, and the more I learn the less I'll ask.";
export const WHY_PROMPT = "Why did you change this? Only asking so I can help you better next time.";
export const WHY_CHIPS: { key: string; label: string }[] = [
  { key: "injury_or_limit", label: "Injury or limit" },
  { key: "my_preference", label: "My preference" },
  { key: "equipment", label: "Equipment" },
  { key: "time", label: "Time" },
  { key: "client_feedback", label: "Client feedback" },
];

const RE_REST = /(?:^|[^a-z])(rest|seconds?|secs?)(?:[^a-z]|$)/i;
const RE_DAY = /(?:exercises?|movements?)\s+(?:a|per|each)\s+day|(?:shorter|longer|short|long)\s+(?:days?|sessions?|workouts?)|\bminutes?\b/i;
const RE_AVOID = /(?:^|[^a-z])(no|not|never|without|avoid|skip|stop|remove|drop|don'?t|dont)(?:[^a-z]|$)/i;
const RE_IMPLEMENT = /\b(machines?|dumbbells?|barbells?|kettlebells?|bands?|cables?|bodyweight)\b/i;

// What kind of preference this is, from the instruction itself.
export function ruleKind(instruction: string): RuleKind {
  if (RE_REST.test(instruction)) return "rest";
  if (RE_DAY.test(instruction)) return "day_length";
  if (RE_AVOID.test(instruction)) return "avoid";
  if (RE_IMPLEMENT.test(instruction)) return "implement";
  return "prefer";
}

const tidy = (s: string) => {
  const t = s.trim().replace(/\s+/g, " ").replace(/[.!]+$/, "");
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
};

export interface RuleProposal {
  kind: RuleKind;
  // The sentence the AI is told ("No barbell squats").
  thenText: string;
  // The context it is for (from the reason, the reason chips and what is known about the client); empty = a preference about how the coach works, for all clients.
  whenKeys: string[];
  scope: RuleScope;
  // "I'll remember: no barbell squats for clients with back limits."
  summary: string;
}

export interface ProposeInput {
  correction: string;
  whyText?: string | null;
  // The reason chips picked ("injury_or_limit", ...). "injury_or_limit" with one context tag known for the client means that tag.
  whyChips?: string[];
  // The context tags this client already has (keys).
  clientKeys?: string[];
}

export function joinLabels(labels: string[]): string {
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

export function summaryFor(thenText: string, whenKeys: string[], scope: RuleScope, custom: Record<string, string> = {}): string {
  const lead = thenText.charAt(0).toLowerCase() + thenText.slice(1);
  if (scope === "client") return `I'll remember: ${lead} for this client.`;
  if (scope === "context" && whenKeys.length > 0) return `I'll remember: ${lead} for clients with ${joinLabels(whenKeys.map((k) => labelFor(k, custom).toLowerCase()))}.`;
  return `I'll remember: ${lead}.`;
}

export function proposeRule(input: ProposeInput): RuleProposal | null {
  const text = input.correction.trim();
  if (text.length < 3 || text.length > 300) return null;
  const { head, reason } = splitCorrection(text);
  const reasonKeys = inferTagKeys(`${reason} ${input.whyText ?? ""}`, true);
  // The instruction is the part before the reason, when the reason really names a context tag; otherwise the whole sentence.
  const instruction = reasonKeys.length > 0 && head ? head : text;
  const thenText = tidy(instruction);
  if (!thenText) return null;
  // An instruction that itself names the problem ("no squats, bad knee" or "back pain: no deadlifts") also counts.
  const inText = inferTagKeys(instruction, false);
  let whenKeys = [...new Set([...reasonKeys, ...inText])];
  // "Injury or limit" with nothing readable falls back on the context the client already has.
  if (whenKeys.length === 0 && input.whyChips?.includes("injury_or_limit") && (input.clientKeys?.length ?? 0) > 0) whenKeys = [...(input.clientKeys ?? [])];
  const scope: RuleScope = whenKeys.length > 0 ? "context" : "all";
  return { kind: ruleKind(instruction), thenText, whenKeys, scope, summary: summaryFor(thenText, whenKeys, scope) };
}

// The proposal after the coach changed who it applies to.
export function withScope(p: RuleProposal, scope: RuleScope | "all", whenKeys?: string[], custom: Record<string, string> = {}): RuleProposal {
  const keys = scope === "context" ? (whenKeys && whenKeys.length > 0 ? whenKeys : p.whenKeys) : [];
  const finalScope: RuleScope = scope === "context" && keys.length === 0 ? "all" : scope;
  return { ...p, scope: finalScope, whenKeys: keys, summary: summaryFor(p.thenText, keys, finalScope, custom) };
}

export function sameRule(a: { kind: string; thenText: string; whenKeys: string[]; scope: string; clientId?: string | null }, b: { kind: string; then_text: string | null; when_keys: string[] | null; scope: string; client_id: string | null }, clientId: string | null): boolean {
  const norm = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return (
    a.kind === b.kind &&
    a.scope === b.scope &&
    norm(a.thenText) === norm(b.then_text ?? "") &&
    [...a.whenKeys].sort().join(",") === [...(b.when_keys ?? [])].sort().join(",") &&
    (a.scope === "client" ? (clientId ?? null) === b.client_id : true)
  );
}
