// CONTEXT TAGS: the few things about a client that decide which of the coach's taught rules apply ("back limits", "no rotation", "limited overhead range", beginner, 50 and over). They are worked out
// invisibly (the coach's notes on the client, the AI build notes, the client's level and age band, the reason the coach gave for a correction) and are never a feature the coach manages. Tags only,
// never medical text. Pure, so it is tested.

export interface TagDef {
  key: string;
  label: string;
  // Words in a coach's correction or reason that point at this tag.
  words: string[];
}

export const TAGS: TagDef[] = [
  { key: "back_limit", label: "Back limits", words: ["back", "spine", "spinal", "lumbar", "disc", "sciatica", "herniated"] },
  { key: "no_rotation", label: "No rotation", words: ["rotation", "rotate", "rotating", "twisting", "twist"] },
  { key: "overhead_limit", label: "Limited overhead range", words: ["overhead"] },
  { key: "shoulder_limit", label: "Shoulder limits", words: ["shoulder", "shoulders", "rotator"] },
  { key: "knee_limit", label: "Knee limits", words: ["knee", "knees", "acl", "meniscus", "patella"] },
  { key: "hip_limit", label: "Hip limits", words: ["hip", "hips"] },
  { key: "wrist_elbow_limit", label: "Wrist or elbow limits", words: ["wrist", "wrists", "elbow", "elbows", "forearm"] },
  { key: "neck_limit", label: "Neck limits", words: ["neck", "cervical"] },
];

// Context a client has without anyone writing anything: their level and age band. Rules can use them like any other tag.
export const DERIVED: { key: string; label: string }[] = [
  { key: "level_beginner", label: "Beginner" },
  { key: "level_advanced", label: "Advanced" },
  { key: "age_under_30", label: "Under 30" },
  { key: "age_30_49", label: "30 to 49" },
  { key: "age_50_plus", label: "50 and over" },
];

export const ALL_KEYS: { key: string; label: string }[] = [...TAGS.map((c) => ({ key: c.key, label: c.label })), ...DERIVED];

export function labelFor(key: string, custom: Record<string, string> = {}): string {
  return ALL_KEYS.find((c) => c.key === key)?.label ?? custom[key] ?? key.replace(/_/g, " ");
}

const words = (text: string) => text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

// Words that say the body part is the PROBLEM ("his back", "bad knee", "shoulder pain"), as opposed to a movement name ("back squat", "hip thrust").
const POSSESSIVE = new Set(["his", "her", "their", "my", "bad", "sore", "injured", "lower", "upper", "weak", "tight", "stiff", "painful", "bum", "dodgy"]);
const TROUBLE = new Set(["pain", "injury", "injuries", "issue", "issues", "problem", "problems", "surgery", "limit", "limits", "limited", "mobility", "trouble", "hurts", "sore", "replacement", "fusion", "fracture", "broken"]);

// Splits "no barbell squats, his back" into the instruction ("no barbell squats") and the reason ("his back"). With no reason in it, reason is empty.
export function splitCorrection(text: string): { head: string; reason: string } {
  const t = text.trim().replace(/[.!]+$/, "");
  const m = t.match(/^(.*?)(?:\s*[,;]\s*|\s+(?:because of|because|since|due to)\s+)(.+)$/i);
  if (!m || !m[1].trim()) return { head: t, reason: "" };
  return { head: m[1].trim(), reason: m[2].trim() };
}

// The tags a piece of writing points at. In a REASON ("his back", "because of her knee") a body-part word counts; in an instruction ("no hip thrusts") only a part named as the problem counts
// ("bad knee", "back pain"), so a movement name never adds a tag. Whole words only.
export function inferTagKeys(text: string, isReason: boolean = true): string[] {
  const w = words(text);
  const out: string[] = [];
  for (const c of TAGS) {
    const hit = w.some((word, i) => {
      if (!c.words.includes(word)) return false;
      const problem = POSSESSIVE.has(w[i - 1] ?? "") || TROUBLE.has(w[i + 1] ?? "") || TROUBLE.has(w[i + 2] ?? "");
      // A reason names the part plainly; "back" alone is also a direction ("back squat", "back off"), so it always needs the problem wording.
      if (word === "back") return problem;
      return isReason ? true : problem;
    });
    if (hit) out.push(c.key);
  }
  return out;
}
// Level and age band the rules can match on.
export function derivedKeys(opts: { level?: string | null; dateOfBirth?: string | null }, today: Date = new Date()): string[] {
  const out: string[] = [];
  if (opts.level === "beginner") out.push("level_beginner");
  if (opts.level === "advanced") out.push("level_advanced");
  if (opts.dateOfBirth && /^\d{4}-\d{2}-\d{2}/.test(opts.dateOfBirth)) {
    const born = new Date(opts.dateOfBirth.slice(0, 10) + "T12:00:00Z");
    let age = today.getUTCFullYear() - born.getUTCFullYear();
    const m = today.getUTCMonth() - born.getUTCMonth();
    if (m < 0 || (m === 0 && today.getUTCDate() < born.getUTCDate())) age -= 1;
    if (age >= 18) out.push(age < 30 ? "age_under_30" : age < 50 ? "age_30_49" : "age_50_plus");
  }
  return out;
}

export interface RuleLike {
  scope: string | null | undefined;
  whenKeys: string[] | null | undefined;
  clientId: string | null | undefined;
}

// Whether a learned rule reaches this client: a coach-wide rule always; a client rule only for that client; a tag rule only when the client has EVERY tag it names.
export function ruleApplies(rule: RuleLike, client: { athleteId: string | null; keys: string[] }): boolean {
  const scope = rule.scope ?? "all";
  if (scope === "all") return true;
  if (scope === "client") return !!client.athleteId && rule.clientId === client.athleteId;
  const need = rule.whenKeys ?? [];
  if (need.length === 0) return false;
  const have = new Set(client.keys);
  return need.every((k) => have.has(k));
}
