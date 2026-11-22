import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  allTicked,
  demoFailedLine,
  demoTicksNeeded,
  machineSuggestions,
  matchLibraryExercises,
  matchesLine,
  mergeMachineExercises,
  planDemoCarry,
  sameMachine,
  tickedRows,
  toggleAll,
  type SuggestRow,
} from "./machine-add-suggest";
import { cleanMachineRequest } from "./machine-catalog";

// Ron, Nov 21: typing "hammer strength" while adding a machine lists his exercises named with it, ticked, and the ticked ones go on the machine with their demos (admin page only).
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const row = (id: string, name: string, over: Partial<SuggestRow> = {}): SuggestRow => ({ id, name, videoPath: null, youtubeUrl: null, ...over });

const library: SuggestRow[] = [
  row("1", "Hammer Strength Iso Row", { videoPath: "ron/iso-row.mp4" }),
  row("2", "hammer strength chest press", { youtubeUrl: "https://youtu.be/abcdefghijk" }),
  row("3", "Hammer  Strength Leg Press"),
  row("4", "Barbell Row"),
  row("5", "Hammer Curl"),
  row("6", "Bolt Viking Press"),
];

describe("matching Ron's own exercises", () => {
  it("finds every exercise holding the whole phrase, any case or spacing, by name", () => {
    expect(matchLibraryExercises(library, ["hammer strength"]).map((r) => r.id)).toEqual(["2", "1", "3"]);
    expect(matchLibraryExercises(library, ["HAMMER STRENGTH  "]).map((r) => r.id)).toEqual(["2", "1", "3"]);
    // the whole phrase, not each word: Hammer Curl is not a Hammer Strength exercise
    expect(matchLibraryExercises(library, ["hammer strength"]).some((r) => r.name === "Hammer Curl")).toBe(false);
  });

  it("starts at 3 characters", () => {
    expect(matchLibraryExercises(library, ["ha"])).toEqual([]);
    expect(matchLibraryExercises(library, ["  "])).toEqual([]);
    expect(matchLibraryExercises(library, ["ham"]).map((r) => r.id)).toEqual(["5", "2", "1", "3"]);
  });

  it("matches the brand or the machine's name, once each", () => {
    const m = machineSuggestions({ show: true, library, brand: "Bolt", model: "Viking Press" });
    expect(m.map((r) => r.id)).toEqual(["6"]);
    const both = machineSuggestions({ show: true, library, brand: "Hammer Strength", model: "Row" });
    expect(both.map((r) => r.id)).toEqual(["4", "2", "1", "3"]);
  });

  it("skips names already on the machine or already typed in the form", () => {
    expect(matchLibraryExercises(library, ["hammer strength"], ["HAMMER STRENGTH ISO ROW"]).map((r) => r.id)).toEqual(["2", "3"]);
  });

  it("keeps one row a name, the one with a demo", () => {
    const dup = [row("a", "Hammer Strength Iso Row"), row("b", "hammer strength iso row", { videoPath: "x.mp4" })];
    expect(matchLibraryExercises(dup, ["hammer"]).map((r) => r.id)).toEqual(["b"]);
  });

  it("no matches: nothing", () => {
    expect(machineSuggestions({ show: true, library, brand: "Nautilus", model: "Nitro" })).toEqual([]);
  });
});

describe("ticked by default", () => {
  const matches = matchLibraryExercises(library, ["hammer strength"]);
  it("every match starts ticked, and one unticked stays out", () => {
    expect(tickedRows(matches, new Set())).toEqual(matches);
    expect(allTicked(matches, new Set())).toBe(true);
    expect(tickedRows(matches, new Set(["1"])).map((r) => r.id)).toEqual(["2", "3"]);
    expect(allTicked(matches, new Set(["1"]))).toBe(false);
  });
  it("Untick all, then Tick all", () => {
    const off = toggleAll(matches, new Set());
    expect(tickedRows(matches, off)).toEqual([]);
    const on = toggleAll(matches, off);
    expect(tickedRows(matches, on)).toEqual(matches);
    // one unticked: the button reads Tick all and ticks them all
    expect(tickedRows(matches, toggleAll(matches, new Set(["2"])))).toEqual(matches);
  });
  it("the matches line", () => {
    expect(matchesLine(1)).toBe("1 match in your exercises");
    expect(matchesLine(3)).toBe("3 matches in your exercises");
  });
});

describe("admin page only", () => {
  it("shows nothing when not asked to", () => {
    expect(machineSuggestions({ show: false, library, brand: "Hammer Strength", model: "" })).toEqual([]);
  });
  it("the section offers the library only to the platform admin on the admin page", () => {
    const s = read("components/coach/machine-catalog-section.tsx");
    expect(s).toContain("suggestFrom={isAdmin && curateOnly ? library : null}");
    expect(s).toContain("show: !!suggestFrom,");
    // the admin page is the one with curateOnly and Ron's own library; the coach Exercise library passes neither
    expect(read("components/admin/machine-catalog-curate.tsx")).toMatch(/isAdmin\s+curateOnly/);
    expect(read("components/admin/machine-catalog-curate.tsx")).toContain("library={library}");
    expect(read("components/coach/gym-machines-panel.tsx")).not.toContain("curateOnly");
  });
});

describe("saving the machine with the ticked exercises", () => {
  const matches = matchLibraryExercises(library, ["hammer strength"]);
  const ticked = tickedRows(matches, new Set(["3"]));

  it("sends the ticked exercises by name (with the catalog's id for an exact name), then the typed ones, no name twice", () => {
    const merged = mergeMachineExercises(ticked, [{ name: "Shrug", catalogId: null }, { name: "Hammer Strength Iso Row", catalogId: null }], [{ id: "cat-row", name: "hammer strength iso row" }]);
    expect(merged).toEqual([
      { name: "hammer strength chest press", catalogId: null },
      { name: "Hammer Strength Iso Row", catalogId: "cat-row" },
      { name: "Shrug", catalogId: null },
    ]);
    const cleaned = cleanMachineRequest({ brand: "Hammer Strength", model: "Iso Row", exercises: merged });
    expect(cleaned.ok && cleaned.exercises.length).toBe(3);
  });

  it("the ticked exercises alone are enough for a machine; none ticked and none typed is not", () => {
    expect(cleanMachineRequest({ brand: "Hammer Strength", model: "Iso Row", exercises: mergeMachineExercises(ticked, [], []) }).ok).toBe(true);
    expect(cleanMachineRequest({ brand: "Hammer Strength", model: "Iso Row", exercises: mergeMachineExercises([], [], []) }).ok).toBe(false);
  });

  it("asks for the same ticks the demos need", () => {
    expect(demoTicksNeeded(ticked)).toEqual({ video: true, link: true });
    expect(demoTicksNeeded([library[2]])).toEqual({ video: false, link: false });
  });

  it("puts each demo on its new exercise on the machine; one not found is named; one already there is never touched", () => {
    const items = [
      { id: "old", name: "Hammer Strength Chest Press" },
      { id: "new1", name: "hammer strength iso row" },
    ];
    const plan = planDemoCarry(ticked, items, ["old"]);
    expect(plan.carry).toEqual([{ itemId: "new1", row: ticked.find((r) => r.id === "1") }]);
    expect(plan.missing.map((r) => r.id)).toEqual(["2"]);
    // the list could not be read again: every demo is named
    expect(planDemoCarry(ticked, null, []).missing.map((r) => r.id)).toEqual(["2", "1"]);
  });

  it("a plain line names the demos that didn't come along", () => {
    expect(demoFailedLine([])).toBeNull();
    expect(demoFailedLine(["Iso Row"])).toBe('The demo for Iso Row didn\'t come along. Open the machine below and add it with "Add demo".');
    expect(demoFailedLine(["A", "B", "C"])).toBe('The demos for A, B and C didn\'t come along. Open the machine below and add them with "Add demo".');
  });

  it("finds the saved machine whatever the case", () => {
    expect(sameMachine({ brand: "hammer  strength", model: "ISO ROW" }, { brand: "Hammer Strength", model: "Iso Row" })).toBe(true);
    expect(sameMachine({ brand: "Hammer Strength", model: "Row" }, { brand: "Hammer Strength", model: "Iso Row" })).toBe(false);
  });

  it("the form saves the machine first, then each demo through the same helper as 'use one of my demos'", () => {
    const s = read("components/coach/machine-catalog-section.tsx");
    const send = s.slice(s.indexOf("  async function send() {"), s.indexOf("  function tickBox("));
    expect(send).toContain("exercises: mergeMachineExercises(ticked, exercises, names)");
    expect(send.indexOf('sendRequest({ kind: "machine"')).toBeLessThan(send.indexOf("sendMyDemo({ coachId, isAdmin, itemId, row })"));
    expect(send).toContain("planDemoCarry(ticked, saved?.items ?? null, priorItemIds)");
    expect(send).toContain("demoFailedLine(failed)");
    // one failed demo never stops the others or the machine
    expect(send).toContain("if (!d.ok) failed.push(row.name);");
    // the helper is the existing copy inside storage, or the YouTube link as it is
    const helper = s.slice(s.indexOf("async function sendMyDemo("), s.indexOf("const RIGHTS_LABEL"));
    expect(helper).toContain('.storage.from("exercise-media").copy(row.videoPath, to, { destinationBucket: MACHINE_DEMOS_BUCKET });');
    expect(helper).toContain("video_path: to, rights_confirmed: true, subject_consent: true");
    expect(helper).toContain("const url = catalogYoutubeLink(row.youtubeUrl ?? \"\");");
    expect(s).toContain("const r = await sendMyDemo({ coachId, isAdmin, itemId: item.id, row });");
  });

  it("the list rows are full-row labels with 44px targets, accent text in rust-ink", () => {
    const s = read("components/coach/machine-catalog-section.tsx");
    const block = s.slice(s.indexOf("data-machine-suggest"), s.indexOf("{ticksNeeded.link"));
    expect(block).toContain('<label className="flex items-center gap-3 min-h-11');
    expect(block).toContain('className="min-h-11 px-2 font-body text-xs text-rust-ink shrink-0"');
    expect(block).not.toMatch(/text-rust(?!-ink)\b/);
  });
});
