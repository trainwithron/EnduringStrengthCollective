// Template slots: "Day 1: Unilateral Hinge, class A" instead of a named exercise. A slot is a movement pattern, a side (bilateral, unilateral or either) and a class (A, B, C or any). Choosing the real exercise for a
// client happens when the template is assigned (release 3); this file is the shared, tested part: how a slot reads, and how it finds its exercises on the coach's own ladder. Pure.
export type Side = "bilateral" | "unilateral";
export type SlotTier = "A" | "B" | "C";
export type Level = "beginner" | "intermediate" | "advanced";

export interface SlotSpec {
  patternName: string;
  side: Side | null; // null = either side
  tier: SlotTier | null; // null = any class
}

// "Hinge · Unilateral · Class A" (a part is left out when it is "either"/"any").
export function slotLabel(spec: SlotSpec): string {
  const parts = [spec.patternName];
  if (spec.side) parts.push(spec.side === "unilateral" ? "Unilateral" : "Bilateral");
  if (spec.tier) parts.push(`Class ${spec.tier}`);
  return parts.join(" · ");
}

// What is stored as the exercise name of a slot row (it is never a real exercise, and never reaches a client: assigning a template resolves it first).
export function slotPlaceholderName(spec: SlotSpec): string {
  return `Slot: ${slotLabel(spec)}`;
}

export interface LadderRung {
  exerciseName: string;
  rank: number;
  tier: SlotTier | null;
  unilateral: boolean;
}

export interface SlotChoices {
  // The rungs the slot can pick from, easiest first.
  rungs: LadderRung[];
  // Said plainly in the review when the exact class or side had nothing and the nearest was used.
  fallback: string | null;
}

// Which class to try next when the asked-for class has no exercise on the ladder: the nearest first.
const NEAREST: Record<SlotTier, SlotTier[]> = { A: ["B", "C"], B: ["A", "C"], C: ["B", "A"] };

const byRank = (a: LadderRung, b: LadderRung) => a.rank - b.rank || a.exerciseName.localeCompare(b.exerciseName);

export function choicesForSlot(spec: SlotSpec, ladder: LadderRung[]): SlotChoices {
  const sideOk = (r: LadderRung, side: Side | null) => side === null || (side === "unilateral") === r.unilateral;
  const pick = (side: Side | null, tier: SlotTier | null) => ladder.filter((r) => sideOk(r, side) && (tier === null || r.tier === tier)).sort(byRank);

  const exact = pick(spec.side, spec.tier);
  if (exact.length > 0) return { rungs: exact, fallback: null };

  // Nearest class, same side.
  if (spec.tier) {
    for (const t of NEAREST[spec.tier]) {
      const near = pick(spec.side, t);
      if (near.length > 0) return { rungs: near, fallback: `No class ${spec.tier} ${sideWord(spec.side)}exercise on this ladder, so class ${t} was used.` };
    }
  }
  // Either side, same class (then nearest).
  if (spec.side) {
    const tiers: (SlotTier | null)[] = spec.tier ? [spec.tier, ...NEAREST[spec.tier]] : [null];
    for (const t of tiers) {
      const any = pick(null, t);
      if (any.length > 0) return { rungs: any, fallback: `No ${sideWord(spec.side)}exercise on this ladder${t && t !== spec.tier ? ` in class ${spec.tier}` : ""}, so ${t ? `a class ${t} ` : "an "}exercise from either side was used.` };
    }
  }
  return { rungs: [], fallback: "Nothing on this ladder fits." };
}

function sideWord(side: Side | null): string {
  return side ? `${side} ` : "";
}

const LEVEL_FRACTION: Record<Level, number> = { beginner: 0.2, intermediate: 0.5, advanced: 0.8 };

// The rung a client's level lands on: the middle of the choices by default (Ron: it starts in the middle of the ladder and he moves it up or down from there).
export function pickRung(rungs: LadderRung[], level: Level = "intermediate"): LadderRung | null {
  if (rungs.length === 0) return null;
  return rungs[Math.round((rungs.length - 1) * LEVEL_FRACTION[level])];
}

export const SLOT_ASSIGN_BLOCKED = "This template has slots. Choosing its exercises for a client comes next, so it can't be assigned yet.";

export const SLOT_ACTIVE_BLOCKED = "This program has slots to fill in, so it can't be made active. Assign it to a client instead.";
