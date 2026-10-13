import { choicesForSlot, pickRung, slotLabel, type Level, type LadderRung, type Side, type SlotTier } from "@/lib/slot-templates";

// "Use this template": choose a level (and optionally a client), look over the exercise picked for every slot, change any, and make a NORMAL library program with real exercises. Pure, so it is tested.

export const LEVELS: { value: Level; label: string }[] = [
  { value: "beginner", label: "Beginner" },
  { value: "intermediate", label: "Intermediate" },
  { value: "advanced", label: "Advanced" },
];

export function levelLabel(level: Level): string {
  return LEVELS.find((l) => l.value === level)?.label ?? "Intermediate";
}

export interface TemplateSlot {
  rowId: string;
  week: number;
  day: number;
  order: number;
  patternId: string;
  patternName: string;
  side: Side | null;
  tier: SlotTier | null;
}

export interface ReviewRow extends TemplateSlot {
  label: string;
  // Every rung the slot may use, easiest first (the dropdown); the picked one is selected.
  choices: LadderRung[];
  fallback: string | null;
  pick: string | null;
}

// The picked exercise for every slot at this level. `previous` keeps a pick the coach already changed by hand when the list of choices still holds it and the level did not change.
export function buildReview(slots: TemplateSlot[], laddersByPatternId: Record<string, LadderRung[]>, level: Level): ReviewRow[] {
  return slots
    .slice()
    .sort((a, b) => a.week - b.week || a.day - b.day || a.order - b.order)
    .map((s) => {
      const { rungs, fallback } = choicesForSlot({ patternName: s.patternName, side: s.side, tier: s.tier }, laddersByPatternId[s.patternId] ?? []);
      const picked = pickRung(rungs, level);
      return { ...s, label: slotLabel({ patternName: s.patternName, side: s.side, tier: s.tier }), choices: rungs, fallback, pick: picked?.exerciseName ?? null };
    });
}

// Make is allowed only when every slot has an exercise.
export function everySlotFilled(rows: ReviewRow[], picks: Record<string, string | null>): boolean {
  return rows.length > 0 && rows.every((r) => !!(picks[r.rowId] ?? r.pick));
}

// "Week 1, Day 2" headings for the review list: the first row of each day carries its heading.
export function dayHeading(week: number, day: number): string {
  return `Week ${week}, Day ${day}`;
}

// The new program keeps the template's name with the level (an assigned copy keeps the program's own name; no client name is added).
export function defaultProgramName(templateName: string, level: Level): string {
  return `${templateName} (${levelLabel(level)})`;
}

export const NO_LADDER_MESSAGE = "This pattern has no exercises yet. Add some in the Exercise Library.";
export const MAKE_FAILED_MESSAGE = "Couldn't make it. Nothing was kept.";

export function madeMessage(name: string): string {
  return `Made “${name}”. It's in your Programs.`;
}
