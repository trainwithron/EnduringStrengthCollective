// Post-workout share card's "Default rotation" scenic backgrounds
// (post_workout_card_v1_bevel_and_animation.md, Direction B/D) — real
// production art in the app's own flat/geometric CSS-gradient style
// (matching the reviewed mockup exactly), not a stand-in for real
// photography. Picked the same seeded-per-post way as the volume-
// equivalence jokes, so a share's scene is stable on reload but varies
// workout to workout.
import { seededPick } from "./seeded-pick";

export type ScenicBackgroundKey = "coastal" | "vegas";

export interface ScenicBackground {
  key: ScenicBackgroundKey;
  label: string;
}

export const SCENIC_BACKGROUNDS: ScenicBackground[] = [
  { key: "coastal", label: "Coastal sunset" },
  { key: "vegas", label: "City skyline" },
];

export function pickScenicBackground(seed: string): ScenicBackground {
  return seededPick(SCENIC_BACKGROUNDS, `scenic:${seed}`);
}
