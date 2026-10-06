// Starter session types (Ron, Oct 6): one tap adds ordinary session types the coach can rename, change or delete like any they made themselves. There is no coach
// "kind" setting; the coach picks the set (or it is suggested from whether they run a team). They are created private (not shown on the public booking page).
// Practice and Game cost no session credit: a team does not spend a client's prepaid session on them.

export type PresetSetKey = "personal" | "team";

export interface SessionTypePreset {
  name: string;
  creditCost: number;
  locationKind: "in_person" | "online";
}

export const PRESET_SETS: Record<PresetSetKey, { label: string; presets: SessionTypePreset[] }> = {
  personal: {
    label: "Personal coaching",
    presets: [
      { name: "Online", creditCost: 1, locationKind: "online" },
      { name: "In person", creditCost: 1, locationKind: "in_person" },
    ],
  },
  team: {
    label: "Team coaching",
    presets: [
      { name: "Weight room", creditCost: 1, locationKind: "in_person" },
      { name: "Practice", creditCost: 0, locationKind: "in_person" },
      { name: "Game", creditCost: 0, locationKind: "in_person" },
    ],
  },
};

// The presets of a set that the coach does not already have (by name, ignoring case), so adding twice never makes duplicates.
export function missingPresets(set: PresetSetKey, existingNames: string[]): SessionTypePreset[] {
  const have = new Set(existingNames.map((n) => n.trim().toLowerCase()));
  return PRESET_SETS[set].presets.filter((p) => !have.has(p.name.toLowerCase()));
}
