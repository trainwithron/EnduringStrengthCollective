import { fieldDef, type TrackedField } from "@/lib/exercise-fields";
import { MAX_REST_SECONDS, MAX_TIME_SECONDS, parseRestAnyForm } from "@/lib/rest-time";

// What the Bulk edit box does with what was typed. A blank box used to write "nothing" onto every set (so typing a time the box could not read quietly CLEARED the rest on the whole program); now a blank
// is its own case the coach must confirm, and a time is read the same way everywhere (90, 1:30, 90s, 2 min, a range).
export type BulkValue = { ok: true; blank: false; value: string | number } | { ok: true; blank: true; value: null } | { ok: false; message: string };

export const BULK_NEEDS_TIME = "Type a time like 90 or 1:30.";
export const BULK_NEEDS_NUMBER = "Type a number.";

export function parseBulkValue(field: TrackedField, raw: string): BulkValue {
  const text = raw.trim();
  if (text === "") return { ok: true, blank: true, value: null };
  if (field === "rest" || field === "time") {
    const seconds = parseRestAnyForm(text);
    const max = field === "rest" ? MAX_REST_SECONDS : MAX_TIME_SECONDS;
    if (seconds === null || seconds > max) return { ok: false, message: BULK_NEEDS_TIME };
    // A small bare number ("2") could mean minutes; ask rather than save two seconds.
    if (/^\d+$/.test(text) && seconds < 20) return { ok: false, message: BULK_NEEDS_TIME };
    return { ok: true, blank: false, value: seconds };
  }
  if (fieldDef(field).kind === "number") {
    const n = Number(text);
    return Number.isFinite(n) ? { ok: true, blank: false, value: n } : { ok: false, message: BULK_NEEDS_NUMBER };
  }
  return { ok: true, blank: false, value: text };
}
