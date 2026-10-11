// A rotating "joke of the day" for the share card — distinct from the
// volume comparison (lib/volume-equivalence.ts). Seeded by calendar
// date rather than post id, so it genuinely rotates daily and every
// share card anyone looks at today shows the same one — the literal
// meaning of "joke of the day," not a per-post pick.
import { seededPick } from "./seeded-pick";

// These appear on a card under the CLIENT'S name, so none of them is written in the first person (it would read as the client's own confession) and none is about
// a body, food, skipping, falling short, age, a coach, or guilt. They are about objects and the gym itself: puns and light absurdity. 110 characters or fewer.
export const GYM_JOKES: string[] = [
  "Why don't skeletons lift weights? They just don't have the guts. 💀",
  "What's a barbell's favorite kind of music? Heavy metal. 🎸",
  "Why did the barbell get invited everywhere? It always brings the weight to the party. 🎉",
  "Chalk dust: the confetti of the weight room. 🎊",
  "Why was the weight room so calm? Everything in it was well balanced. 🧘",
  "A set is just a short story with a good ending. 📖",
  "Reps are like good jokes: the best ones are worth repeating. 🔁",
  "Spotters: friends who show up at exactly the right moment. 🙌",
  "Protein shakes are just smoothies with a gym membership. 🥤",
  "Deadlifts are the only job where picking things up is the entire job description. 📋",
  "Rest days are when the muscles do the real work. The couch just gets the credit. 🛋️",
  "Some people count sheep. Lifters count reps, and somehow it's more fun. 🐑",
];

export function pickGymJoke(seed: string): string {
  return seededPick(GYM_JOKES, seed);
}
