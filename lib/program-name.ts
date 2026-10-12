// Program names: the rules for renaming one, and a readable default for an imported file's name.

export const PROGRAM_NAME_MAX = 120;

export type ProgramNameCheck = { ok: true; name: string } | { ok: false; message: string };

// What a coach typed, trimmed and checked. A blank name is refused; a long one is refused rather than silently cut.
export function checkProgramName(raw: string): ProgramNameCheck {
  const name = raw.replace(/\s+/g, " ").trim();
  if (!name) return { ok: false, message: "Give it a name." };
  if (name.length > PROGRAM_NAME_MAX) return { ok: false, message: `Keep it under ${PROGRAM_NAME_MAX} characters.` };
  return { ok: true, name };
}

// A file-style name ("christmas_abs_program.xlsx") becomes words ("Christmas Abs Program"): underscores to spaces, no extension, and capital letters only when the name was
// all lower case (a name someone already capitalised is left as written).
export function cleanImportedProgramName(raw: string): string {
  const base = raw.replace(/\.(csv|xlsx|xls|pdf|txt|docx?|png|jpe?g)$/i, "");
  const spaced = base.replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
  if (!spaced) return raw.trim();
  if (spaced !== spaced.toLowerCase()) return spaced;
  return spaced.replace(/(^|[\s-])([a-z])/g, (_m, sep: string, ch: string) => sep + ch.toUpperCase());
}
