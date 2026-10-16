// An exercise name that is only digits, commas, dots and spaces ("1", "8,8,8", "20", "5,5,5", "12.5") is never a name: it is a counter, a rep list or a weight that landed in the wrong column. Imports stop
// on such a name instead of creating a program of exercises called "1", "2" and "3", and nothing like it is ever added to the library or the aliases. Pure.
const NUMERIC_ONLY = /^[0-9.,\s]+$/;

export function isNumericOnlyName(name: string | null | undefined): boolean {
  const text = (name ?? "").trim();
  return text.length > 0 && NUMERIC_ONLY.test(text) && /[0-9]/.test(text);
}

// The names in a list that are only numbers, once each, in the order they first appear.
export function numericOnlyNames(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const name = (raw ?? "").trim();
    if (isNumericOnlyName(name) && !seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

export const NUMERIC_NAMES_MESSAGE = "The exercise column looks like numbers, not names. Pick the column with the exercise names.";

// FitPros history: lines that look like sets (or reps), not exercise names, and could not be attached to an exercise.
export function fitprosLayoutMessage(lines: string[]): string {
  const shown = lines.slice(0, 5).join("; ");
  return `These lines look like sets, not exercise names: ${shown}${lines.length > 5 ? ` and ${lines.length - 5} more` : ""}. The file may be laid out wrongly (each exercise should be one line: name | reps | weights).`;
}

// More than about a tenth of the exercises with no sets (and no note) means the layout was probably misread.
export const NO_SETS_SHARE = 0.1;

export function noSetsWarning(withoutSets: number, total: number): string | null {
  if (total === 0 || withoutSets / total <= NO_SETS_SHARE) return null;
  return `${withoutSets} of ${total} exercises have no sets. Check the file layout.`;
}
