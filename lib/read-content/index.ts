import { KJV_DAILY } from "@/lib/read-content/kjv-daily";

// "Read" during rest: a short reading shown while the rest timer runs. The text is BUNDLED in the app (no network, no AI, no cost per use), so it works offline and the
// same reading shows every time on the same day. A pack is a titled list of readings; only the Faith pack exists today and later packs plug in beside it.
export interface ReadItem {
  // "Psalm 46:1-3"
  ref: string;
  // The verses exactly as printed in the King James Version (public domain), no verse numbers.
  text: string;
}

export interface ReadPack {
  id: string;
  title: string;
  items: ReadItem[];
}

export const FAITH_PACK: ReadPack = { id: "faith", title: "Faith", items: KJV_DAILY };
export const READ_PACKS: ReadPack[] = [FAITH_PACK];

// A small, stable string hash (FNV-1a, 32 bit): the same input always gives the same number, on every device.
export function hashString(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// The bundled readings plus the ones a coach typed in himself (Settings > Read during rest > Add a passage), after them in the order he added them. A coach's passage with the
// same reference as a bundled one is left out (the bundled text is the one the cycle and a day's choice use).
export function withCoachPassages(pack: ReadPack, own: ReadItem[]): ReadPack {
  const extra = own.filter((o) => o.ref && o.text && !findByRef(pack, o.ref));
  return extra.length === 0 ? pack : { ...pack, items: [...pack.items, ...extra] };
}

export function findByRef(pack: ReadPack, ref: string | null | undefined): ReadItem | null {
  if (!ref) return null;
  const wanted = ref.trim().toLowerCase().replace(/\s+/g, " ");
  return pack.items.find((i) => i.ref.toLowerCase() === wanted) ?? null;
}

// The day the cycle counts from. Any fixed day works; it must never change, or everyone's place in their cycle moves.
export const CYCLE_START = "2026-01-01";

// A small seeded random number generator (mulberry32): the same seed always gives the same sequence, on every device.
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** This person's own fixed order of the n readings (a shuffle seeded by their id): the same order every time, a different one for each person. */
export function viewerOrder(n: number, viewerId: string): number[] {
  const order = Array.from({ length: n }, (_, i) => i);
  const rand = seeded(hashString(`cycle:${viewerId}`));
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

function utcDay(dateKey: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000 : null;
}
function daysSinceStart(dateKey: string): number | null {
  const d = utcDay(dateKey);
  return d === null ? null : Math.round(d - (utcDay(CYCLE_START) as number));
}

// The reading for one person on one day (Ron, Oct 21: "Pick one. Randomly. And it will go through a cycle."): the coach's choice for that day when it is one of the readings; otherwise
// the next one in this person's own shuffled order, one a day, so nobody sees a reading again until they have seen them all, and different clients see different readings on the same
// day. `dateKey` is the person's own calendar day ("2026-11-03").
export function pickDailyItem(pack: ReadPack, dateKey: string, viewerId: string, overrideRef?: string | null): ReadItem | null {
  const n = pack.items.length;
  if (n === 0) return null;
  const chosen = findByRef(pack, overrideRef);
  if (chosen) return chosen;
  const day = daysSinceStart(dateKey);
  if (day === null) return pack.items[hashString(`${dateKey}:${viewerId}`) % n];
  const pos = ((day % n) + n) % n;
  return pack.items[viewerOrder(n, viewerId)[pos]];
}
