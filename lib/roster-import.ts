// Reading a pasted list or a spreadsheet of people into the clients a coach is about to add (names, and an email if there is one). Pure. Every line that is not used is listed with its row number and why,
// so nothing disappears, and the coach sees exactly who will be added before anything is created. Nobody is emailed by adding them (see app/api/clients/invite).

export const ROSTER_MAX_ROWS = 100;
export const ROSTER_NAME_MAX = 80;

export interface RosterRow {
  rowNumber: number; // the line or row in what was pasted or uploaded (the first line is 1)
  name: string;
  email: string | null;
}

export type RosterSkipReason = "no_name" | "name_too_long" | "bad_email" | "repeated_email" | "over_limit";

export interface RosterSkipped {
  rowNumber: number;
  reason: RosterSkipReason;
  detail: string;
}

export interface RosterParse {
  rows: RosterRow[];
  skipped: RosterSkipped[];
  // People with the same name more than once in the list (allowed: two clients can share a name), for the preview to point out.
  repeatedNames: string[];
}

const EMAIL_PATTERN = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;
const EMAIL_IN_TEXT = /[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+/;

export function isRosterEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value.trim());
}

// Pasted text -> cells. A tab-separated paste (from a spreadsheet) or commas or semicolons split a line into cells; a plain "Jane Smith" stays one cell.
export function splitPastedRoster(text: string): string[][] {
  return text.split(/\r?\n/).map((line) => {
    if (line.includes("\t")) return line.split("\t").map((c) => c.trim());
    if (/[;,]/.test(line)) return line.split(/[;,]/).map((c) => c.trim().replace(/^"(.*)"$/, "$1"));
    return [line.trim()];
  });
}

type Columns = { name?: number; first?: number; last?: number; email?: number };

// A first row that names its columns ("Name", "Full name", "First name" and "Last name", "Email") is a header, not a person.
function headerColumns(row: string[]): Columns | null {
  const cols: Columns = {};
  row.forEach((raw, i) => {
    const h = raw.toLowerCase().replace(/[^a-z]+/g, " ").trim();
    if (/^(e ?mail|email address)$/.test(h)) cols.email ??= i;
    else if (/^(first name|first|given name)$/.test(h)) cols.first ??= i;
    else if (/^(last name|last|surname|family name)$/.test(h)) cols.last ??= i;
    else if (/^(name|full name|client|client name|athlete|athlete name|member)$/.test(h)) cols.name ??= i;
  });
  const found = cols.name != null || cols.first != null || cols.email != null;
  return found && (cols.name != null || cols.first != null) ? cols : null;
}

// noHeader: the rows are already people (the server checking what the page sent), never a header row.
export function parseRoster(cells: string[][], options: { max?: number; noHeader?: boolean } = {}): RosterParse {
  const max = options.max ?? ROSTER_MAX_ROWS;
  const rows: RosterRow[] = [];
  const skipped: RosterSkipped[] = [];
  const seenEmails = new Set<string>();
  const nameCount = new Map<string, number>();

  const headerAt = cells.length > 0 && !options.noHeader ? headerColumns(cells[0]) : null;

  cells.forEach((cellRow, index) => {
    const rowNumber = index + 1;
    if (index === 0 && headerAt) return;
    if (cellRow.every((c) => !(c ?? "").toString().trim())) return;
    const row = cellRow.map((c) => (c ?? "").toString().trim());
    const skip = (reason: RosterSkipReason, detail: string) => void skipped.push({ rowNumber, reason, detail });

    let name = "";
    let emailText = "";
    if (headerAt) {
      name = headerAt.name != null ? row[headerAt.name] ?? "" : [row[headerAt.first ?? -1], headerAt.last != null ? row[headerAt.last] : ""].filter(Boolean).join(" ");
      emailText = headerAt.email != null ? row[headerAt.email] ?? "" : "";
    } else {
      // No header: an email is any cell that holds one (or sits in the middle of a line, "Jane Smith jane@x.com"), the name is the rest.
      const rest: string[] = [];
      for (const c of row) {
        const found = c.match(EMAIL_IN_TEXT);
        if (found && !emailText) {
          emailText = found[0];
          const without = c.replace(found[0], "").replace(/[<>()]/g, "").trim();
          if (without) rest.push(without);
        } else if (c.includes("@") && !emailText) {
          emailText = c; // an @ that is not a whole address: reported below
        } else if (c) {
          rest.push(c);
        }
      }
      name = rest.join(" ");
    }
    name = name.replace(/\s+/g, " ").trim();
    emailText = emailText.trim();

    if (name.includes("@")) return skip("bad_email", `More than one email on one line (${name}). Put each person on their own line.`);
    if (!name || !/\p{L}/u.test(name)) return skip("no_name", emailText ? `No name next to ${emailText}.` : "No name on this line.");
    if (name.length > ROSTER_NAME_MAX) return skip("name_too_long", `The name is longer than ${ROSTER_NAME_MAX} characters, which is probably more than one line pasted together.`);
    if (emailText && !isRosterEmail(emailText)) return skip("bad_email", `${name}: "${emailText}" is not a full email address. Fix it or take it out to add them without one.`);
    const email = emailText ? emailText.toLowerCase() : null;
    if (email && seenEmails.has(email)) return skip("repeated_email", `${name}: ${email} is already on an earlier line.`);
    if (rows.length >= max) return skip("over_limit", `${name}: only ${max} people can be added at a time. Add this one in the next batch.`);

    if (email) seenEmails.add(email);
    const key = name.toLowerCase();
    nameCount.set(key, (nameCount.get(key) ?? 0) + 1);
    rows.push({ rowNumber, name, email });
  });

  const repeatedNames = Array.from(nameCount.entries())
    .filter(([, n]) => n > 1)
    .map(([key]) => rows.find((r) => r.name.toLowerCase() === key)!.name);
  return { rows, skipped, repeatedNames };
}
