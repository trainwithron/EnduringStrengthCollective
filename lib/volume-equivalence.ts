// Turns a raw pounds-lifted number into a fun, shareable real-world
// comparison — the whole point is to make a share card worth posting,
// not to be a precise unit converter. Seeded by the post's own id so a
// given workout's card always shows the same joke (stable across
// reloads/screenshots), while different workouts land on genuinely
// different objects and phrasing.
//
// Deliberately no real named individuals (a specific athlete/celebrity's
// body weight is the one genuinely tasteless version of this joke) and
// no trademarked characters — absurd objects, animals, and generic
// pop-culture-flavored archetypes ("a sumo wrestler," "an arcade
// cabinet") get the same cartoony effect without either risk.
import { seededPick } from "./seeded-pick";

interface ReferenceObject {
  name: string; // carries its own article, e.g. "a grizzly bear"
  pluralName: string;
  weightLbs: number;
  emoji: string;
}

// Deliberately dense and overlapping across tiers — real variety needs
// more than one candidate per weight range, not just a longer list of
// singles.
const REFERENCE_OBJECTS: ReferenceObject[] = [
  // Featherweight (~1-15 lbs)
  { name: "a Nintendo Switch", pluralName: "Nintendo Switches", weightLbs: 0.7, emoji: "🎮" },
  { name: "a bag of flour", pluralName: "bags of flour", weightLbs: 5, emoji: "🌾" },
  { name: "a chihuahua", pluralName: "chihuahuas", weightLbs: 6, emoji: "🐕" },
  { name: "a gallon of milk", pluralName: "gallons of milk", weightLbs: 8, emoji: "🥛" },
  { name: "a housecat", pluralName: "housecats", weightLbs: 10, emoji: "🐈" },
  { name: "a bowling ball", pluralName: "bowling balls", weightLbs: 14, emoji: "🎳" },

  // Small (~15-100 lbs)
  { name: "a watermelon", pluralName: "watermelons", weightLbs: 20, emoji: "🍉" },
  { name: "a car tire", pluralName: "car tires", weightLbs: 25, emoji: "🛞" },
  { name: "a folding chair", pluralName: "folding chairs", weightLbs: 30, emoji: "🪑" },
  { name: "a bulldog", pluralName: "bulldogs", weightLbs: 50, emoji: "🐶" },
  { name: "a keg of beer", pluralName: "kegs of beer", weightLbs: 60, emoji: "🍺" },
  { name: "a mannequin", pluralName: "mannequins", weightLbs: 65, emoji: "🧍" },
  { name: "a Golden Retriever", pluralName: "Golden Retrievers", weightLbs: 70, emoji: "🐕‍🦺" },
  { name: "an anvil", pluralName: "anvils", weightLbs: 100, emoji: "⚒️" },

  // Medium (~100-500 lbs)
  { name: "a vending machine", pluralName: "vending machines", weightLbs: 150, emoji: "🥤" },
  { name: "a slot machine", pluralName: "slot machines", weightLbs: 200, emoji: "🎰" },
  { name: "an arcade cabinet", pluralName: "arcade cabinets", weightLbs: 250, emoji: "🕹️" },
  { name: "a disco ball", pluralName: "disco balls", weightLbs: 275, emoji: "🪩" },
  { name: "a sumo wrestler", pluralName: "sumo wrestlers", weightLbs: 350, emoji: "🤼" },
  { name: "a grizzly bear", pluralName: "grizzly bears", weightLbs: 400, emoji: "🐻" },
  { name: "a motorcycle", pluralName: "motorcycles", weightLbs: 500, emoji: "🏍️" },

  // Large (~500-2,000 lbs)
  { name: "a grand piano", pluralName: "grand pianos", weightLbs: 1000, emoji: "🎹" },
  { name: "a photo booth", pluralName: "photo booths", weightLbs: 800, emoji: "📸" },
  { name: "a bull", pluralName: "bulls", weightLbs: 1500, emoji: "🐂" },
  { name: "a hot tub", pluralName: "hot tubs", weightLbs: 1200, emoji: "🛁" },
  { name: "a Volkswagen Beetle", pluralName: "Volkswagen Beetles", weightLbs: 2000, emoji: "🚗" },

  // Extra large (~2,000-10,000 lbs)
  { name: "a wrecking ball", pluralName: "wrecking balls", weightLbs: 3000, emoji: "💥" },
  { name: "a Smart car", pluralName: "Smart cars", weightLbs: 2000, emoji: "🚙" },
  { name: "a pickup truck", pluralName: "pickup trucks", weightLbs: 5000, emoji: "🛻" },
  { name: "a hippopotamus", pluralName: "hippopotamuses", weightLbs: 4000, emoji: "🦛" },
  { name: "a great white shark", pluralName: "great white sharks", weightLbs: 5000, emoji: "🦈" },
  { name: "an empty shipping container", pluralName: "empty shipping containers", weightLbs: 5000, emoji: "📦" },

  // Huge (~10,000-30,000 lbs)
  { name: "a baby elephant", pluralName: "baby elephants", weightLbs: 10000, emoji: "🐘" },
  { name: "a T-Rex", pluralName: "T-Rexes", weightLbs: 15000, emoji: "🦖" },
  { name: "a school bus", pluralName: "school buses", weightLbs: 20000, emoji: "🚌" },
  { name: "a firetruck", pluralName: "firetrucks", weightLbs: 30000, emoji: "🚒" },

  // Absurd (~90,000+ lbs)
  { name: "a Boeing 737", pluralName: "Boeing 737s", weightLbs: 90000, emoji: "✈️" },
  { name: "a blue whale", pluralName: "blue whales", weightLbs: 300000, emoji: "🐋" },
].sort((a, b) => a.weightLbs - b.weightLbs);

// A ratio in this range reads as a real, legible comparison — "0.02x" or
// "40,000x" would either round to nothing or be nonsense to picture.
const MIN_RATIO = 0.5;
const MAX_RATIO = 12;

const PHRASE_TEMPLATES: ((label: string, singular: string, emoji: string) => string)[] = [
  (label, _s, emoji) => `That's the weight of ${label}. ${emoji}`,
  (label, _s, emoji) => `Talk about heavy lifting — that's ${label} right there. ${emoji}`,
  (label, _s, emoji) => `Well, that's a lot of gains: ${label} worth, to be exact. ${emoji}`,
  (label, singular, emoji) => `Somewhere, ${singular} is filing a complaint. ${emoji}`,
  (label, _s, emoji) => `No bones about it — you just moved ${label}. ${emoji}`,
  (label, _s, emoji) => `Plot twist: you just out-lifted ${label}. ${emoji}`,
];

export interface VolumeEquivalence {
  count: number;
  singular: string;
  plural: string;
  emoji: string;
  label: string; // "15 Volkswagen Beetles" / "1 Volkswagen Beetle"
  text: string; // the fully composed, ready-to-render sentence
}

export function getVolumeEquivalence(totalVolumeLbs: number, seed: string): VolumeEquivalence | null {
  if (!totalVolumeLbs || totalVolumeLbs <= 0) return null;

  const inRange = REFERENCE_OBJECTS.filter((ref) => {
    const ratio = totalVolumeLbs / ref.weightLbs;
    return ratio >= MIN_RATIO && ratio <= MAX_RATIO;
  });

  // Nothing landed in the legible range (a genuinely tiny or enormous
  // volume) — fall back to whichever single object's ratio is closest to
  // 1x, same "always show something" philosophy as before.
  const candidates =
    inRange.length > 0
      ? inRange
      : [
          REFERENCE_OBJECTS.reduce((closest, ref) => {
            const closestDist = Math.abs(Math.log(totalVolumeLbs / closest.weightLbs));
            const refDist = Math.abs(Math.log(totalVolumeLbs / ref.weightLbs));
            return refDist < closestDist ? ref : closest;
          }),
        ];

  const ref = seededPick(candidates, seed);
  const rawCount = totalVolumeLbs / ref.weightLbs;
  const count = rawCount >= 10 ? Math.round(rawCount) : Math.round(rawCount * 10) / 10;
  if (count <= 0) return null;

  // ref.name carries its own article ("a Volkswagen Beetle") for use in
  // prose elsewhere; the count-prefixed label drops it ("1 Volkswagen
  // Beetle") since "1 a Volkswagen Beetle" reads wrong.
  const singularNoArticle = ref.name.replace(/^(a|an)\s+/i, "");
  const label = `${count} ${count === 1 ? singularNoArticle : ref.pluralName}`;

  const template = seededPick(PHRASE_TEMPLATES, `${seed}:phrase`);

  return {
    count,
    singular: ref.name,
    plural: ref.pluralName,
    emoji: ref.emoji,
    label,
    text: template(label, ref.name, ref.emoji),
  };
}
