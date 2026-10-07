// A stable "random" pick, deterministic per seed string — the same seed
// always picks the same index, different seeds spread across the array.
// Shared by lib/volume-equivalence.ts (seeded by post id, so a share
// card's joke never changes on reload) and lib/gym-jokes.ts (seeded by
// calendar date, for a genuine daily rotation).

// FNV-1a — small, dependency-free, good-enough distribution for picking
// an index, not for anything cryptographic.
export function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0; // unsigned
}

export function seededPick<T>(items: T[], seed: string): T {
  const index = hashSeed(seed) % items.length;
  return items[index];
}

// A small seeded random-number generator (mulberry32): the same seed gives the same sequence of numbers in [0, 1), so a pick that needs "random" numbers can
// still be repeatable when it has to be (the default line a signed-out viewer sees) while the live pick uses Math.random.
export function seededRandom(seed: string): () => number {
  let a = hashSeed(seed);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
