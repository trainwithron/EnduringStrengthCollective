import { describe, it, expect } from "vitest";
import { detectImportKind, looksLikePastedProgram, MAX_FILE_BYTES, MAX_AI_FILE_BYTES, MAX_PASTE_CHARS, MAX_DESCRIPTION_CHARS } from "@/lib/import-input-kind";

describe("detectImportKind: files", () => {
  it.each([
    ["program.csv", "text/csv"],
    ["program.CSV", ""],
    ["program.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    ["program.xls", "application/vnd.ms-excel"],
    ["program.tsv", ""],
  ])("%s is a spreadsheet (free path)", (fileName, mimeType) => {
    expect(detectImportKind({ fileName, mimeType, sizeBytes: 5000 }).kind).toBe("spreadsheet");
  });
  it("a PDF is a pdf by extension or by type", () => {
    expect(detectImportKind({ fileName: "block.pdf", mimeType: "application/pdf", sizeBytes: 10000 }).kind).toBe("pdf");
    expect(detectImportKind({ fileName: "block.PDF", mimeType: "", sizeBytes: 10000 }).kind).toBe("pdf");
  });
  it("photos and screenshots are images", () => {
    expect(detectImportKind({ fileName: "a.png", mimeType: "image/png", sizeBytes: 1000 }).kind).toBe("image");
    expect(detectImportKind({ fileName: "a.JPG", mimeType: "image/jpeg", sizeBytes: 1000 }).kind).toBe("image");
    expect(detectImportKind({ fileName: "a.webp", mimeType: "", sizeBytes: 1000 }).kind).toBe("image");
  });
  it("a pasted screenshot with no useful name still reads as an image", () => {
    expect(detectImportKind({ fileName: "image.png", mimeType: "image/png", sizeBytes: 300000 }).kind).toBe("image");
  });
  it("text files go to the AI reader", () => {
    expect(detectImportKind({ fileName: "notes.txt", mimeType: "text/plain", sizeBytes: 800 }).kind).toBe("text_file");
    expect(detectImportKind({ fileName: "notes.md", mimeType: "", sizeBytes: 800 }).kind).toBe("text_file");
  });
  it("HEIC gets a friendly convert message, not a failure later", () => {
    const d = detectImportKind({ fileName: "IMG_1.HEIC", mimeType: "image/heic", sizeBytes: 1000 });
    expect(d.kind).toBe("unsupported");
    expect(d.message).toMatch(/JPEG or PNG/);
  });
  it("anything else is unsupported with a plain list of what works", () => {
    const d = detectImportKind({ fileName: "program.docx", mimeType: "", sizeBytes: 1000 });
    expect(d.kind).toBe("unsupported");
    expect(d.message).toMatch(/CSV or Excel/);
  });
  it("size caps are friendly and exact at the edge", () => {
    expect(detectImportKind({ fileName: "a.pdf", mimeType: "application/pdf", sizeBytes: MAX_AI_FILE_BYTES }).kind).toBe("pdf");
    const bigPdf = detectImportKind({ fileName: "a.pdf", mimeType: "application/pdf", sizeBytes: MAX_AI_FILE_BYTES + 1 });
    expect(bigPdf.kind).toBe("unsupported");
    expect(bigPdf.message).toMatch(/3 MB/);
    expect(detectImportKind({ fileName: "a.png", mimeType: "image/png", sizeBytes: MAX_AI_FILE_BYTES }).kind).toBe("image");
    expect(detectImportKind({ fileName: "a.png", mimeType: "image/png", sizeBytes: MAX_AI_FILE_BYTES + 1 }).kind).toBe("unsupported");
    // spreadsheets are read in the browser: bigger is fine up to 10 MB
    expect(detectImportKind({ fileName: "a.csv", mimeType: "text/csv", sizeBytes: MAX_AI_FILE_BYTES + 1 }).kind).toBe("spreadsheet");
    expect(detectImportKind({ fileName: "a.csv", mimeType: "text/csv", sizeBytes: MAX_FILE_BYTES + 1 }).kind).toBe("unsupported");
  });
});

const PROGRAM = `Week 1
Day 1
Back Squat 3x5 @ 225
Bench Press 4 x 8
Romanian Deadlift 3 sets of 10
Day 2
Overhead Press 3x6`;

describe("detectImportKind: typed or pasted text", () => {
  it("nothing typed is empty", () => {
    expect(detectImportKind({ text: "   \n " }).kind).toBe("empty");
    expect(detectImportKind({}).kind).toBe("empty");
  });
  it("a block of lines with set and rep schemes is a pasted program", () => {
    expect(looksLikePastedProgram(PROGRAM)).toBe(true);
    expect(detectImportKind({ text: PROGRAM }).kind).toBe("pasted_program");
  });
  it("a sentence asking for a program is a description", () => {
    expect(detectImportKind({ text: "A 12 week strength block, 4 days a week, for a 45 year old beginner with a bad shoulder" }).kind).toBe("description");
  });
  it("a short description that mentions 3x a week is still a description (too few lines)", () => {
    expect(looksLikePastedProgram("Train 3x8 sets, bench and squat, three days a week")).toBe(false);
  });
  it("many lines without set schemes stay a description", () => {
    expect(looksLikePastedProgram("Make it fun\nKeep it short\nNo burpees\nLots of rowing")).toBe(false);
  });
  it("too long a description gets a friendly message, too long a paste too", () => {
    const d = detectImportKind({ text: "word ".repeat(MAX_DESCRIPTION_CHARS) });
    expect(d.kind).toBe("unsupported");
    expect(d.message).toMatch(/few sentences/);
    const longProgram = (PROGRAM + "\n").repeat(Math.ceil((MAX_PASTE_CHARS + 10) / PROGRAM.length));
    const p = detectImportKind({ text: longProgram });
    expect(p.kind).toBe("unsupported");
    expect(p.message).toMatch(/few weeks at a time/);
  });
  it("a file name always wins over the text box", () => {
    expect(detectImportKind({ fileName: "p.csv", mimeType: "text/csv", sizeBytes: 10, text: PROGRAM }).kind).toBe("spreadsheet");
  });
});
