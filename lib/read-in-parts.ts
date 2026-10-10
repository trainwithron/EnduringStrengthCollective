import type { ParsedImportRow } from "@/lib/workout-import-parser";
import { splitProgramText } from "@/lib/program-text-split";

// Reads a long program in parts without ever running past the time the server allows. The text is read whole first; if the answer is cut off it is cut in two (at a week if it can) and
// each half read, one after the other, in text order. Before every read it checks the clock: if starting another read would run past the deadline (the average of the reads so far is
// the guide), it stops and hands back what it has, in order, instead of timing out. Pure apart from the reader it is given.

export interface PartsDeps {
  read: (text: string) => Promise<ParsedImportRow[] | "not_a_list">;
  isTruncated: (error: unknown) => boolean;
  now: () => number;
  // Do not START a read that would end after this moment (milliseconds, same clock as now).
  deadlineAt: number;
  // A guess for how long one read takes, used until a real one has been timed.
  defaultReadMs: number;
  maxDepth: number;
}

export interface PartsResult {
  rows: ParsedImportRow[];
  parts: number;
  // True when some of the program was left unread because there was not time.
  stoppedEarly: boolean;
}

export async function readInParts(sourceText: string, deps: PartsDeps): Promise<PartsResult | "not_a_list"> {
  const durations: number[] = [];
  let parts = 0;
  let stoppedEarly = false;
  let started = false;
  const typical = () => (durations.length > 0 ? Math.max(...durations) : deps.defaultReadMs);

  async function go(text: string, depth: number): Promise<ParsedImportRow[] | "not_a_list"> {
    // The very first read always runs; after that, never start one that would not finish in time.
    if (started && deps.now() + typical() > deps.deadlineAt) {
      stoppedEarly = true;
      return [];
    }
    started = true;
    const t0 = deps.now();
    try {
      const rows = await deps.read(text);
      durations.push(deps.now() - t0);
      if (rows !== "not_a_list") parts += 1;
      return rows;
    } catch (err) {
      durations.push(deps.now() - t0);
      if (deps.isTruncated(err) && depth < deps.maxDepth) {
        const halves = splitProgramText(text);
        if (halves) {
          const a = await go(halves[0], depth + 1);
          if (a === "not_a_list") return a;
          const b = await go(halves[1], depth + 1);
          if (b === "not_a_list") return b;
          return [...a, ...b];
        }
      }
      throw err;
    }
  }

  const rows = await go(sourceText, 0);
  if (rows === "not_a_list") return rows;
  return { rows, parts, stoppedEarly };
}

export function weeksIn(rows: ParsedImportRow[]): number {
  return new Set(rows.map((r) => r.week)).size;
}

export function partialMessage(rows: ParsedImportRow[]): string {
  const n = weeksIn(rows);
  return `Read the first ${n} ${n === 1 ? "week" : "weeks"}; the rest was too large to finish. Try the remaining weeks separately.`;
}
