// Reading a pasted list or a spreadsheet of people into the clients a coach is about to add (names, and an email if there is one). Pure. Every line that is not used is listed with its row number and why,
// so nothing disappears, and the coach sees exactly who will be added before anything is created. Nobody is emailed by adding them (see app/api/clients/invite).
// A client list exported from another coaching app (TrueCoach, Trainerize, Everfit) reads as it is (Ron, Nov 20: "onboarding smoothness is a priority"): its header row may sit below a title line or two,
// its columns carry the app's own names ("Client First Name", "Email Address"), and a client marked archived or inactive in the old app is listed as not added, never silently imported.

export const ROSTER_MAX_ROWS = 250;
// How far down a file the header row is looked for (an export can start with a title or a date line).
export const ROSTER_HEADER_SEARCH_ROWS = 5;
export const ROSTER_NAME_MAX = 80;

export interface RosterRow {
  rowNumber: number; // the line or row in what was pasted or uploaded (the first line is 1)
  name: string;
  email: string | null;
}

export type RosterSkipReason = "no_name" | "name_too_long" | "bad_email" | "repeated_email" | "over_limit" | "archived" | "above_header";

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
// A comma or semicolon inside quotes stays in its cell ("Doe, Jane",jane@x.com is two cells), and the quotes themselves are not kept.
function unquote(cell: string): string {
  const t = cell.trim();
  return t.length >= 2 && t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1).replace(/""/g, '"').trim() : t;
}

function splitQuoted(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '""';
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      current += ch;
    } else if ((ch === "," || ch === ";") && !inQuotes) {
      cells.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells.map(unquote);
}

export function splitPastedRoster(text: string): string[][] {
  return text.split(/\r?\n/).map((line) => {
    if (line.includes("\t")) return line.split("\t").map(unquote);
    if (/[;,]/.test(line)) return splitQuoted(line);
    return [unquote(line)];
  });
}

type Columns = { name?: number; first?: number; last?: number; email?: number; status?: number };

// A header cell, lowercased with everything but letters turned into single spaces. A leading "client", "athlete", "member" or "contact" is dropped when more follows (Trainerize "Client First Name",
// "Client Email"), so a lone "Client" or "Athlete" column still reads as the name.
export function headerKey(raw: string): string {
  return (raw ?? "")
    .toLowerCase()
    .replace(/[^a-z]+/g, " ")
    .trim()
    .replace(/^(client|athlete|member|contact|customer|user) (?=\S)/, "");
}

// A row that names its columns ("Name", "Full name", "First name" and "Last name", "Email", "Status") is a header, not a person.
function headerColumns(row: string[]): Columns | null {
  const cols: Columns = {};
  row.forEach((raw, i) => {
    const h = headerKey(raw);
    if (/^(e ?mail|e ?mail address|email id|primary email)$/.test(h)) cols.email ??= i;
    else if (/^(first name|first|given name|firstname)$/.test(h)) cols.first ??= i;
    else if (/^(last name|last|surname|family name|lastname)$/.test(h)) cols.last ??= i;
    else if (/^(name|full name|fullname|display name|client|client name|athlete|athlete name|member|member name)$/.test(h)) cols.name ??= i;
    // not "state": in an address it is a place (an export's State column must never hide its Archived flags)
    else if (/^(status|account status|client status)$/.test(h)) cols.status ??= i;
  });
  const found = cols.name != null || cols.first != null || cols.email != null;
  return found && (cols.name != null || cols.first != null) ? cols : null;
}

// A client the old app says is no longer active: listed as not added (the coach can take the status column out to add them anyway).
const ARCHIVED_STATUS = /\b(archived?|inactive|deactivated|deleted|removed|cancell?ed|former|churned|disabled)\b/i;

// noHeader: the rows are already people (the server checking what the page sent), never a header row.
export function parseRoster(cells: string[][], options: { max?: number; noHeader?: boolean } = {}): RosterParse {
  const max = options.max ?? ROSTER_MAX_ROWS;
  const rows: RosterRow[] = [];
  const skipped: RosterSkipped[] = [];
  const seenEmails = new Set<string>();
  const nameCount = new Map<string, number>();

  // The header row: the first of the top few rows that names its columns (rows above it, a title or a date, are not people).
  let headerIndex = -1;
  let headerAt: Columns | null = null;
  if (!options.noHeader) {
    for (let i = 0; i < Math.min(cells.length, ROSTER_HEADER_SEARCH_ROWS); i++) {
      const found = headerColumns(cells[i] ?? []);
      if (found) {
        headerIndex = i;
        headerAt = found;
        break;
      }
    }
  }

  cells.forEach((cellRow, index) => {
    const rowNumber = index + 1;
    if (headerAt && index === headerIndex) return;
    // A line above the header (a title, a date): listed as not used, so nothing disappears without a word.
    if (headerAt && index < headerIndex) {
      if (cellRow.some((c) => (c ?? "").toString().trim())) skipped.push({ rowNumber, reason: "above_header", detail: "Above the file's header row, so not read as a person." });
      return;
    }
    if (cellRow.every((c) => !(c ?? "").toString().trim())) return;
    const row = cellRow.map((c) => (c ?? "").toString().trim());
    const skip = (reason: RosterSkipReason, detail: string) => void skipped.push({ rowNumber, reason, detail });

    let name = "";
    let emailText = "";
    if (headerAt) {
      name = headerAt.name != null ? row[headerAt.name] ?? "" : [row[headerAt.first ?? -1], headerAt.last != null ? row[headerAt.last] : ""].filter(Boolean).join(" ");
      emailText = headerAt.email != null ? row[headerAt.email] ?? "" : "";
      const status = headerAt.status != null ? row[headerAt.status] ?? "" : "";
      if (status && ARCHIVED_STATUS.test(status)) {
        const who = name.replace(/\s+/g, " ").trim() || emailText.trim() || "This person";
        return skip("archived", `${who}: marked "${status}" in the file, so not added. Take the status column out of the file to add them anyway.`);
      }
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
