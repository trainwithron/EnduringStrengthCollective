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

// The sky gradient of each scene (the same stops the CSS scene uses), so the shareable picture can paint the same
// colours on a canvas. Offsets run from the top (0) to the bottom (1).
export const SCENIC_SKY_STOPS: Record<ScenicBackgroundKey, [number, string][]> = {
  coastal: [[0, "#3a2f52"], [0.28, "#a2567a"], [0.46, "#e08a56"], [0.55, "#f4b96a"], [0.62, "#8fa5a8"], [1, "#5a7378"]],
  vegas: [[0, "#241a3d"], [0.32, "#4a2f5e"], [0.52, "#8a4a5e"], [0.68, "#c97a52"], [1, "#e8a95f"]],
  sunrise: [[0, "#4a3a63"], [0.32, "#a8567a"], [0.55, "#e08a5e"], [0.72, "#f4c56a"], [1, "#8aa3a0"]],
  desert: [[0, "#2b1f3d"], [0.3, "#5a2f4a"], [0.52, "#a4453f"], [0.68, "#d97a3f"], [1, "#f0b35e"]],
  forest: [[0, "#1c3038"], [0.34, "#2e4a52"], [0.58, "#5a7a78"], [0.78, "#8fa8a0"], [1, "#c4d0c0"]],
  aurora: [[0, "#0a0e1c"], [0.55, "#131a30"], [1, "#1c2438"]],
  tropical: [[0, "#3a1f4a"], [0.34, "#8a3468"], [0.56, "#d9567a"], [0.72, "#f0966a"], [1, "#f5c878"]],
  midnight: [[0, "#05060d"], [0.45, "#0d1224"], [0.78, "#1a2038"], [1, "#2a2740"]],
};
