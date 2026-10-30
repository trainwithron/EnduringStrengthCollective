// Turns a raw pounds-lifted number into a fun, shareable real-world comparison: "you lifted 38 grizzly bears", "about 280 thousand jellybeans". The point is to make a card
// worth posting, not to be a precise converter. Seeded by the post's own id so a given workout's card always shows the same one (stable across reloads and screenshots),
// while different workouts land on different units and phrasing.
//
// Deliberately no real named individuals (a specific athlete's or celebrity's weight is the one tasteless version of this joke). Fictional characters and their gear ARE in,
// by their official listed weight (Ron, Oct 29: "some of the stuff my clients loved was, you lifted the weight of 26 Snorlaxes, or 19 Hulks, or 97 of Captain America's shield":
// pop culture is the comparison people post). Only the name is used, never a logo or picture. Every unit has a `source` (where its weight comes from) and a test requires one.
import { seededPick } from "./seeded-pick";
import { countPhrase } from "./number-words";

export interface ReferenceObject {
  name: string; // carries its own article, e.g. "a grizzly bear"
  pluralName: string;
  weightLbs: number;
  emoji: string;
  // Where the weight comes from. Typical or average values are rounded; the number is a fun comparison, not a measurement.
  source: string;
  // A pop-culture character or prop: the post-workout card shows these most of the time.
  pop?: boolean;
}

const REFERENCE_OBJECTS_UNSORTED: ReferenceObject[] = [
  // Pop culture, by the official listed weight
  { name: "a Jigglypuff", pluralName: "Jigglypuffs", weightLbs: 12.1, emoji: "🎤", source: "Pokédex: 5.5 kg (12.1 lb)", pop: true },
  { name: "a Captain America shield", pluralName: "Captain America shields", weightLbs: 12, emoji: "🛡️", source: "Marvel: the shield weighs 12 lb", pop: true },
  { name: "a Pikachu", pluralName: "Pikachus", weightLbs: 13.2, emoji: "⚡", source: "Pokédex: 6.0 kg (13.2 lb)", pop: true },
  { name: "a Bulbasaur", pluralName: "Bulbasaurs", weightLbs: 15.2, emoji: "🌱", source: "Pokédex: 6.9 kg (15.2 lb)", pop: true },
  { name: "a Thor's hammer", pluralName: "Thor's hammers", weightLbs: 42.3, emoji: "🔨", source: "Marvel handbook: Mjolnir weighs 42.3 lb", pop: true },
  { name: "a Gengar", pluralName: "Gengars", weightLbs: 89.3, emoji: "👻", source: "Pokédex: 40.5 kg (89.3 lb)", pop: true },
  { name: "a Charizard", pluralName: "Charizards", weightLbs: 199.5, emoji: "🔥", source: "Pokédex: 90.5 kg (199.5 lb)", pop: true },
  { name: "a Machamp", pluralName: "Machamps", weightLbs: 286.6, emoji: "💪", source: "Pokédex: 130 kg (286.6 lb)", pop: true },
  { name: "a Wolverine", pluralName: "Wolverines", weightLbs: 300, emoji: "🗡️", source: "Marvel handbook: 300 lb with the adamantium skeleton", pop: true },
  { name: "an Onix", pluralName: "Onixes", weightLbs: 463, emoji: "🪨", source: "Pokédex: 210 kg (463 lb)", pop: true },
  { name: "a Gyarados", pluralName: "Gyarados", weightLbs: 518.1, emoji: "🐉", source: "Pokédex: 235 kg (518.1 lb)", pop: true },
  { name: "a Wailord", pluralName: "Wailords", weightLbs: 877.4, emoji: "🐳", source: "Pokédex: 398 kg (877.4 lb)", pop: true },
  { name: "a Thanos", pluralName: "Thanoses", weightLbs: 985, emoji: "🧤", source: "Marvel handbook: Thanos 985 lb", pop: true },
  { name: "a Snorlax", pluralName: "Snorlaxes", weightLbs: 1014.1, emoji: "😴", source: "Pokédex: 460 kg (1,014.1 lb)", pop: true },
  { name: "a Hulk", pluralName: "Hulks", weightLbs: 1040, emoji: "💚", source: "Marvel handbook: the Hulk 1,040 lb", pop: true },
  { name: "a Groudon", pluralName: "Groudons", weightLbs: 2094.4, emoji: "🌋", source: "Pokédex: 950 kg (2,094.4 lb)", pop: true },
  { name: "a Meowth", pluralName: "Meowths", weightLbs: 9.3, emoji: "😼", source: "Pokédex: 4.2 kg (9.3 lb)", pop: true },
  { name: "a Mew", pluralName: "Mews", weightLbs: 8.8, emoji: "🩷", source: "Pokédex: 4.0 kg (8.8 lb)", pop: true },
  { name: "an Eevee", pluralName: "Eevees", weightLbs: 14.3, emoji: "🦊", source: "Pokédex: 6.5 kg (14.3 lb)", pop: true },
  { name: "a Charmander", pluralName: "Charmanders", weightLbs: 18.7, emoji: "🦎", source: "Pokédex: 8.5 kg (18.7 lb)", pop: true },
  { name: "a Squirtle", pluralName: "Squirtles", weightLbs: 19.8, emoji: "🐢", source: "Pokédex: 9.0 kg (19.8 lb)", pop: true },
  { name: "a Psyduck", pluralName: "Psyducks", weightLbs: 43.2, emoji: "🦆", source: "Pokédex: 19.6 kg (43.2 lb)", pop: true },
  { name: "a Lucario", pluralName: "Lucarios", weightLbs: 119, emoji: "🥋", source: "Pokédex: 54.0 kg (119.0 lb)", pop: true },
  { name: "a Mewtwo", pluralName: "Mewtwos", weightLbs: 269, emoji: "🧠", source: "Pokédex: 122.0 kg (269.0 lb)", pop: true },
  { name: "a Rayquaza", pluralName: "Rayquazas", weightLbs: 455.3, emoji: "🐲", source: "Pokédex: 206.5 kg (455.3 lb)", pop: true },
  { name: "a Dragonite", pluralName: "Dragonites", weightLbs: 463, emoji: "🐉", source: "Pokédex: 210.0 kg (463.0 lb)", pop: true },
  { name: "a Lapras", pluralName: "Lapras", weightLbs: 485, emoji: "🌊", source: "Pokédex: 220.0 kg (485.0 lb)", pop: true },
  { name: "a Celesteela", pluralName: "Celesteelas", weightLbs: 2204.4, emoji: "🚀", source: "Pokédex: 999.9 kg (2,204.4 lb)", pop: true },
  { name: "a Spider-Man", pluralName: "Spider-Men", weightLbs: 167, emoji: "🕷️", source: "Marvel handbook: Peter Parker 167 lb", pop: true },
  { name: "a Black Panther", pluralName: "Black Panthers", weightLbs: 200, emoji: "🐾", source: "Marvel handbook: T'Challa 200 lb", pop: true },
  { name: "a Captain America", pluralName: "Captain Americas", weightLbs: 220, emoji: "⭐", source: "Marvel handbook: Steve Rogers 220 lb", pop: true },
  { name: "a Colossus", pluralName: "Colossuses", weightLbs: 500, emoji: "🔩", source: "Marvel handbook: Colossus in steel form 500 lb", pop: true },
  { name: "a Thor", pluralName: "Thors", weightLbs: 640, emoji: "⚡", source: "Marvel handbook: Thor 640 lb", pop: true },
  { name: "a Juggernaut", pluralName: "Juggernauts", weightLbs: 1900, emoji: "🪖", source: "Marvel handbook: the Juggernaut 1,900 lb", pop: true },
  { name: "a Batman", pluralName: "Batmen", weightLbs: 210, emoji: "🦇", source: "DC: Bruce Wayne 210 lb", pop: true },
  { name: "a Superman", pluralName: "Supermen", weightLbs: 235, emoji: "🦸", source: "DC: Clark Kent 235 lb", pop: true },
  { name: "a Yoda", pluralName: "Yodas", weightLbs: 28.7, emoji: "🟢", source: "Wookieepedia: Yoda 13 kg (28.7 lb)", pop: true },
  { name: "a BB-8", pluralName: "BB-8s", weightLbs: 39.7, emoji: "🟠", source: "Wookieepedia: BB-8 18 kg (39.7 lb)", pop: true },
  { name: "an R2-D2", pluralName: "R2-D2s", weightLbs: 70.5, emoji: "🤖", source: "Wookieepedia: R2-D2 32 kg (70.5 lb)", pop: true },
  { name: "a C-3PO", pluralName: "C-3POs", weightLbs: 165, emoji: "🤖", source: "Wookieepedia: C-3PO 75 kg (165 lb)", pop: true },
  { name: "a Wookiee", pluralName: "Wookiees", weightLbs: 247, emoji: "🐻", source: "Wookieepedia: Chewbacca 112 kg (247 lb)", pop: true },
  { name: "a Darth Vader", pluralName: "Darth Vaders", weightLbs: 265, emoji: "🖤", source: "Wookieepedia: Darth Vader 120 kg (265 lb)", pop: true },
  { name: "a Jabba the Hutt", pluralName: "Jabba the Hutts", weightLbs: 2994, emoji: "🐌", source: "Wookieepedia: Jabba 1,358 kg (2,994 lb)", pop: true },
  { name: "a Sonic the Hedgehog", pluralName: "Sonic the Hedgehogs", weightLbs: 77, emoji: "💨", source: "Sonic official profile: 35 kg (77 lb)", pop: true },
  { name: "a DeLorean", pluralName: "DeLoreans", weightLbs: 2712, emoji: "⏱️", source: "DMC-12 (the time machine car) curb weight about 2,712 lb", pop: true },
  // Tiny
  { name: "a jellybean", pluralName: "jellybeans", weightLbs: 0.0025, emoji: "🍬", source: "a Jelly Belly bean is about 1.1 g" },
  { name: "a newborn kangaroo joey", pluralName: "newborn kangaroo joeys", weightLbs: 0.002, emoji: "🦘", source: "a newborn red kangaroo is about 1 g (0.03 oz, as in lib/transformation-joke-bank.ts)" },
  { name: "a pet hamster", pluralName: "pet hamsters", weightLbs: 0.25, emoji: "🐹", source: "a Syrian hamster is about 100-150 g" },
  { name: "a baseball", pluralName: "baseballs", weightLbs: 0.33, emoji: "⚾", source: "MLB rule: 5 to 5.25 oz" },
  { name: "a handheld game console", pluralName: "handheld game consoles", weightLbs: 0.7, emoji: "🎮", source: "a typical handheld console is about 0.7 lb" },
  // Featherweight
  { name: "a bag of flour", pluralName: "bags of flour", weightLbs: 5, emoji: "🌾", source: "the common US bag is 5 lb" },
  { name: "a chihuahua", pluralName: "chihuahuas", weightLbs: 6, emoji: "🐕", source: "AKC: up to 6 lb" },
  { name: "a newborn baby", pluralName: "newborn babies", weightLbs: 7.5, emoji: "👶", source: "CDC: average US birth weight about 7.5 lb" },
  { name: "a gallon of milk", pluralName: "gallons of milk", weightLbs: 8.6, emoji: "🥛", source: "a US gallon of milk is about 8.6 lb" },
  { name: "a housecat", pluralName: "housecats", weightLbs: 10, emoji: "🐈", source: "a typical adult housecat is about 10 lb" },
  { name: "a bowling ball", pluralName: "bowling balls", weightLbs: 14, emoji: "🎳", source: "a common heavy ball is 14 lb (USBC maximum is 16 lb)" },
  // Small
  { name: "a watermelon", pluralName: "watermelons", weightLbs: 20, emoji: "🍉", source: "a typical watermelon is 15-25 lb" },
  { name: "a car tire", pluralName: "car tires", weightLbs: 25, emoji: "🛞", source: "a typical passenger tire is 20-30 lb" },
  { name: "a bulldog", pluralName: "bulldogs", weightLbs: 50, emoji: "🐶", source: "AKC: 40-50 lb" },
  { name: "a keg of beer", pluralName: "kegs of beer", weightLbs: 58, emoji: "🍺", source: "a full sixth-barrel keg is about 58 lb (a full half barrel is about 160 lb)" },
  { name: "a Golden Retriever", pluralName: "Golden Retrievers", weightLbs: 70, emoji: "🐕‍🦺", source: "AKC: 55-75 lb" },
  { name: "an anvil", pluralName: "anvils", weightLbs: 100, emoji: "⚒️", source: "a common blacksmith anvil is 100 lb (the usual 'hundredweight' size)" },
  // Medium
  { name: "a slot machine", pluralName: "slot machines", weightLbs: 200, emoji: "🎰", source: "a casino slot machine is about 200-300 lb" },
  { name: "an arcade cabinet", pluralName: "arcade cabinets", weightLbs: 270, emoji: "🕹️", source: "an upright arcade cabinet is about 250-300 lb" },
  { name: "a sumo wrestler", pluralName: "sumo wrestlers", weightLbs: 340, emoji: "🤼", source: "top-division average is about 155 kg (340 lb), Japan Sumo Association" },
  { name: "a grizzly bear", pluralName: "grizzly bears", weightLbs: 400, emoji: "🐻", source: "National Park Service: adult males are about 400-700 lb (400 used)" },
  { name: "a motorcycle", pluralName: "motorcycles", weightLbs: 500, emoji: "🏍️", source: "a typical touring motorcycle is about 500-800 lb" },
  { name: "a vending machine", pluralName: "vending machines", weightLbs: 700, emoji: "🥤", source: "a full drink vending machine is about 600-800 lb" },
  // Large
  { name: "a grand piano", pluralName: "grand pianos", weightLbs: 990, emoji: "🎹", source: "a concert grand piano is about 990 lb (Steinway model D)" },
  { name: "a hot tub", pluralName: "hot tubs", weightLbs: 1200, emoji: "🛁", source: "an empty hot tub is about 800-1,500 lb" },
  { name: "a bull", pluralName: "bulls", weightLbs: 1500, emoji: "🐂", source: "a mature bull is about 1,500-2,000 lb" },
  // Extra large
  { name: "a compact car", pluralName: "compact cars", weightLbs: 2900, emoji: "🚗", source: "a typical compact sedan is about 2,800-3,000 lb" },
  { name: "a hippopotamus", pluralName: "hippopotamuses", weightLbs: 3500, emoji: "🦛", source: "an adult hippo is about 3,000-4,000 lb" },
  { name: "a pickup truck", pluralName: "pickup trucks", weightLbs: 5000, emoji: "🛻", source: "a full-size pickup is about 4,000-5,700 lb" },
  { name: "an empty shipping container", pluralName: "empty shipping containers", weightLbs: 5000, emoji: "📦", source: "a 20-ft container is about 5,000 lb empty (tare)" },
  // Huge
  { name: "a bull elephant", pluralName: "bull elephants", weightLbs: 12000, emoji: "🐘", source: "an African savanna bull averages about 5,500 kg (12,000 lb)" },
  { name: "a T-Rex", pluralName: "T-Rexes", weightLbs: 18000, emoji: "🦖", source: "estimates for large specimens are about 8,000-9,500 kg (18,000-21,000 lb)" },
  { name: "a school bus", pluralName: "school buses", weightLbs: 25000, emoji: "🚌", source: "a full-size Type C bus is about 24,000-27,000 lb empty" },
  { name: "a firetruck", pluralName: "firetrucks", weightLbs: 36000, emoji: "🚒", source: "a pumper truck is about 30,000-50,000 lb" },
  // Absurd
  { name: "a passenger jet", pluralName: "passenger jets", weightLbs: 91000, emoji: "✈️", source: "a Boeing 737-800 is about 91,300 lb empty (operating empty weight)" },
  { name: "a blue whale", pluralName: "blue whales", weightLbs: 200000, emoji: "🐋", source: "typical adults are about 100-150 tons (200,000-300,000 lb); the record is about 330,000 lb" },
  { name: "a Statue of Liberty", pluralName: "Statues of Liberty", weightLbs: 450000, emoji: "🗽", source: "National Park Service handbook: 450,000 lb (225 tons)" },
];

export const REFERENCE_OBJECTS: ReferenceObject[] = REFERENCE_OBJECTS_UNSORTED.slice().sort((a, b) => a.weightLbs - b.weightLbs);

// A comparison reads well from "2" up. A thing that is nearly exactly one reads as "about one". The top is high enough for "about 4.8 million jellybeans" but not for
// something that is nonsense to picture.
const MIN_COUNT = 2;
const NEAR_ONE = 0.9;
const NEAR_ONE_TOP = 1.15;
const MAX_COUNT = 5_000_000;

// Absurd, not informative (Ron, Oct 29: the old lines were "not funny equivalencies ... not absurd"). Each reads with a count ("38 grizzly bears") and with "about one school bus".
const PHRASE_TEMPLATES: ((label: string, singular: string, emoji: string) => string)[] = [
  // The plain one is the one clients loved ("you lifted the weight of 26 Snorlaxes"), so it comes up most.
  (label, _s, emoji) => `You lifted the weight of ${label}. ${emoji}`,
  (label, _s, emoji) => `You lifted the weight of ${label}. ${emoji}`,
  (label, _s, emoji) => `You lifted the weight of ${label}. ${emoji}`,
  (label, _s, emoji) => `That's ${label}. Please do not try this with the real thing. ${emoji}`,
  (label, _s, emoji) => `You moved ${label} today. A moving company would like your number. ${emoji}`,
  (label, singular, emoji) => `That's ${label}. Somewhere, ${singular} is filing a complaint. ${emoji}`,
  (label, _s, emoji) => `That's ${label}, and not one thank-you. Rude. ${emoji}`,
  (label, _s, emoji) => `That's ${label}. Nobody needed to know, but now everyone does. ${emoji}`,
  (label, _s, emoji) => `Plot twist: you just out-lifted ${label}. ${emoji}`,
];

export interface VolumeEquivalence {
  id: string; // stable per object ("equiv:a grizzly bear"), so a line can be remembered and not repeated
  count: number;
  singular: string;
  plural: string;
  emoji: string;
  label: string; // "38 grizzly bears" / "about 280 thousand jellybeans" / "about one Statue of Liberty"
  text: string; // the fully composed, ready-to-render sentence
}

// `popOnly`: only the pop-culture units (null when none fits these pounds).
export function getVolumeEquivalence(totalVolumeLbs: number, seed: string, opts: { popOnly?: boolean } = {}): VolumeEquivalence | null {
  if (!totalVolumeLbs || totalVolumeLbs <= 0 || !Number.isFinite(totalVolumeLbs)) return null;

  const inRange = REFERENCE_OBJECTS.filter((ref) => !opts.popOnly || ref.pop).filter((ref) => {
    const ratio = totalVolumeLbs / ref.weightLbs;
    return (ratio >= MIN_COUNT && ratio <= MAX_COUNT) || (ratio >= NEAR_ONE && ratio <= NEAR_ONE_TOP);
  });

  // Nothing landed in the legible range (a volume smaller than the lightest thing or enormously large): the single unit whose count is closest to one.
  if (inRange.length === 0 && opts.popOnly) return null;
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
  const count = rawCount >= 1000 ? rawCount : Math.max(1, Math.round(rawCount));
  const phrase = countPhrase(rawCount);

  // ref.name carries its own article ("a school bus") for prose elsewhere; the count-prefixed label drops it ("38 school buses", "about one school bus").
  const singularNoArticle = ref.name.replace(/^(a|an)\s+/i, "");
  const label = phrase === "about one" ? `${phrase} ${singularNoArticle}` : `${phrase} ${ref.pluralName}`;

  const template = seededPick(PHRASE_TEMPLATES, `${seed}:phrase`);

  return {
    id: `equiv:${ref.name}`,
    count,
    singular: ref.name,
    plural: ref.pluralName,
    emoji: ref.emoji,
    label,
    text: template(label, ref.name, ref.emoji),
  };
}
