// Key cards at the Kiosk (Ron, Nov 2: "every member at the gym already has a key card ... a CSV export from MindBody ... and then a CSV upload into this"). Pure helpers:
// what counts as a card number, telling a barcode scanner from a person typing, reading a member export, and matching its rows to clients. The database (step 198) has the rules.

export const CARD_MIN = 3;
export const CARD_MAX = 64;

/** A card number as stored: trimmed, 3 to 64 visible characters, no spaces. Anything else is not a card number. */
export function normalizeCardCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim();
  if (code.length < CARD_MIN || code.length > CARD_MAX) return null;
  return /^[\x21-\x7E]+$/.test(code) ? code : null;
}

/** The end of a card number, for a list a coach reads ("••4821"). */
export function cardTail(code: string): string {
  return `••${code.slice(-4)}`;
}

// A barcode scanner works like a keyboard: it "types" the number very fast and presses Enter. A person types far slower than this.
export const SCAN_MAX_GAP_MS = 50;
export const SCAN_RESET_MS = 120;

/** Keys typed (with their times) and then Enter: a scan when there are at least 3 and they came at scanner speed. */
export function isScannerBurst(times: number[]): boolean {
  if (times.length < CARD_MIN) return false;
  const span = times[times.length - 1] - times[0];
  return span / (times.length - 1) <= SCAN_MAX_GAP_MS;
}

// ---- a member export (Mindbody and the like) ----

/** One CSV line into fields, with "quoted, fields" and "" for a quote. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((f) => f.trim());
}

export interface CardRow {
  name: string;
  email: string;
  code: string;
}

// Which column holds the card: the most card-like header wins (a "Barcode ID" over a "Client ID").
const CODE_HEADERS = [/barcode/i, /card/i, /key ?(tag|fob|card)?/i, /fob/i, /(member|client) ?(id|number|#)/i];

/** A member export into rows of name, email and card number. Rows with no usable card number are left out. */
export function parseCardCsv(text: string): { rows: CardRow[]; skipped: number } | { error: string } {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return { error: "That file has no rows. Export your members as a CSV file and try again." };
  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  let codeAt = -1;
  for (const re of CODE_HEADERS) {
    // never a payment card column
    codeAt = header.findIndex((h) => re.test(h) && !/credit|payment|expir|cvv|last 4/.test(h));
    if (codeAt >= 0) break;
  }
  if (codeAt < 0) return { error: "Couldn't find a card or barcode column. The file needs a column named like Barcode, Card or Key." };
  const emailAt = header.findIndex((h) => /e-?mail/.test(h));
  const nameAt = header.findIndex((h) => /^(full )?name$|^client name$|^member name$/.test(h));
  const firstAt = header.findIndex((h) => /first/.test(h));
  const lastAt = header.findIndex((h) => /last/.test(h));
  if (emailAt < 0 && nameAt < 0 && firstAt < 0) return { error: "Couldn't find a name or email column to match people by." };
  const rows: CardRow[] = [];
  let skipped = 0;
  for (const line of lines.slice(1)) {
    const f = splitCsvLine(line);
    const code = normalizeCardCode(f[codeAt] ?? "");
    const name = nameAt >= 0 ? f[nameAt] ?? "" : [f[firstAt] ?? "", lastAt >= 0 ? f[lastAt] ?? "" : ""].join(" ").trim();
    const email = emailAt >= 0 ? (f[emailAt] ?? "").toLowerCase() : "";
    if (!code || (!name && !email)) {
      skipped++;
      continue;
    }
    rows.push({ name, email, code });
  }
  return { rows, skipped };
}

const nameKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

export interface RosterPerson {
  athleteId: string;
  fullName: string;
  email?: string | null;
}

/** Each row to a client: by email first, then by full name when exactly one client has it. Two rows for the same client: the first wins. */
export function matchCardRows(rows: CardRow[], people: RosterPerson[]): { matched: { athleteId: string; code: string; name: string }[]; unmatched: string[] } {
  const byEmail = new Map<string, string>();
  const byName = new Map<string, string | null>();
  for (const p of people) {
    if (p.email) byEmail.set(p.email.toLowerCase(), p.athleteId);
    const k = nameKey(p.fullName);
    if (!k) continue;
    byName.set(k, byName.has(k) && byName.get(k) !== p.athleteId ? null : p.athleteId);
  }
  const matched: { athleteId: string; code: string; name: string }[] = [];
  const unmatched: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const id = (r.email && byEmail.get(r.email)) || byName.get(nameKey(r.name)) || null;
    if (!id) {
      unmatched.push(r.name || r.email);
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    matched.push({ athleteId: id, code: r.code, name: r.name || r.email });
  }
  return { matched, unmatched };
}

/** What the tablet says after a scan that did not check anyone in. */
export function cardScanMessage(result: string): string {
  switch (result) {
    case "unknown":
      return "That card isn't linked to anyone yet. Type your name instead, or ask the front desk.";
    case "not_here":
      return "That card isn't for this check-in. Ask the front desk.";
    case "throttled":
      return "Too many unknown cards just now. Wait a few minutes and try again.";
    default:
      return "Couldn't check in with that card. Try again.";
  }
}
