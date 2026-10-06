import { canonicalKey } from "./exercise-normaliser";
import { extractYoutubeId } from "./youtube";

// Finding the demo video for an exercise by what the exercise IS, not by the exact text typed (Ron, Oct 6): a coach's library often holds the same movement
// twice ("Bulgarian Split Squat" and "Bulgarian Split Squats") with the video on only one of them, or under a plain name the program does not use. So the
// lookup tries, in order:
//   1. the exact name (case and spacing aside), if that row has a demo;
//   2. any row that is the same exercise spelled differently (plural, hyphen, word order, abbreviation: lib/exercise-normaliser.ts);
//   3. a row for a movement that is known by two names (a Bulgarian split squat is a rear foot elevated split squat).
// A row with an uploaded video wins over one with only a YouTube link; ties go to the shorter name, then alphabetically, so the choice never flips.
// Two different movements that merely share a word are never matched ("Reverse Lunge" does not borrow the "Walking Lunge" video).

export interface DemoRow {
  name: string;
  videoPath: string | null;
  youtubeUrl: string | null;
}

export interface Demo {
  videoPath: string | null;
  youtubeUrl: string | null;
  // The library name the demo was found under, when it differs from what was asked for (so the sheet can say "Demo: Rear Foot Elevated Split Squat").
  foundAs: string;
}

// Movements that go by two names. Written as ordinary names; compared by canonical key, so plurals and word order do not matter.
const SAME_MOVEMENT: string[][] = [
  ["Bulgarian Split Squat", "Rear Foot Elevated Split Squat"],
  ["Romanian Deadlift", "RDL"],
  ["Stiff Leg Deadlift", "Straight Leg Deadlift"],
  ["Lat Pulldown", "Lat Pull Down"],
  ["Skull Crusher", "Lying Triceps Extension"],
];

const aliasGroupByKey = new Map<string, string>();
SAME_MOVEMENT.forEach((names, i) => names.forEach((n) => aliasGroupByKey.set(canonicalKey(n), `g${i}`)));

function hasDemo(r: DemoRow): boolean {
  return !!(r.videoPath || (r.youtubeUrl && extractYoutubeId(r.youtubeUrl)));
}

function better(a: DemoRow, b: DemoRow): number {
  const au = a.videoPath ? 0 : 1;
  const bu = b.videoPath ? 0 : 1;
  if (au !== bu) return au - bu;
  if (a.name.length !== b.name.length) return a.name.length - b.name.length;
  return a.name.localeCompare(b.name);
}

function pick(rows: DemoRow[]): DemoRow | null {
  return rows.length === 0 ? null : [...rows].sort(better)[0];
}

export function findDemo(rows: DemoRow[], name: string): Demo | null {
  const wanted = name.trim().toLowerCase();
  if (!wanted) return null;
  const withDemo = rows.filter(hasDemo);
  if (withDemo.length === 0) return null;
  const toDemo = (r: DemoRow): Demo => ({ videoPath: r.videoPath, youtubeUrl: r.youtubeUrl, foundAs: r.name });

  const exact = pick(withDemo.filter((r) => r.name.trim().toLowerCase() === wanted));
  if (exact) return toDemo(exact);

  const key = canonicalKey(name);
  if (!key) return null;
  const sameKey = pick(withDemo.filter((r) => canonicalKey(r.name) === key));
  if (sameKey) return toDemo(sameKey);

  const group = aliasGroupByKey.get(key);
  if (group) {
    const sameMovement = pick(withDemo.filter((r) => aliasGroupByKey.get(canonicalKey(r.name)) === group));
    if (sameMovement) return toDemo(sameMovement);
  }
  return null;
}

// The privacy-friendly YouTube embed, never autoplaying, staying inside the page on a phone.
export function youtubeEmbedUrl(url: string): string | null {
  const id = extractYoutubeId(url);
  return id ? `https://www.youtube-nocookie.com/embed/${id}?rel=0&playsinline=1` : null;
}

// The thumbnail on the card. The picture is fetched by our own server (app/api/demo-thumb/[id]/route.ts) so the phone never contacts Google for it.
export function isYoutubeId(id: string): boolean {
  return /^[A-Za-z0-9_-]{11}$/.test(id);
}

export function youtubeThumbSource(id: string): string {
  return `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
}

export function demoThumbPath(youtubeUrl: string | null): string | null {
  const id = youtubeUrl ? extractYoutubeId(youtubeUrl) : null;
  return id ? `/api/demo-thumb/${id}` : null;
}
