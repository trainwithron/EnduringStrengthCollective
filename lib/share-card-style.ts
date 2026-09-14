// Post-workout share card style selection
// (post_workout_card_v1_bevel_and_animation.md) — a seeded random
// rotation across whichever styles are actually available for this
// share, the same stable-per-post/varies-per-workout mechanism
// lib/volume-equivalence.ts and lib/gym-jokes.ts already use. Scenic
// overlay only enters the pool once there's real background content to
// show — a custom upload, or the built-in default rotation actually
// having scenes — so nobody ever lands on a broken/empty scenic card.
import { hashSeed } from "./seeded-pick";

export type ShareCardStyle = "bevel" | "scenic" | "humor";

// Bevel is the safe, always-correct default and stays the most common
// pick; scenic is the real visual upgrade when available, so it gets
// real weight; humor is a fun occasional surprise, not the norm — too
// frequent would undercut a genuine PR moment.
const WEIGHTS_WITH_SCENIC: { style: ShareCardStyle; weight: number }[] = [
  { style: "bevel", weight: 5 },
  { style: "scenic", weight: 3 },
  { style: "humor", weight: 2 },
];

const WEIGHTS_WITHOUT_SCENIC: { style: ShareCardStyle; weight: number }[] = [
  { style: "bevel", weight: 7 },
  { style: "humor", weight: 3 },
];

export function pickShareCardStyle(seed: string, scenicAvailable: boolean): ShareCardStyle {
  const weights = scenicAvailable ? WEIGHTS_WITH_SCENIC : WEIGHTS_WITHOUT_SCENIC;
  const total = weights.reduce((sum, w) => sum + w.weight, 0);
  const roll = hashSeed(`card-style:${seed}`) % total;

  let cursor = 0;
  for (const w of weights) {
    cursor += w.weight;
    if (roll < cursor) return w.style;
  }
  return weights[weights.length - 1].style;
}
