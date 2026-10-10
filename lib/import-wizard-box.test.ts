import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const wizard = readFileSync(resolve(__dirname, "../components/coach/desktop/import-wizard.tsx"), "utf8").replace(/\r\n/g, "\n");

describe("the one Build-with-AI box", () => {
  it("has one box: one textarea for describing or pasting and one file chooser, not three stacked paths", () => {
    expect(wizard.match(/<input\s+ref=\{fileInputRef\}/g)).toHaveLength(1);
    expect(wizard.match(/type="file"/g)).toHaveLength(1);
    expect(wizard).toContain('id="build-with-ai-box"');
    // the old separate explanations are gone
    expect(wizard).not.toContain("Upload a spreadsheet export");
    expect(wizard).not.toContain("Convert a PDF page to");
    expect(wizard).not.toContain("Or upload a photo or screenshot");
  });
  it("accepts every supported kind of file in the chooser", () => {
    for (const ext of [".csv", ".xlsx", ".xls", ".pdf", ".txt", "image/*"]) expect(wizard).toContain(ext);
  });
  it("decides the route from the detected kind: spreadsheet is free in the browser, the rest go to the AI reader", () => {
    const fn = wizard.slice(wizard.indexOf("async function handleBoxFile"), wizard.indexOf("function handleBoxSubmit"));
    expect(fn).toContain("detectImportKind(");
    expect(fn).toContain('decision.kind === "spreadsheet") return handleFile(file)');
    expect(fn).toContain('decision.kind === "image") return handleAiPhotoUpload(file)');
    expect(fn).toContain('decision.kind === "pdf") return handleAiPdfUpload(file)');
    expect(fn).toContain("handleAiTextImport(");
    // unsupported and oversized files get the friendly message and stop before any call
    expect(fn.indexOf('decision.kind === "unsupported"')).toBeLessThan(fn.indexOf("handleFile(file)"));
  });
  it("the button under the box writes a description into a program or reads pasted program text", () => {
    const fn = wizard.slice(wizard.indexOf("function handleBoxSubmit"), wizard.indexOf("async function copyImportPrompt"));
    expect(fn).toContain('"pasted_program"');
    expect(fn).toContain("handleAiTextImport(");
    expect(fn).toContain("handleAiGenerate()");
  });
  it("a pasted screenshot and a dropped file use the same route as the chooser", () => {
    expect(wizard).toContain("onPaste=");
    expect(wizard).toContain("e.clipboardData?.files?.[0]");
    expect(wizard).toContain("onDrop=");
    expect(wizard).toContain("e.dataTransfer.files?.[0]");
    expect(wizard.match(/handleBoxFile\(file\)/g)!.length).toBeGreaterThanOrEqual(3);
  });
  it("every AI path lands on the same review screen, always reviewed (isAiSourced true)", () => {
    const reader = wizard.slice(wizard.indexOf("async function readWithAi"), wizard.indexOf("async function handleAiPhotoUpload"));
    expect(reader).toContain('fetch("/api/ai/parse-workout"');
    expect(reader).toMatch(/prepareImport\(data\.rows, programName, [^\n]*sourceNote[^\n]*, null, null, undefined, true\)/);
  });
  it("shows the usage meter and the copy-this-prompt helper, collapsed", () => {
    expect(wizard).toContain('<AiUsageMeter groupId={groupId} focus="program" compact />');
    expect(wizard).toContain("<details");
    expect(wizard).toContain("Prefer to use your own AI? Copy this prompt");
    expect(wizard).toContain("buildImportPrompt()");
  });
  it("keeps the 44px touch size on the box's buttons and leaves the DUP and GZCLP options in place", () => {
    expect(wizard).toContain("h-11 sm:h-9");
    expect(wizard).toContain("Generate DUP block");
    expect(wizard).toContain("Generate GZCLP shell");
  });
  it("the Spot builder's prefilled prompt still auto-generates from the same box text", () => {
    expect(wizard).toContain("autoGenerate && initialAiPrompt");
    expect(wizard).toContain("useState(initialAiPrompt ??");
  });
});
