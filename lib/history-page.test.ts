import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const page = read("app/(coach)/groups/[groupId]/athletes/[athleteId]/history/page.tsx");
const picker = read("components/coach/history-import-picker.tsx");
const uploader = read("components/coach/exercise-history-uploader.tsx");

// Ron's History page: one Import button, nearly empty at the top, one small How this works.
describe("the History page", () => {
  it("is headed Import client history, with the Import button, Quick entry and the unclear points, and nothing else open", () => {
    expect(page).toContain(">Import client history</h1>");
    expect(page).not.toContain("&apos;s history");
    expect(page).toContain("<HistoryImportPicker");
    expect(page).toContain("parts={{ quick: true, spreadsheet: false, entries: true }}");
    expect(page).toContain("<UnclearPointsReview");
  });
  it("the explanation, the baseline note, the units note and the access switch sit in one collapsed How this works", () => {
    const details = page.slice(page.indexOf("<details"), page.indexOf("</details>"));
    expect(details).toContain("How this works");
    expect(details).toContain("{IMPORT_BASELINE_NOTE}");
    expect(details).toContain("{IMPORT_UNITS_NOTE}");
    expect(details).toContain("<HistoryImportAccessToggle");
    expect(details).not.toContain("open");
    // nothing of it is outside the dropdown
    const outside = page.slice(0, page.indexOf("<details")) + page.slice(page.indexOf("</details>"));
    expect(outside).not.toContain("<HistoryImportAccessToggle");
    expect(outside).not.toContain("IMPORT_BASELINE_NOTE}");
  });
});

describe("one Import button for every source", () => {
  it("the list is FitPros and Spreadsheet (CSV or Excel); choosing a spreadsheet opens it right there, with the way back", () => {
    expect(picker).toContain("FitPros");
    expect(picker).toContain("Spreadsheet (CSV or Excel)");
    expect(picker).toContain("Choose another source");
    expect(picker).toContain("<ExerciseHistoryUploader");
    expect(picker).toContain("parts={{ quick: false, spreadsheet: true, entries: false }}");
  });
  it("the standing Import a spreadsheet block is gone from the page (the page copy shows Quick entry and the list only)", () => {
    expect(page).not.toContain(`id="history-upload"`);
    expect(uploader).toContain("parts.spreadsheet !== false");
    expect(uploader).toContain("window.dispatchEvent(new Event(\"history-entries-changed\"))");
  });
});

describe("pounds or kilograms", () => {
  it("the choice is on Quick entry, the spreadsheet import and the FitPros import, before anything is uploaded", () => {
    expect(read("components/coach/weight-unit-choice.tsx")).toContain("Weights are in:");
    expect((uploader.match(/<WeightUnitChoice/g) ?? []).length).toBe(2);
    expect(read("components/coach/fitpros-history-import.tsx")).toContain("<WeightUnitChoice value={unit} onChange={setUnit} />");
  });
  it("a file reads by what it says, else the choice; Quick entry converts what was typed", () => {
    expect(uploader).toContain("headerUnit: headerUnitOf(header, mapping), chosenUnit: csvUnit");
    expect(uploader).toContain("poundsFrom(parseFloat(manualWeight), quickUnit)");
    expect(read("components/coach/fitpros-history-import.tsx")).toContain("parseFitprosExport(fileText, unit)");
  });
  it("a mixed file is flagged unclear for a coach, and stopped for a client's own upload (only a coach can write the mark)", () => {
    expect(uploader).toContain("if (units.mixed && !viewerIsCoach)");
    expect(read("lib/exercise-history-import.ts")).toContain('data_flag: "unclear", data_flag_reason: row.unclearReason');
    expect(read("lib/fitpros-history-import.ts")).toContain('data_flag: "unclear", data_flag_reason: s.unclearReason');
  });
});
