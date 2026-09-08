// Turns a raw pounds-lifted number into a fun, shareable real-world
// comparison — the whole point is to make a share card worth posting,
// not to be a precise unit converter. Picks the heaviest reference object
// that still clears at least 1x the total, so the count is always >= 1
// (never "0.02 whales").
interface ReferenceObject {
  name: string;
  pluralName: string;
  weightLbs: number;
}

// Round weights, ascending — order matters (the picker walks this list
// looking for the heaviest one that still clears 1x the total).
const REFERENCE_OBJECTS: ReferenceObject[] = [
  { name: "a lab rat", pluralName: "lab rats", weightLbs: 1 },
  { name: "a housecat", pluralName: "housecats", weightLbs: 10 },
  { name: "a Golden Retriever", pluralName: "Golden Retrievers", weightLbs: 100 },
  { name: "a motorcycle", pluralName: "motorcycles", weightLbs: 500 },
  { name: "a grand piano", pluralName: "grand pianos", weightLbs: 1000 },
  { name: "a Volkswagen Beetle", pluralName: "Volkswagen Beetles", weightLbs: 2000 },
  { name: "a pickup truck", pluralName: "pickup trucks", weightLbs: 5000 },
  { name: "a baby elephant", pluralName: "baby elephants", weightLbs: 10000 },
  { name: "a school bus", pluralName: "school buses", weightLbs: 20000 },
  { name: "a blue whale", pluralName: "blue whales", weightLbs: 300000 },
];

export interface VolumeEquivalence {
  count: number;
  singular: string;
  plural: string;
  label: string; // "15 Volkswagen Beetles" / "1 Volkswagen Beetle"
}

export function getVolumeEquivalence(totalVolumeLbs: number): VolumeEquivalence | null {
  if (!totalVolumeLbs || totalVolumeLbs <= 0) return null;

  let best: ReferenceObject | null = null;
  for (const ref of REFERENCE_OBJECTS) {
    if (totalVolumeLbs / ref.weightLbs >= 1) {
      best = ref;
    }
  }
  // Nothing cleared even a single lab rat (a genuinely tiny session) —
  // fall back to a partial-rat count rather than showing nothing.
  const ref = best ?? REFERENCE_OBJECTS[0];
  const rawCount = totalVolumeLbs / ref.weightLbs;
  const count = rawCount >= 10 ? Math.round(rawCount) : Math.round(rawCount * 10) / 10;
  if (count <= 0) return null;

  // ref.name carries its own article ("a Volkswagen Beetle") for use in
  // prose elsewhere; the count-prefixed label drops it ("1 Volkswagen
  // Beetle") since "1 a Volkswagen Beetle" reads wrong.
  const singularNoArticle = ref.name.replace(/^(a|an)\s+/i, "");

  return {
    count,
    singular: ref.name,
    plural: ref.pluralName,
    label: `${count} ${count === 1 ? singularNoArticle : ref.pluralName}`,
  };
}
