// Word-swap terminology system (coach_dashboard_redesign_scoping.md) —
// six canonical term groups this app's own copy uses, each swappable to
// a coach's preferred vocabulary. One coach-wide (per-org) preference,
// not per-widget: the in-context click is a discovery moment for a
// single global setting.
//
// Deliberately fixed, never swappable: "workout" itself (the actual
// `workouts` table/builder terminology — too structurally load-bearing),
// business terms (MRR/income — not a personal-trainer-vs-team-coach
// axis), and "exercise" (shared library infrastructure). "practice" is
// deliberately excluded as a `session` preset — this app already has a
// real Team Calendar feature with scheduled "Practices," and letting
// `session` also read as "practice" would collide with that distinct
// calendar concept. A coach who wants it anyway can still reach it via
// Custom…, just not as a preset that could collide by default.

export type TermKey = "client" | "group" | "coach" | "session" | "roster" | "program";
export type TermForm = "singular" | "plural" | "possessive";

export interface TermForms {
  singular: string;
  plural: string;
  possessive: string;
}

export interface TermPreset extends TermForms {
  value: string;
}

export const TERM_LABELS: Record<TermKey, string> = {
  client: "Client",
  group: "Group",
  coach: "Coach",
  session: "Session",
  roster: "Roster",
  program: "Program",
};

export const TERM_DEFAULTS: Record<TermKey, TermForms> = {
  client: { singular: "client", plural: "clients", possessive: "client's" },
  group: { singular: "group", plural: "groups", possessive: "group's" },
  coach: { singular: "coach", plural: "coaches", possessive: "coach's" },
  session: { singular: "session", plural: "sessions", possessive: "session's" },
  roster: { singular: "roster", plural: "rosters", possessive: "roster's" },
  program: { singular: "program", plural: "programs", possessive: "program's" },
};

// Hand-authored plural/possessive forms — deliberately not derived
// algorithmically (would mishandle "coach" -> "coaches", the one
// irregular plural in this whole list).
export const TERM_PRESETS: Record<TermKey, TermPreset[]> = {
  client: [
    { value: "athlete", singular: "athlete", plural: "athletes", possessive: "athlete's" },
    { value: "player", singular: "player", plural: "players", possessive: "player's" },
    { value: "member", singular: "member", plural: "members", possessive: "member's" },
  ],
  group: [
    { value: "team", singular: "team", plural: "teams", possessive: "team's" },
    { value: "squad", singular: "squad", plural: "squads", possessive: "squad's" },
  ],
  coach: [{ value: "trainer", singular: "trainer", plural: "trainers", possessive: "trainer's" }],
  session: [
    { value: "workout", singular: "workout", plural: "workouts", possessive: "workout's" },
    { value: "training", singular: "training", plural: "trainings", possessive: "training's" },
  ],
  roster: [{ value: "team", singular: "team", plural: "teams", possessive: "team's" }],
  program: [{ value: "plan", singular: "plan", plural: "plans", possessive: "plan's" }],
};

export interface TermOverride {
  kind: "preset" | "custom";
  value: string;
}

export type TerminologyOverrides = Partial<Record<TermKey, TermOverride>>;

// Resolves the current word for one term/form, given an org's saved
// overrides. Falls back to the built-in default whenever there's no
// override, or a saved preset id no longer matches anything (stale data
// should never crash a render).
export function resolveTerm(overrides: TerminologyOverrides, key: TermKey, form: TermForm): string {
  const override = overrides[key];
  if (!override) return TERM_DEFAULTS[key][form];
  if (override.kind === "custom") return override.value;
  const preset = TERM_PRESETS[key].find((p) => p.value === override.value);
  return preset ? preset[form] : TERM_DEFAULTS[key][form];
}
