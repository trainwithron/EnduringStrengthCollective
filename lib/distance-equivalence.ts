// "If those pounds were miles": the pounds lifted, read as a distance. A second kind of comparison next to the weight comparisons (lib/volume-equivalence.ts); the post-workout
// fun line mixes them (about one in six). Every distance carries a source note, and a test holds that. Phrasing is clean and never about the person's body or performance.
import { seededPick } from "./seeded-pick";

interface DistanceUnit {
  key: string;
  miles: number;
  emoji: string;
  // Where the distance comes from (a test requires one).
  source: string;
  // "you ran 46 marathons" -> the part after "If those pounds were miles, "
  times: (count: string) => string;
  once: string;
  half?: string;
}

export const DISTANCE_UNITS: DistanceUnit[] = [
  { key: "marathon", miles: 26.2, emoji: "🏃", source: "a marathon is 26.2 miles (42.195 km), World Athletics", times: (n) => `you'd have run ${n} marathons`, once: "you'd have run a marathon" },
  { key: "vegas-la", miles: 270, emoji: "🚗", source: "about 270 road miles, Las Vegas to Los Angeles (Google Maps / AAA road distance)", times: (n) => `you'd have driven from Las Vegas to LA ${n} times`, once: "you'd have driven from Las Vegas to LA" },
  { key: "vegas-birmingham", miles: 1820, emoji: "🚗", source: "about 1,820 road miles, Las Vegas to Birmingham, Alabama (driving; airmilescalculator.com 1,817, mapsofworld 1,835)", times: (n) => `you'd have driven from Las Vegas to Birmingham, Alabama ${n} times`, once: "you'd have driven from Las Vegas to Birmingham, Alabama" },
  { key: "appalachian-trail", miles: 2190, emoji: "🥾", source: "the Appalachian Trail is about 2,190 miles (Appalachian Trail Conservancy)", times: (n) => `you'd have hiked the whole Appalachian Trail ${n} times`, once: "you'd have hiked the whole Appalachian Trail" },
  { key: "coast-to-coast", miles: 2800, emoji: "🗺️", source: "about 2,800 road miles, New York to Los Angeles (Google Maps)", times: (n) => `you'd have crossed the country coast to coast ${n} times`, once: "you'd have crossed the country coast to coast" },
  {
    key: "around-earth",
    miles: 24901,
    emoji: "🌍",
    source: "Earth's circumference at the equator is 24,901 miles (NASA)",
    times: (n) => `you'd have gone around the Earth ${n} times`,
    once: "you'd have gone all the way around the Earth",
    half: "you'd be about halfway around the Earth",
  },
  { key: "to-moon", miles: 238900, emoji: "🌙", source: "the Moon is about 238,900 miles away on average (NASA)", times: (n) => `you'd have gone to the Moon ${n} times`, once: "you'd have made it to the Moon" },
  { key: "moon-and-back", miles: 477800, emoji: "🚀", source: "twice the average Earth-Moon distance of 238,900 miles (NASA)", times: (n) => `you'd have gone to the Moon and back ${n} times`, once: "you'd have gone to the Moon and back" },
];

export interface DistanceEquivalence {
  id: string; // "miles:marathon"
  text: string;
}

function lineFor(unit: DistanceUnit, pounds: number): string | null {
  const ratio = pounds / unit.miles;
  if (ratio >= 2 && ratio <= 999) return `If those pounds were miles, ${unit.times(String(Math.round(ratio)))}. ${unit.emoji}`;
  if (ratio >= 0.9 && ratio <= 1.1) return `If those pounds were miles, ${unit.once}. ${unit.emoji}`;
  if (unit.half && ratio >= 0.4 && ratio <= 0.6) return `If those pounds were miles, ${unit.half}. ${unit.emoji}`;
  return null;
}

// Every distance line this workout's pounds can honestly make.
export function distanceCandidates(pounds: number): DistanceEquivalence[] {
  if (!Number.isFinite(pounds) || pounds <= 0) return [];
  const out: DistanceEquivalence[] = [];
  for (const unit of DISTANCE_UNITS) {
    const text = lineFor(unit, pounds);
    if (text) out.push({ id: `miles:${unit.key}`, text });
  }
  return out;
}

// One of them, picked by the seed (null when none fits).
export function getDistanceEquivalence(pounds: number, seed: string): DistanceEquivalence | null {
  const candidates = distanceCandidates(pounds);
  return candidates.length > 0 ? seededPick(candidates, seed) : null;
}
