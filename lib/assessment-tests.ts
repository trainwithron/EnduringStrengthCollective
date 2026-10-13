// The in-person assessment logger: a short fixed list of common tests plus any the coach adds. The numbers are written into the assessment's existing "measurements" text, one test per line
// ("Grip strength: 42 kg"), so there is nothing new to store. Blank rows are skipped.

export interface AssessmentTest {
  name: string;
  unit: string;
}

export const ASSESSMENT_TESTS: AssessmentTest[] = [
  { name: "Grip strength", unit: "kg" },
  { name: "Vertical jump", unit: "in" },
  { name: "40-yard dash", unit: "sec" },
  { name: "Sit and reach", unit: "in" },
  { name: "Resting heart rate", unit: "bpm" },
  { name: "Body weight", unit: "lb" },
  { name: "Waist", unit: "in" },
];

export const MAX_MEASUREMENTS_CHARS = 1000;

export interface TestEntry extends AssessmentTest {
  value: string;
}

// A typed number: digits with an optional decimal point or comma, up to 8 characters. Anything else is skipped (a number box can still hold stray text on some phones).
export function cleanValue(raw: string): string | null {
  const v = raw.trim().replace(",", ".");
  if (!/^\d{1,6}(\.\d{1,3})?$/.test(v)) return null;
  return v;
}

export function cleanLabel(raw: string, max: number): string {
  return raw.replace(/[\r\n:]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

// "Grip strength: 42 kg" per filled row, in order. Returns the text and how many rows it holds (the text is cut at the stored limit on a whole line, never mid-line).
export function formatMeasurements(entries: TestEntry[]): { text: string; count: number } {
  const lines: string[] = [];
  let length = 0;
  for (const e of entries) {
    const value = cleanValue(e.value);
    const name = cleanLabel(e.name, 40);
    if (value === null || !name) continue;
    const unit = cleanLabel(e.unit, 12);
    const line = `${name}: ${value}${unit ? " " + unit : ""}`;
    if (length + line.length + (lines.length ? 1 : 0) > MAX_MEASUREMENTS_CHARS) break;
    length += line.length + (lines.length ? 1 : 0);
    lines.push(line);
  }
  return { text: lines.join("\n"), count: lines.length };
}
