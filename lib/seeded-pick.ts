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
