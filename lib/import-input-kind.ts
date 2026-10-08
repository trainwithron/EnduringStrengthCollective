// What the coach dropped, pasted or typed into the one Build-with-AI box, decided from the file's name and type or from the text itself. Pure, so every case is tested. Spreadsheets go to
// the free column-mapping parser; everything else that can be read goes to the metered AI reader; a plain description goes to the program writer.

export type ImportInputKind = "spreadsheet" | "pdf" | "image" | "text_file" | "pasted_program" | "description" | "unsupported" | "empty";

export const MAX_FILE_BYTES = 10 * 1024 * 1024; // spreadsheets are read in the browser, so they can be larger
// PDFs and pictures travel to the server as base64 inside one request, and the host's request limit is about 4.5 MB, so 3 MB of file is the most that fits.
export const MAX_AI_FILE_BYTES = 3 * 1024 * 1024;
export const MAX_PASTE_CHARS = 60_000;
export const MAX_DESCRIPTION_CHARS = 4_000;

export interface ImportInput {
  fileName?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  // For a typed or pasted box value, or the already-read content of a .txt/.md file
  text?: string | null;
}

export interface ImportDecision {
  kind: ImportInputKind;
  // Plain words for the coach when the input cannot be used (kind unsupported, or too large / too long)
  message?: string;
}

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "gif"];

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

// A pasted program looks like several lines where most carry a sets-by-reps pattern ("3x8", "4 x 10", "5 sets of 5", "3 sets x 8 reps"). A one-paragraph description does not.
const SETS_REPS = /\b\d{1,2}\s*(?:x|×|by)\s*\d{1,3}\b|\b\d{1,2}\s*sets?\s*(?:of|x|×)\s*\d{1,3}\b/i;

export function looksLikePastedProgram(text: string): boolean {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length < 4) return false;
  const withScheme = lines.filter((l) => SETS_REPS.test(l)).length;
  return withScheme >= 3;
}

export function detectImportKind(input: ImportInput): ImportDecision {
  const name = (input.fileName ?? "").trim();
  if (name) {
    const ext = extensionOf(name);
    const mime = (input.mimeType ?? "").toLowerCase();
    const size = input.sizeBytes ?? 0;
    if (ext === "heic" || ext === "heif" || mime === "image/heic" || mime === "image/heif") {
      return { kind: "unsupported", message: "That photo is in HEIC format, which can't be read here. Take a screenshot of it, or save it as a JPEG or PNG, and drop that in instead." };
    }
    if (ext === "csv" || ext === "tsv" || ext === "xlsx" || ext === "xls") {
      if (size > MAX_FILE_BYTES) return { kind: "unsupported", message: "That file is over 10 MB. Trim it down or split it into smaller files." };
      return { kind: "spreadsheet" };
    }
    if (ext === "pdf" || mime === "application/pdf") {
      if (size > MAX_AI_FILE_BYTES) return { kind: "unsupported", message: "That PDF is over 3 MB. Try just the pages with the program, or export it again at a smaller size." };
      return { kind: "pdf" };
    }
    if (IMAGE_TYPES.includes(mime) || IMAGE_EXTENSIONS.includes(ext)) {
      if (size > MAX_AI_FILE_BYTES) return { kind: "unsupported", message: "That picture is over 3 MB. Take a screenshot of it instead, which is much smaller." };
      return { kind: "image" };
    }
    if (ext === "txt" || ext === "md" || mime === "text/plain") {
      if (size > MAX_PASTE_CHARS * 2) return { kind: "unsupported", message: "That text file is too long. Paste just the program itself." };
      return { kind: "text_file" };
    }
    return { kind: "unsupported", message: "That kind of file can't be read here. Use a spreadsheet (CSV or Excel), a PDF, a photo or screenshot, or a text file, or paste the program as text." };
  }

  const text = (input.text ?? "").trim();
  if (!text) return { kind: "empty" };
  if (looksLikePastedProgram(text)) {
    if (text.length > MAX_PASTE_CHARS) return { kind: "unsupported", message: "That text is too long to read at once. Paste a few weeks at a time." };
    return { kind: "pasted_program" };
  }
  if (text.length > MAX_DESCRIPTION_CHARS) return { kind: "unsupported", message: "That is long for a description. Keep it to a few sentences, or paste the program itself with one exercise per line (like 3x8 Bench Press)." };
  return { kind: "description" };
}
