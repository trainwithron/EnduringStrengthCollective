// corrective_exercise_biomechanical_tagging_idea.md — the coach-facing
// readable breakdown is deliberately NOT stored; it's generated here, at
// render time, from the structured tags (the one source of truth) —
// same "derive at read time, never persist and risk staleness"
// precedent already established by lib/program-schedule.ts's computed
// dates and the Program Cards sparkline.

export interface BiomechTagAssignment {
  label: string;
  description: string;
  role: "prime_mover" | "stabilizer_demand";
}

export interface BiomechBreakdown {
  primeMovers: BiomechTagAssignment[];
  stabilizerDemands: BiomechTagAssignment[];
  summary: string;
}

function listLabels(tags: BiomechTagAssignment[]): string {
  const labels = tags.map((t) => t.label);
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}

// Pure — takes an exercise's tag assignments (already resolved to their
// label/description/role) and produces a short, coach-facing readable
// paragraph plus the two lists it was built from, so a UI can render
// either the plain summary sentence or a fuller per-tag breakdown.
export function generateBiomechBreakdown(tags: BiomechTagAssignment[]): BiomechBreakdown {
  const primeMovers = tags.filter((t) => t.role === "prime_mover");
  const stabilizerDemands = tags.filter((t) => t.role === "stabilizer_demand");

  if (primeMovers.length === 0 && stabilizerDemands.length === 0) {
    return { primeMovers, stabilizerDemands, summary: "No biomechanical tags added yet." };
  }

  const parts: string[] = [];
  if (primeMovers.length > 0) {
    parts.push(`Primarily trains ${listLabels(primeMovers)}`);
  }
  if (stabilizerDemands.length > 0) {
    parts.push(`${primeMovers.length > 0 ? "also challenges" : "Challenges"} ${listLabels(stabilizerDemands)}`);
  }

  return { primeMovers, stabilizerDemands, summary: `${parts.join("; ")}.` };
}
