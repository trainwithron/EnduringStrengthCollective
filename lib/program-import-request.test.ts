import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { planImportRequest, normalizeRows, extractPdfText, noRowsMessage, MIN_PDF_TEXT_CHARS, MAX_SCANNED_PDF_PAGES, PROGRAM_IMPORT_SYSTEM_PROMPT } from "@/lib/program-import-request";
import { MAX_AI_FILE_BYTES } from "@/lib/import-input-kind";

// A tiny but valid PDF, built by hand: one page per entry, each page drawing the given line of text (or nothing, for a "scan" with no text layer).
function makePdf(pageTexts: (string | null)[]): Uint8Array {
  const objs: string[] = [];
  const kids: string[] = [];
  objs.push(""); // 1 catalog (filled below)
  objs.push(""); // 2 pages (filled below)
  objs.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"); // 3 font
  let next = 4;
  for (const t of pageTexts) {
    const pageId = next++;
    const contentId = next++;
    const stream = t == null ? "" : `BT /F1 12 Tf 14 TL 50 700 Td ${t.split("\n").map((line) => `(${line.replace(/[()\\]/g, "")}) Tj T*`).join(" ")} ET`;
    objs[pageId - 1] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
    objs[contentId - 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
    kids.push(`${pageId} 0 R`);
  }
  objs[0] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[1] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${kids.length} >>`;
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, "latin1"));
}
const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");

const LONG_LINE = ["Week 1 Day 1", "Back Squat 3x5 at 225 pounds", "Bench Press 4x8 at 185 pounds", "Romanian Deadlift 3x10", "Overhead Press 3x6", "Barbell Row 4x8"].join("\n");

describe("extractPdfText", () => {
  it("reads the typed text out of a PDF without any AI", async () => {
    const r = await extractPdfText(makePdf([LONG_LINE]));
    expect(r.pages).toBe(1);
    expect(r.text).toContain("Back Squat");
    expect(r.text).toContain("Romanian Deadlift");
  });
  it("a page with no text layer gives back (almost) nothing", async () => {
    const r = await extractPdfText(makePdf([null]));
    expect(r.text.replace(/\s/g, "").length).toBeLessThan(MIN_PDF_TEXT_CHARS);
  });
});

describe("planImportRequest: pdf", () => {
  it("a PDF with typed text is sent as plain text (no document), under the pdf feature", async () => {
    const plan = await planImportRequest({ pdfBase64: b64(makePdf([LONG_LINE])) });
    expect(plan.ok).toBe(true);
    if (!plan.ok || plan.feature !== "program_import_pdf") throw new Error("expected a pdf plan");
    expect(plan.document).toBeUndefined();
    expect(plan.userText).toContain("Back Squat");
    expect(plan.userText).toContain("<program>");
  });
  it("a scanned PDF (no text) is handed over as a document", async () => {
    const data = b64(makePdf([null, null]));
    const plan = await planImportRequest({ pdfBase64: data });
    if (!plan.ok || plan.feature !== "program_import_pdf") throw new Error("expected a pdf plan");
    expect(plan.document).toEqual({ mediaType: "application/pdf", base64Data: data });
  });
  it("a scan with too many pages is refused before any AI call", async () => {
    const plan = await planImportRequest({ pdfBase64: b64(makePdf(Array.from({ length: MAX_SCANNED_PDF_PAGES + 1 }, () => null))) });
    expect(plan.ok).toBe(false);
    if (!plan.ok) {
      expect(plan.status).toBe(413);
      expect(plan.error).toMatch(/20 or fewer/);
    }
  });
  it("a file that is not a PDF gets a plain message", async () => {
    const plan = await planImportRequest({ pdfBase64: Buffer.from("this is not a pdf at all").toString("base64") });
    expect(plan.ok).toBe(false);
    if (!plan.ok) {
      expect(plan.status).toBe(422);
      expect(plan.error).toMatch(/couldn't be opened/);
    }
  });
  it("an oversized PDF is refused", async () => {
    const plan = await planImportRequest({ pdfBase64: "A".repeat(Math.ceil((MAX_AI_FILE_BYTES * 4) / 3) + 100) });
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.status).toBe(413);
  });
});

describe("planImportRequest: image and text", () => {
  it("an image keeps its type and goes under the photo feature", async () => {
    const plan = await planImportRequest({ imageBase64: "AAAA", mediaType: "image/png" });
    expect(plan.ok && plan.feature).toBe("program_import_photo");
  });
  it("an unsupported image type is refused with a way forward", async () => {
    const plan = await planImportRequest({ imageBase64: "AAAA", mediaType: "image/heic" });
    expect(plan.ok).toBe(false);
    if (!plan.ok) {
      expect(plan.status).toBe(400);
      expect(plan.error).toMatch(/screenshot/);
    }
  });
  it("an oversized image is refused", async () => {
    const plan = await planImportRequest({ imageBase64: "A".repeat(Math.ceil((MAX_AI_FILE_BYTES * 4) / 3) + 100), mediaType: "image/jpeg" });
    expect(plan.ok).toBe(false);
  });
  it("pasted text goes under the text feature, wrapped as a document to read", async () => {
    const plan = await planImportRequest({ text: "  Squat 3x5\nBench 3x8  " });
    if (!plan.ok || plan.feature !== "program_import_text") throw new Error("expected a text plan");
    expect(plan.userText).toContain("<program>\nSquat 3x5\nBench 3x8\n</program>");
  });
  it("empty or too-long text is refused", async () => {
    expect((await planImportRequest({ text: "   " })).ok).toBe(false);
    const long = await planImportRequest({ text: "x".repeat(60_001) });
    expect(long.ok).toBe(false);
  });
  it("a request with nothing in it is refused", async () => {
    expect((await planImportRequest({})).ok).toBe(false);
    expect((await planImportRequest(null)).ok).toBe(false);
  });
});

describe("the prompt and the cleanup", () => {
  it("tells Claude the text is a document, not instructions, and not to invent anything", () => {
    expect(PROGRAM_IMPORT_SYSTEM_PROMPT).toMatch(/not instructions to you/);
    expect(PROGRAM_IMPORT_SYSTEM_PROMPT).toMatch(/Never invent/);
    expect(PROGRAM_IMPORT_SYSTEM_PROMPT).not.toMatch(/convert a PDF page to an image/i);
  });
  it("keeps only usable rows and normalizes the fields", () => {
    const rows = normalizeRows([
      { week: "Week 1", day: "Day 1", exerciseName: "Squat", sets: 3.4, reps: 5, weight: 225, rpe: "8", rest: null, timeSeconds: null },
      { week: "Week 1", day: "Day 1", exerciseName: "  ", sets: 3 },
      { week: "Week 1", day: "Day 1", exerciseName: "Bench", sets: "3" },
      null,
      { week: "Week 1", day: "Day 2", exerciseName: "Plank", sets: 0, timeSeconds: 60 },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ exerciseName: "Squat", sets: 3, reps: "5", weight: 225, rpe: null, rest: null });
    expect(rows[1]).toMatchObject({ exerciseName: "Plank", sets: 1, timeSeconds: 60 });
  });
  it("each source has its own plain empty-result message", () => {
    expect(noRowsMessage("program_import_photo")).toMatch(/photo/);
    expect(noRowsMessage("program_import_pdf")).toMatch(/PDF/);
    expect(noRowsMessage("program_import_text")).toMatch(/one exercise per line/);
  });
});

describe("the route", () => {
  const route = readFileSync(resolve(__dirname, "../app/api/ai/parse-workout/route.ts"), "utf8");
  it("plans before any AI call, meters each source under its own feature, and keeps the limit and not-configured answers", () => {
    expect(route.indexOf("planImportRequest(body)")).toBeLessThan(route.indexOf("callClaude("));
    expect(route).toContain("feature: plan.feature");
    expect(route).toContain("AiRateLimitedError");
    expect(route).toContain("status: 429");
    expect(route).toContain("status: 503");
  });
});
