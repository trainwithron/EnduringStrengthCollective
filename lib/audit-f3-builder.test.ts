import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { writeInBoxes } from "./program-print";
import type { ExerciseSetTarget } from "./types";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");
const set = (over: Partial<ExerciseSetTarget>): ExerciseSetTarget => ({ id: "s", setOrder: 1, ...over }) as ExerciseSetTarget;

describe("the program builder header", () => {
  it("says it autosaves with one Save left (for Label and Order), not two", () => {
    const bar = read("components/coach/desktop/save-status-bar.tsx");
    expect(bar).toContain("Autosaves as you go");
    expect(bar).not.toContain(">\n        Save\n      </button>");
    expect(read("components/coach/program-role-control.tsx")).toContain('{busy ? "Saving…" : "Save"}');
  });
  it("does not show the client's 'Day N of M, you've moved X lbs' strip in the coach's builder", () => {
    expect(read("app/(coach)/groups/[groupId]/programs/[programId]/page.tsx").match(/<ProgramProgressBanner/g)?.length).toBe(1); // the client's view only
  });
  it("shows the Programming Spotter as one summary line until Review is pressed", () => {
    const panel = read("components/coach/desktop/programming-spotter-panel.tsx");
    expect(panel).toContain("things in this program are worth a look.");
    expect(panel).toContain('{expanded ? "Hide" : "Review"}');
  });
  it("day cards share the row (300px to 420px each) and the '+ Day' placeholder is a narrow button", () => {
    const grid = read("components/coach/desktop/week-grid.tsx");
    expect(grid).toContain("flex-[1_1_0%] min-w-[300px] max-w-[420px]");
    expect(grid).toContain("w-[72px] shrink-0 min-h-[120px]");
  });
});

describe("a program's description is labelled", () => {
  it("is shown with a visible label in the builder and on the printed page (an unlabeled \"In Home\" read as stray text)", () => {
    expect(read("components/coach/desktop/program-builder-desktop.tsx")).toContain("Description: ");
    expect(read("app/print/programs/[programId]/page.tsx")).toContain("Description: ");
  });
});

describe("exercise details and phone targets", () => {
  it("the video upload is a styled button, with small bordered Remove buttons", () => {
    const picker = read("components/coach/exercise-media-picker.tsx");
    expect(picker).toContain('className="sr-only"');
    expect(picker).toContain("Upload video");
    expect(picker.match(/h-8 px-3 border border-steel\/30/g)?.length).toBe(2);
  });
  it("the x and + Add on a builder card are 44px on a phone", () => {
    const card = read("components/coach/exercise-builder-card.tsx");
    expect(card).toContain("w-11 h-11 sm:w-6 sm:h-9");
    expect(card).toContain("min-h-11 sm:min-h-0 px-2 sm:px-0");
  });
});

describe("the printed program", () => {
  it("write-in boxes match what was prescribed", () => {
    expect(writeInBoxes([set({ targetReps: "10", targetWeight: 135 })])).toEqual(["Wt", "Reps"]);
    expect(writeInBoxes([set({ targetTimeSeconds: 600 })])).toEqual(["Time", "Rest"]);
    expect(writeInBoxes([set({ targetDistance: 2 })])).toEqual(["Dist", "Time"]);
    expect(writeInBoxes([set({})])).toEqual(["Wt", "Reps"]);
  });
  it("a day prints its date when the program has one", () => {
    const page = read("app/print/programs/[programId]/page.tsx");
    expect(page).toContain("d.dateLabel = formatShortDate(when)");
    expect(page).toContain("{d.dateLabel &&");
  });
});

describe("packages and Business", () => {
  it("the packages form does not quote a price before a package is named", () => {
    expect(read("components/coach/desktop/package-manager.tsx")).toContain('{previewTotal && name.trim() !== "" && (');
  });
  it("Business no longer repeats Home's 'Right now' nudge and uses the packages page's words", () => {
    const biz = read("app/(coach)/groups/[groupId]/business/page.tsx");
    expect(biz).not.toContain("DashboardHero");
    expect(biz).toContain("until payments are turned on.");
    expect(biz).toContain("Set up packages &rarr;");
  });
});

describe("the Clients list", () => {
  it("lets the group name use the room instead of a narrow fixed column", () => {
    expect(read("components/coach/desktop/coach-clients-list.tsx")).toContain("truncate min-w-0 max-w-[22rem]");
    expect(read("components/coach/desktop/client-finder.tsx")).toContain("min-w-0 truncate max-w-[60%]");
  });
});
