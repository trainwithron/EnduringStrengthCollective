// The text a coach can copy and give to their own AI (ChatGPT, Claude, anything) when a program is in a messy document: it asks for a CSV with exactly the column names the free
// spreadsheet importer reads, so the result can be dropped straight back into the box with no AI cost here. Built from the importer's own header list so the two cannot drift apart.

import { HEADER_ALIASES, type ImportColumn } from "@/lib/workout-import-parser";

// The header the prompt asks for, per column (the first name the importer knows)
const COLUMN_ORDER: ImportColumn[] = ["week", "day", "exercise", "sets", "reps", "weight", "rpe", "rest"];

function headerFor(col: ImportColumn): string {
  const first = HEADER_ALIASES[col][0];
  return col === "rpe" ? "RPE" : first.charAt(0).toUpperCase() + first.slice(1);
}

export const IMPORT_PROMPT_HEADERS: string[] = COLUMN_ORDER.map(headerFor);

export const IMPORT_PROMPT_EXAMPLE_ROWS: string[] = [
  "Week 1,Day 1,Back Squat,3,5,225,8,3 min",
  "Week 1,Day 1,Romanian Deadlift,3,8,185,7,2 min",
  "Week 1,Day 2,Bench Press,4,6,185,8,2 min",
];

export function buildImportPrompt(): string {
  const header = IMPORT_PROMPT_HEADERS.join(",");
  return [
    "Turn the workout program below into a CSV file I can import. Use exactly these column headers on the first line:",
    "",
    header,
    "",
    "Rules:",
    "- One row per exercise per day (not one row per set). Four sets of 8 reps is ONE row with Sets 4 and Reps 8.",
    '- Week and Day are labels like "Week 1" and "Day 1". If the program has no weeks, use "Week 1" for everything.',
    "- Keep each exercise name exactly as written.",
    "- Weight is a plain number (no units). Leave a cell empty when the program does not say.",
    "- Reps can be a range such as 8-10 or a word such as AMRAP.",
    "- Do not add any other columns, notes, or explanation. Output only the CSV.",
    "",
    "Example:",
    header,
    ...IMPORT_PROMPT_EXAMPLE_ROWS,
    "",
    "The program:",
    "[paste or attach it here]",
  ].join("\n");
}
