import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { IMPORT_FILE_ACCEPT, LEAVE_IMPORT_MESSAGE } from "@/components/coach/desktop/program-import-launcher";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const launcher = read("components/coach/desktop/program-import-launcher.tsx");
const list = read("app/(coach)/groups/[groupId]/programs/page.tsx");

// Ron: stay on the Programs page. Import program opens the file picker; the chosen file runs the import in a large panel over the page.
describe("Import program", () => {
  it("opens the computer's own file picker from a click, accepting what the wizard accepts, and cancelling does nothing", () => {
    expect(IMPORT_FILE_ACCEPT).toBe(".csv,.tsv,.xlsx,.xls,.pdf,.txt,.md,image/*");
    // the same list the wizard's own file box takes
    expect(read("components/coach/desktop/import-wizard.tsx")).toContain(`accept="${IMPORT_FILE_ACCEPT}"`);
    expect(launcher).toContain("onClick={() => fileRef.current?.click()}");
    expect(launcher).toContain("if (file) setPanel({ file });");
  });
  it("the page button is Import program, and the old link and the 'or build with AI' words are gone", () => {
    expect(launcher).toContain("Import program");
    expect(list).toContain("<ProgramImportLauncher");
    expect(list).not.toContain("Import or build with AI");
    expect(list).not.toContain("programs/import`");
  });
  it("is the only button: no Paste text instead, no Describe link", () => {
    expect(launcher).not.toContain("Paste text instead");
    expect(list).not.toContain("Paste text instead");
    expect(launcher.match(/<button/g)?.length).toBeGreaterThanOrEqual(1);
  });
});

describe("the panel", () => {
  it("is about three quarters of the screen on a computer and the whole screen on a phone, over the Programs page", () => {
    expect(launcher).toContain("w-full md:w-3/4");
    expect(launcher).toContain("fixed inset-0");
  });
  it("runs the very same import on the chosen file (the wizard starts on it), nothing created before the review is finished", () => {
    expect(launcher).toContain("initialFile={file}");
    const wizard = read("components/coach/desktop/import-wizard.tsx");
    expect(wizard).toContain("void handleBoxFile(initialFile);");
    expect(wizard).toContain("onActivity?.(status === \"working\" || pending != null || finalizing);");
  });
  it("closing while something is in progress asks first; closing when idle just closes", () => {
    expect(LEAVE_IMPORT_MESSAGE).toBe("Leave this import? Nothing has been created yet; what you have here will be lost.");
    expect(launcher).toContain("if (activeRef.current && !(await confirmDialog(");
    expect(launcher).toContain('e.key === "Escape"');
  });
});

describe("old addresses", () => {
  it("/programs/import lands on the Programs page; /programs/new?method=ai makes a program and opens the builder, where the AI box is", () => {
    const old = read("app/(coach)/groups/[groupId]/programs/import/page.tsx");
    expect(old).toContain("redirect(`/groups/${params.groupId}/programs`)");
    const created = read("app/(coach)/groups/[groupId]/programs/new/page.tsx");
    expect(created).toContain("<CreateAndOpenProgram");
    expect(created).not.toContain("programs/import");
  });
});

describe("on the program builder page", () => {
  it("Import program sits inside the AI box above the mic and Ask, and the toolbar link is gone", () => {
    const box = read("components/coach/desktop/ai-program-builder-box.tsx");
    expect(box.indexOf("<ProgramImportLauncher")).toBeLessThan(box.indexOf("<MicButton"));
    expect(read("components/coach/desktop/program-builder-desktop.tsx")).not.toContain("programs/import");
  });
});

import { detectImportKind, looksLikePastedProgram } from "@/lib/import-input-kind";

describe("program text pasted into the AI builder box", () => {
  const spreadsheet = ["Week\tDay\tExercise\tSets\tReps", "1\t1\tBack Squat\t3\t5", "1\t1\tBench Press\t3\t8", "1\t1\tSeated Row\t3\t10", "1\t2\tDeadlift\t3\t5"].join("\n");
  const typedList = ["Day 1", "Squat 3x5", "Bench press 3 x 8", "Barbell row 3x10", "Day 2", "Deadlift 3x5", "Overhead press 3x8"].join("\n");
  const byHeaders = ["Week 1", "Day 1", "Back squat", "Bench press", "Barbell row", "Week 2", "Day 1", "Back squat", "Bench press"].join("\n");
  const pipes = ["Exercise | Sets | Reps", "Squat | 3 | 5", "Bench | 3 | 8", "Row | 3 | 10", "Press | 3 | 8"].join("\n");

  it("a pasted spreadsheet, a typed list, a program laid out by days and a pipe table are all recognised as a program", () => {
    for (const text of [spreadsheet, typedList, byHeaders, pipes]) {
      expect(looksLikePastedProgram(text)).toBe(true);
      expect(detectImportKind({ text }).kind).toBe("pasted_program");
    }
  });
  it("a short description, or a longer one with no program shape, is not (it goes straight to the builder)", () => {
    expect(detectImportKind({ text: "Build me a 4 day upper lower split for an intermediate lifter with a bad shoulder" }).kind).toBe("description");
    const wordy = "I want a 12 week strength block.\nFour days a week.\nHeavy squat and deadlift focus.\nAvoid anything that loads the left shoulder overhead.\nKeep sessions to about an hour.";
    expect(looksLikePastedProgram(wordy)).toBe(false);
    expect(detectImportKind({ text: "Make week 2 harder, 3 sets of 5 on the main lifts" }).kind).toBe("description");
    expect(looksLikePastedProgram("Day 1\nDay 2\nSquat")).toBe(false); // too short to be a program
  });
  it("the box asks first and writes nothing: one plain line with Import it and Build from it", () => {
    const box = read("components/coach/desktop/ai-program-builder-box.tsx");
    expect(box).toContain("This looks like a full program. Import it?");
    expect(box).toContain("Import it");
    expect(box).toContain("Build from it");
    // Ask stops at the question before anything is queued; a correction while paused is never mistaken for a program
    const ask = box.slice(box.indexOf("function ask("), box.indexOf("queue.current = slots;"));
    expect(ask.indexOf("setProgramChoice(said);")).toBeLessThan(ask.indexOf("request.current = said;"));
    expect(ask).toContain('phase !== "paused"');
    // Import it opens the panel on the text; Build from it runs the normal builder
    expect(box).toContain("<ProgramImportPanel groupId={groupId} athleteId={athleteId} text={importText}");
    expect(box).toContain("onClick={() => ask(true)}");
    expect(read("components/coach/desktop/import-wizard.tsx")).toContain('handleAiTextImport(initialText.trim(), "Pasted program", "Imported from pasted text (AI)")');
  });
});

describe("Assign to clients on the program builder page", () => {
  const builder = read("components/coach/desktop/program-builder-desktop.tsx");
  it("sits right after Print or PDF and opens the existing assign panel on this program", () => {
    expect(builder.indexOf("Print or PDF")).toBeLessThan(builder.indexOf("            Assign to clients"));
    expect(builder.indexOf("            Assign to clients")).toBeLessThan(builder.lastIndexOf("{toolbarExtra}"));
    expect(builder).toContain("onClick={() => setAssignOpen(true)}");
    expect(builder).toContain("<ProgramAssignPanel programId={programId} programName={name} groupId={groupId} aiDraft={aiDraft}");
  });
  it("uses the same assign code as everywhere else: the sign-off of an AI draft, the double-click guard, the same-organization rule", () => {
    const panel = read("components/coach/desktop/program-assign-panel.tsx");
    expect(panel).toContain("ensureSignedOff");
    expect(panel).toContain("assignProgramToClient");
    expect(panel).toContain("aiDraft");
    // no assign logic was added to the builder
    expect(builder).not.toContain("assignProgramToClient");
  });
});
