// Transformation Cards (transformation_card_full_design.md) — the
// verified real-reference-weight joke content bank for weight-LOSS
// milestones specifically. Same "seeded, deterministic per card, real
// variety across different athletes" convention as lib/volume-equivalence.ts,
// but a direct nearest-match comparison (not a ratio-range/count format)
// since these tiers were hand-picked to already land close to real
// weight-loss milestones (5-200+ lbs), not an open-ended range.
//
// Deliberately no real named individuals, no trademarked characters,
// and a celebratory framing throughout — body weight is more personal
// than workout volume, so the tone here stays gentler than the
// volume-equivalence joke's more irreverent voice.
import { seededPick } from "./seeded-pick";

interface ReferenceObject {
  name: string; // no leading article — composed into templates directly
  weightLbs: number;
  emoji: string;
}

// Verbatim from the resolved design's own content bank.
const REFERENCE_OBJECTS: ReferenceObject[] = [
  { name: "a large housecat", weightLbs: 5, emoji: "🐈" },
  { name: "one genuinely chunky housecat", weightLbs: 10, emoji: "🐈‍⬛" },
  { name: "a bowling ball", weightLbs: 10, emoji: "🎳" },
  { name: "a packed carry-on suitcase", weightLbs: 15, emoji: "🧳" },
  { name: "a Thanksgiving turkey", weightLbs: 20, emoji: "🦃" },
  { name: "a 2-year-old toddler", weightLbs: 20, emoji: "🧒" },
  { name: "a full bag of dog food", weightLbs: 25, emoji: "🐕" },
  { name: "a golden retriever", weightLbs: 35, emoji: "🐕‍🦺" },
  { name: "a 5-month-old black bear cub", weightLbs: 50, emoji: "🐻" },
  { name: "a full-grown mastiff", weightLbs: 75, emoji: "🐕‍🦺" },
  { name: "a six-foot shark", weightLbs: 100, emoji: "🦈" },
  { name: "an adult mountain lion", weightLbs: 125, emoji: "🐆" },
  { name: "a newborn giraffe", weightLbs: 150, emoji: "🦒" },
  { name: "a full keg of beer, keg included", weightLbs: 175, emoji: "🍺" },
  { name: "a yearling grizzly cub", weightLbs: 200, emoji: "🐻" },
  { name: "two full mastiffs", weightLbs: 200, emoji: "🐕‍🦺🐕‍🦺" },
].sort((a, b) => a.weightLbs - b.weightLbs);

const PHRASE_TEMPLATES: ((label: string, emoji: string) => string)[] = [
  (label, emoji) => `That's about the weight of ${label}. ${emoji}`,
  (label, emoji) => `You're carrying around ${label} less than when you started. ${emoji}`,
  (label, emoji) => `Picture ${label} — that's what you've let go of. ${emoji}`,
];

export interface DirectComparison {
  label: string;
  emoji: string;
  text: string;
}

// Nearest-match, not a ratio range — every real tie (e.g. two objects
// both at 10 lbs) is seed-picked between for variety, but a lone closest
// match is used as-is rather than forced into an artificial range.
export function getDirectComparison(lbsLost: number, seed: string): DirectComparison | null {
  if (!lbsLost || lbsLost <= 0) return null;

  let minDist = Infinity;
  for (const ref of REFERENCE_OBJECTS) {
    const dist = Math.abs(ref.weightLbs - lbsLost);
    if (dist < minDist) minDist = dist;
  }
  const candidates = REFERENCE_OBJECTS.filter((ref) => Math.abs(ref.weightLbs - lbsLost) === minDist);
  const ref = seededPick(candidates, seed);
  const template = seededPick(PHRASE_TEMPLATES, `${seed}:phrase`);

  return { label: ref.name, emoji: ref.emoji, text: template(ref.name, ref.emoji) };
}

// The "surprisingly tiny baby animal" bonus tier — real, verified birth
// weights driving an absurd-math count, same mechanic as the workout-
// volume joke's own equivalence format.
const OZ_PER_LB = 16;
const KANGAROO_JOEY_OZ = 0.03; // jellybean-sized at birth
const PANDA_CUB_OZ = 3.5; // the size of a stick of butter at birth

export function computeKangarooJoeyEquivalent(lbsLost: number): number {
  return Math.round((lbsLost * OZ_PER_LB) / KANGAROO_JOEY_OZ);
}

export function computePandaCubEquivalent(lbsLost: number): number {
  return Math.round((lbsLost * OZ_PER_LB) / PANDA_CUB_OZ);
}

export function getBonusAnimalLine(lbsLost: number, seed: string): string | null {
  if (!lbsLost || lbsLost <= 0) return null;
  const useKangaroo = seededPick([true, false], `${seed}:animal`);
  if (useKangaroo) {
    const n = computeKangarooJoeyEquivalent(lbsLost);
    return `You've now out-lost roughly ${n.toLocaleString()} kangaroo joeys. They're born the size of a jellybean — look it up. 🦘`;
  }
  const n = computePandaCubEquivalent(lbsLost);
  return `That's about ${n.toLocaleString()} newborn panda cubs' worth — they're born the size of a stick of butter. 🐼`;
}
