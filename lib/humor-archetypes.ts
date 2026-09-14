// Post-workout share card's humor archetype library
// (post_workout_card_v1_bevel_and_animation.md, Direction C) — "your
// photo on an absurdly jacked body," without a real named person or a
// trademarked character. A generic illustration with a face-shaped
// cutout the athlete's own avatar drops into, same seeded-random-pick
// pattern already used for the volume-equivalence jokes (stable per
// share, varies workout to workout). Body paths are the real vector
// shapes from the reviewed mockup, shipped as the actual production
// art — flat/geometric style matching the rest of this app, not
// photorealistic.
import { seededPick } from "./seeded-pick";

export interface HumorArchetype {
  key: string;
  caption: string;
  subcaption: string;
  // A 150x170 viewBox, matching every archetype below.
  bodyPaths: string; // raw <path>/<circle>/<ellipse>/<rect> children as an SVG fragment string
  faceHole: { cx: number; cy: number; r: number };
}

export const HUMOR_ARCHETYPES: HumorArchetype[] = [
  {
    key: "strongman",
    caption: "Absolutely Yoked",
    subcaption: "Generic strongman archetype — no real person",
    faceHole: { cx: 75, cy: 32.4, r: 29 },
    bodyPaths: `
      <ellipse cx="75" cy="150" rx="55" ry="14" fill="#0f0e0d" opacity=".4"/>
      <path d="M40 60 Q20 65 18 95 Q17 115 35 118 L50 112 Q45 95 48 75 Z" fill="#8a5a3a"/>
      <path d="M110 60 Q130 65 132 95 Q133 115 115 118 L100 112 Q105 95 102 75 Z" fill="#8a5a3a"/>
      <path d="M45 70 Q75 58 105 70 L112 130 Q75 145 38 130 Z" fill="#a8653f"/>
      <path d="M75 58 Q60 62 58 75 Q75 85 92 75 Q90 62 75 58 Z" fill="#8a5a3a"/>
      <ellipse cx="60" cy="95" rx="9" ry="16" fill="#7a4f33" opacity=".5"/>
      <ellipse cx="90" cy="95" rx="9" ry="16" fill="#7a4f33" opacity=".5"/>
    `,
  },
  {
    key: "cartoon_round",
    caption: "Inflatable Gains",
    subcaption: "Cartoon-round archetype — different tone, same mechanism",
    faceHole: { cx: 75, cy: 30, r: 30 },
    bodyPaths: `
      <ellipse cx="75" cy="150" rx="50" ry="13" fill="#0f0e0d" opacity=".4"/>
      <circle cx="75" cy="100" r="46" fill="#D2703B" opacity=".9"/>
      <path d="M30 88 Q10 92 10 112 Q10 126 26 126 L38 120 Q34 108 36 92 Z" fill="#b85a2e"/>
      <path d="M120 88 Q140 92 140 112 Q140 126 124 126 L112 120 Q116 108 114 92 Z" fill="#b85a2e"/>
      <path d="M75 60 Q58 64 56 76 Q75 86 94 76 Q92 64 75 60 Z" fill="#b85a2e"/>
    `,
  },
  {
    key: "olympic_lifter",
    caption: "Gold Medal Grind",
    subcaption: "Overhead-lift archetype — big lift, bigger ego",
    faceHole: { cx: 75, cy: 74.8, r: 23 },
    bodyPaths: `
      <ellipse cx="75" cy="150" rx="52" ry="13" fill="#0f0e0d" opacity=".4"/>
      <rect x="20" y="30" width="110" height="6" rx="3" fill="#5b564d"/>
      <circle cx="24" cy="33" r="15" fill="#211f1c" stroke="rgba(237,232,224,.14)" stroke-width="2"/>
      <circle cx="126" cy="33" r="15" fill="#211f1c" stroke="rgba(237,232,224,.14)" stroke-width="2"/>
      <path d="M55 95 L45 40 L58 40 L67 95 Z" fill="#a8653f"/>
      <path d="M95 95 L105 40 L92 40 L83 95 Z" fill="#a8653f"/>
      <path d="M58 90 Q75 82 92 90 L98 145 Q75 156 52 145 Z" fill="#8a5a3a"/>
      <path d="M60 140 L55 168 L68 168 L70 142 Z" fill="#7a4f33"/>
      <path d="M90 140 L95 168 L82 168 L80 142 Z" fill="#7a4f33"/>
    `,
  },
  {
    key: "tightrope",
    caption: "Balancing the Bulk",
    subcaption: "Tightrope archetype — because gains take balance too",
    faceHole: { cx: 75, cy: 42.4, r: 22 },
    bodyPaths: `
      <line x1="0" y1="150" x2="150" y2="150" stroke="#5b564d" stroke-width="4"/>
      <path d="M75 95 Q80 100 78 115 Q80 130 75 150" stroke="#a8653f" stroke-width="14" fill="none" stroke-linecap="round"/>
      <path d="M45 80 Q60 88 75 95 Q90 88 108 76" stroke="#8a5a3a" stroke-width="10" fill="none" stroke-linecap="round"/>
      <rect x="55" y="60" width="40" height="38" rx="16" fill="#a8653f"/>
      <path d="M40 60 Q75 50 112 62" stroke="#D2703B" stroke-width="4" fill="none" opacity=".7"/>
    `,
  },
  {
    key: "boxer",
    caption: "One-Punch Pump",
    subcaption: "Boxer archetype — knockout leg day",
    faceHole: { cx: 75, cy: 64.6, r: 22 },
    bodyPaths: `
      <ellipse cx="75" cy="150" rx="52" ry="13" fill="#0f0e0d" opacity=".4"/>
      <path d="M55 100 L38 75 L52 65 L65 92 Z" fill="#a8653f"/>
      <path d="M95 100 L112 75 L98 65 L85 92 Z" fill="#a8653f"/>
      <circle cx="35" cy="70" r="13" fill="#2c2a26" stroke="rgba(237,232,224,.2)" stroke-width="2"/>
      <path d="M58 92 Q75 84 92 92 L98 142 Q75 152 52 142 Z" fill="#5b6b4a"/>
      <path d="M55 90 L75 96 L95 90 L92 74 L75 80 L58 74 Z" fill="#7a8b6f"/>
      <path d="M60 138 L52 168 L66 168 L70 140 Z" fill="#4a5a3c"/>
      <path d="M90 138 L98 168 L84 168 L80 140 Z" fill="#4a5a3c"/>
    `,
  },
  {
    key: "barbarian",
    caption: "Barbarian PR",
    subcaption: "Warrior archetype — overhead press, conquered",
    faceHole: { cx: 75, cy: 34.6, r: 21 },
    bodyPaths: `
      <ellipse cx="75" cy="150" rx="54" ry="13" fill="#0f0e0d" opacity=".4"/>
      <path d="M75 92 L58 40 L92 40 Z" fill="#8a5a3a"/>
      <rect x="30" y="88" width="90" height="10" rx="5" fill="#5b564d"/>
      <circle cx="34" cy="93" r="16" fill="#211f1c" stroke="rgba(237,232,224,.14)" stroke-width="2"/>
      <circle cx="116" cy="93" r="16" fill="#211f1c" stroke="rgba(237,232,224,.14)" stroke-width="2"/>
      <path d="M55 95 Q75 105 95 95 L100 150 Q75 160 50 150 Z" fill="#7a8b6f"/>
      <path d="M55 96 L38 105 L44 118 L60 108 Z" fill="#a8653f"/>
      <path d="M95 96 L112 105 L106 118 L90 108 Z" fill="#a8653f"/>
    `,
  },
  {
    key: "knight",
    caption: "Knight of the Deadlift",
    subcaption: "Armored archetype — the bar has been conquered",
    faceHole: { cx: 75, cy: 26, r: 26 },
    bodyPaths: `
      <ellipse cx="75" cy="150" rx="50" ry="13" fill="#0f0e0d" opacity=".4"/>
      <path d="M75 98 L45 130 Q30 140 20 132" stroke="#5b564d" stroke-width="6" fill="none" stroke-linecap="round"/>
      <path d="M75 98 L105 130 Q120 140 130 132" stroke="#5b564d" stroke-width="6" fill="none" stroke-linecap="round"/>
      <circle cx="18" cy="130" r="7" fill="#D2703B"/>
      <circle cx="132" cy="130" r="7" fill="#D2703B"/>
      <path d="M58 78 Q75 70 92 78 L98 128 Q75 138 52 128 Z" fill="#a8653f"/>
      <path d="M60 68 Q75 60 90 68 Q88 55 75 52 Q62 55 60 68 Z" fill="#8a5a3a"/>
    `,
  },
];

// Stable per-share (never changes on reload for the same post), varies
// share to share — identical convention to volume-equivalence.ts's own
// getVolumeEquivalence and gym-jokes.ts's pickGymJoke.
export function pickHumorArchetype(seed: string): HumorArchetype {
  return seededPick(HUMOR_ARCHETYPES, `humor:${seed}`);
}
