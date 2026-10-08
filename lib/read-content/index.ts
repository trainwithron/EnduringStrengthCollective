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

export function findByRef(pack: ReadPack, ref: string | null | undefined): ReadItem | null {
  if (!ref) return null;
  const wanted = ref.trim().toLowerCase().replace(/\s+/g, " ");
  return pack.items.find((i) => i.ref.toLowerCase() === wanted) ?? null;
}

// The reading for one person on one day: the coach's choice for that day when it is one of the bundled readings, otherwise one picked by the date and the person, so
// every client gets a different reading on the same day and the same reading all day. `dateKey` is the person's own calendar day ("2026-11-03").
export function pickDailyItem(pack: ReadPack, dateKey: string, viewerId: string, overrideRef?: string | null): ReadItem | null {
  if (pack.items.length === 0) return null;
  const chosen = findByRef(pack, overrideRef);
  if (chosen) return chosen;
  return pack.items[hashString(`${dateKey}:${viewerId}`) % pack.items.length];
}
