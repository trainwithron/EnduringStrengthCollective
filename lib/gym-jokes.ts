// A rotating "joke of the day" for the share card — distinct from the
// volume comparison (lib/volume-equivalence.ts). Seeded by calendar
// date rather than post id, so it genuinely rotates daily and every
// share card anyone looks at today shows the same one — the literal
// meaning of "joke of the day," not a per-post pick.
import { seededPick } from "./seeded-pick";

export const GYM_JOKES: string[] = [
  "Why don't skeletons lift weights? They just don't have the guts. 💀",
  "Deadlifts and I have a complicated relationship — it's just so hard to let go. 😅",
  "PR stands for Personal Record, but today it also stands for Please Rest. 😴",
  "Whoever said abs are made in the kitchen never met a burrito. 🌯",
  "I told my trainer I wanted to lift like a pro. He said: complain about everything and leave early. 😂",
  "My bench press and my bank account have one thing in common: neither is going up fast enough. 💸",
  "Squats: because someday you'll need to sit down and stand back up without assistance. 🪑",
  "I'm not saying I skipped leg day — I'm saying my shorts still fit from three years ago. 🩳",
  "The hardest part of a workout is putting on the workout clothes. Everything after that is a bonus. 👕",
  "Cardio is my cheat day from cardio. 🏃",
  "I used to hate gym leg day, but then I took a stand. 🦵",
  "Some people count sheep. I count reps, and I'm still bad at falling asleep. 🐑",
  "My spotter and I have a great relationship — mostly built on trust and mild terror. 🙏",
  "Protein shakes: turning 'I don't want to cook' into a personality trait since forever. 🥤",
  "Rest day is just leg day for your excuses. 😴",
  "They say lifting builds character. Mine is mostly just soreness. 🎭",
  "A balanced diet is a protein bar in each hand. ⚖️",
  "I don't always skip the warmup, but when I do, I definitely regret it by set two. 🔥",
  "Gym mirrors: the only thing more honest than your coach. 🪞",
  "My favorite exercise is a cross between a lunge and a nap. Lunap. 🛌",
];

export function pickGymJoke(seed: string): string {
  return seededPick(GYM_JOKES, seed);
}
