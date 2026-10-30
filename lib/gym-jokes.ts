// A rotating "joke of the day" for the share card — distinct from the
// volume comparison (lib/volume-equivalence.ts). Seeded by calendar
// date rather than post id, so it genuinely rotates daily and every
// share card anyone looks at today shows the same one — the literal
// meaning of "joke of the day," not a per-post pick.
import { seededPick } from "./seeded-pick";

// These appear on a card under the CLIENT'S name, so none of them is written in the first person (it would read as the client's own confession) and none is about
// a body, food, skipping, falling short, age, a coach, or guilt. They are about objects and the gym itself: puns and light absurdity. 110 characters or fewer.
export const GYM_JOKES: string[] = [
  "Lifting weights: picking up heavy things and putting them back exactly where they were. On purpose. 🤷",
  "Gravity tried. Gravity lost. Gravity will be back tomorrow. 🌍",
  "The dumbbells would like a word. They are very tired. 😮‍💨",
  "Scientists confirm the bar did not get any lighter. Somebody just got stronger. 🔬",
  "Those weights came in expecting an easy day. They did not get one. 😤",
  "Barbell and lifter: not friends, but very respectful coworkers. 🤝",
  "Today's workout was brought to you by stubbornness and a good playlist. 🎧",
  "Somewhere, a treadmill is wondering why nobody calls anymore. 📞",
  "The floor is undefeated. Today it was a little nervous, though. 😬",
  "Breaking news: local weights picked up again, put down again. Story developing. 📰",
  "Somewhere, a couch is filing a missing person report. 🛋️",
  "The gym called. It wants to name a bench after this workout. 🪑",
  "Plates were stacked. Plates were lifted. No dishes were harmed. 🍽️",
  "What do you call a dinosaur that lifts? A dino-SORE. 🦖",
  "Why did the kettlebell need a nap? Too many swings in one day. 🎢",
  "Why don't skeletons lift weights? They just don't have the guts. 💀",
  "What's a barbell's favorite kind of music? Heavy metal. 🎸",
  "Chalk dust: the confetti of the weight room. 🎊",
  "Rest days are when the muscles do the real work. The couch just takes the credit. 🛋️",
  "Protein shakes are just smoothies with a gym membership. 🥤",
  "Foam roller? More like a human rolling pin.",
  // Approved by Ron earlier (lib/fun-lines-faith.test.ts holds them).
  "What goes down hopefully goes back up. Just stand up.",
  "Why do lifters make great friends? Because they're always there to lift you up. (Never gonna give you up. 🎤)",
];

// King James Bible (public domain), shown with the reference. They appear only for a client whose faith setting is on (Read during rest, "faith track": on by default, one tap to turn off),
// and never on the public card of anyone who turned it off (lib/workout-fun-line.ts takes the setting; the share page reads the author's).
export const FAITH_LINES: string[] = [
  "They that wait upon the LORD shall renew their strength. (Isaiah 40:31)",
  "Whatsoever ye do, do it heartily. (Colossians 3:23)",
  "Iron sharpeneth iron. (Proverbs 27:17)",
  "Let us not be weary in well doing. (Galatians 6:9)",
  "Let us run with patience the race that is set before us. (Hebrews 12:1)",
  "Bodily exercise profiteth little: but godliness is profitable unto all things. (1 Timothy 4:8)",
];

export function pickGymJoke(seed: string): string {
  return seededPick(GYM_JOKES, seed);
}
