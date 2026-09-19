// Post-workout share card's "Default rotation" scenic backgrounds
// (post_workout_card_v1_bevel_and_animation.md, Direction B/D) — real
// production art in the app's own flat/geometric CSS-gradient style
// (matching the reviewed mockup exactly), not a stand-in for real
// photography. Picked the same seeded-per-post way as the volume-
// equivalence jokes, so a share's scene is stable on reload but varies
// workout to workout — unless an athlete has set a personal preference
// (profiles.preferred_share_background, see
// share_card_backgrounds_expansion_scoping_sept19.md), in which case
// that specific scene is used every time instead of the rotation.
import { seededPick } from "./seeded-pick";

export type ScenicBackgroundKey =
  | "coastal"
  | "vegas"
  | "sunrise"
  | "desert"
  | "forest"
  | "aurora"
  | "tropical"
  | "midnight";

export interface ScenicBackground {
  key: ScenicBackgroundKey;
  label: string;
}

export const SCENIC_BACKGROUNDS: ScenicBackground[] = [
  { key: "coastal", label: "Coastal sunset" },
  { key: "vegas", label: "City skyline" },
  { key: "sunrise", label: "Mountain sunrise" },
  { key: "desert", label: "Desert dusk" },
  { key: "forest", label: "Misty pines" },
  { key: "aurora", label: "Northern lights" },
  { key: "tropical", label: "Tropical dusk" },
  { key: "midnight", label: "Midnight skyline" },
];

export function pickScenicBackground(seed: string): ScenicBackground {
  return seededPick(SCENIC_BACKGROUNDS, `scenic:${seed}`);
}

// A stale/removed key (or one from before this set grew) falls back to
// the normal seeded rotation rather than erroring — no check constraint
// enforces this app-side list at the database layer, deliberately (see
// migration 0197).
export function resolvePreferredBackground(
  preferredKey: string | null,
  seed: string
): ScenicBackground {
  if (preferredKey) {
    const match = SCENIC_BACKGROUNDS.find((b) => b.key === preferredKey);
    if (match) return match;
  }
  return pickScenicBackground(seed);
}
