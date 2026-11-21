import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { headersAbove, headersOfWorkouts, headerNotesOfProgram, SECTION_HEADER_MAX, sectionHeaderProblem } from "@/lib/section-headers";
import { supersetPlaces } from "@/lib/supersets";

const src = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

describe("section headers: the words", () => {
  it("something written, and short enough to be a header", () => {
    expect(sectionHeaderProblem("Warm-up")).toBeNull();
    expect(sectionHeaderProblem("   ")).toMatch(/Write the header/);
    expect(sectionHeaderProblem("x".repeat(SECTION_HEADER_MAX))).toBeNull();
    expect(sectionHeaderProblem("x".repeat(SECTION_HEADER_MAX + 1))).toMatch(/at most 40/);
  });
});

describe("which exercise a header heads", () => {
  it("each header heads the first exercise after it in the day's one order (exercises and notes share it)", () => {
    // order: 0 Warm-up, 1 Bike, 2 Strength, 3 Squat, 4 Bench, 5 Conditioning, 6 Sled
    const above = headersAbove([1, 3, 4, 6], [
      { position: 0, body: "Warm-up" },
      { position: 2, body: "Strength" },
      { position: 5, body: "Conditioning" },
    ]);
    expect(Object.fromEntries(above)).toEqual({ 0: ["Warm-up"], 1: ["Strength"], 3: ["Conditioning"] });
  });

  it("exercises given out of order are still matched by their order; two headers in a row both show; one with nothing after it heads nothing", () => {
    const above = headersAbove([5, 1], [
      { position: 3, body: "B" },
      { position: 2, body: "A" },
      { position: 9, body: "Cool-down" },
    ]);
    expect(Object.fromEntries(above)).toEqual({ 0: ["A", "B"] });
  });

  it("no headers, no exercises: nothing", () => {
    expect(headersAbove([1, 2], []).size).toBe(0);
    expect(headersAbove([], [{ position: 0, body: "A" }]).size).toBe(0);
  });
});

describe("reading headers never breaks a screen", () => {
  const failing = { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ limit: async () => ({ data: null, error: { message: "column workout_notes.is_header does not exist" } }) }) }), in: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: null, error: { message: "column workout_notes.is_header does not exist" } }) }) }) }) }) }) } as any;
  it("before step 219 (no column) there are simply no headers", async () => {
    expect((await headerNotesOfProgram(failing, "p")).size).toBe(0);
    expect((await headersOfWorkouts(failing, ["w"])).size).toBe(0);
  });
  it("an empty header is not shown", async () => {
    const db = { from: () => ({ select: () => ({ in: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: [{ id: "n1", workout_id: "w", body: "  ", position: 0 }, { id: "n2", workout_id: "w", body: " Strength ", position: 2 }], error: null }) }) }) }) }) }) } as any;
    expect((await headersOfWorkouts(db, ["w"])).get("w")).toEqual([{ id: "n2", body: "Strength", position: 2 }]);
  });
});

describe("supersets are unaffected", () => {
  it("a header is a day note, so like a note it ends a link where it sits, and links elsewhere stay as they were", () => {
    const items = [
      { id: "a", kind: "exercise" as const, supersetNext: true },
      { id: "b", kind: "exercise" as const, supersetNext: false },
      { id: "h", kind: "note" as const },
      { id: "c", kind: "exercise" as const, supersetNext: true },
      { id: "d", kind: "exercise" as const },
    ];
    const places = supersetPlaces(items as any);
    expect(places.get("a")?.members).toEqual(["a", "b"]);
    expect(places.get("c")?.members).toEqual(["c", "d"]);
  });
});

describe("where headers are made, shown and copied", () => {
  it("the builder adds a header (a note marked as a header), and says so plainly before step 219", () => {
    const c = src("components/coach/desktop/day-card.tsx");
    expect(c).toContain("+ Header");
    expect(c).toContain("...(header ? { is_header: true } : {}),");
    expect(c).toContain("Section headers aren't switched on yet. Try again soon.");
    expect(c).toContain("<SectionHeaderCard");
    const card = src("components/coach/section-header-card.tsx");
    expect(card).toContain('aria-label="Move header up"');
    expect(card).toContain('aria-label="Delete header"');
    expect(card).toContain("sectionHeaderProblem(next)");
    expect(card).toContain("header: true }");
  });

  it("the builder reads which notes are headers; Duplicate week and Undo keep them as headers", () => {
    expect(src("lib/program-builder-data.ts")).toContain("...(headerIds.has(n.id) ? { header: true } : {}),");
    expect(src("lib/program-restore.ts")).toContain("...(args.note.header ? { is_header: true } : {}),");
    const dup = src("components/coach/desktop/duplicate-week-panel.tsx");
    expect(dup).toContain("...(item.header ? { header: true } : {}),");
    expect(dup).toContain("...(note.header ? { is_header: true } : {}),");
  });

  it("the client sees them in place: the coach's preview, the workout overview and the logger; the printed team sheet prints them", () => {
    expect(src("components/coach/desktop/client-preview.tsx")).toContain("<SectionHeaderLines headers={above.get(i)} />");
    expect(src("lib/workout-overview-data.ts")).toContain(".filter((n: any) => !headerIds.has(n.id))");
    expect(src("components/logging/workout-overview-view.tsx")).toContain("<SectionHeaderLines headers={headersByExerciseId?.[ex.id]} />");
    expect(src("app/sessions/[sessionId]/page.tsx")).toContain("sectionHeaders: headersBySessionExercise.get(se.id)");
    expect(src("components/logging/exercise-card.tsx")).toContain("exercise.sectionHeaders.join");
    expect(src("lib/team-sheet/load-sheet.ts")).toContain("...(section ? { section } : {})");
    expect(src("lib/team-sheet/export-pdf.ts")).toContain("ex.section.toUpperCase()");
  });
});

describe("the printed team sheet", () => {
  it("prints a header above the name of the exercise it heads", async () => {
    const { inflateSync } = await import("node:zlib");
    const { buildSheetPdf } = await import("@/lib/team-sheet/export-pdf");
    const { dayLabel, makeRacks } = await import("@/lib/team-sheet/sheet-model");
    const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    const pdf = buildSheetPdf({
      groupId: uuid(1),
      groupName: "Varsity",
      mode: "day",
      unit: "lb",
      days: [{ date: "2026-10-19", label: dayLabel("2026-10-19"), title: "Lower", exercises: [
        { id: uuid(101), name: "Bike", prescription: "1x5", sets: 1, reps: 5, unread: false, section: "Warm-up" },
        { id: uuid(102), name: "Back Squat", prescription: "3x5", sets: 3, reps: 5, unread: false, section: "Strength" },
      ] }],
      racks: makeRacks([{ id: uuid(11), fullName: "Ann Adams" }], 4),
    });
    const s = pdf.toString("latin1");
    const all = [s, ...Array.from(s.matchAll(/stream\n([\s\S]*?)\nendstream/g)).map((m) => inflateSync(Buffer.from(m[1], "latin1")).toString("latin1"))].join("\n");
    expect(all).toContain("(WARM-UP)");
    expect(all).toContain("(STRENGTH)");
    expect(all).toContain("(Back Squat)");
  });
});

describe("a note or a header between two linked exercises ends the link, in the workout too", () => {
  it("the links a note or header ends, by the day's one order; the last exercise has no next", async () => {
    const { linksEndedByNotes } = await import("@/lib/section-headers");
    // order: 0 A (linked) 1 Header 2 B 3 C 4 D: the header ends A's link to B; D is last
    expect([...linksEndedByNotes([0, 2, 3, 4], [1])].sort()).toEqual([0, 3]);
    expect([...linksEndedByNotes([0, 2, 3, 4], [2.5, 3.5])].sort()).toEqual([1, 2, 3]);
    expect([...linksEndedByNotes([4, 0], [1])].sort()).toEqual([0, 1]);
    expect([...linksEndedByNotes([0, 1], [])]).toEqual([1]);
  });
  it("the builder takes the link off when a reorder leaves a note or header after it; the workout ignores a link a note sits inside", () => {
    const day = src("components/coach/desktop/day-card.tsx");
    expect(day).toContain('const unlink = new Set(items.filter((it, i) => it.kind === "exercise" && it.supersetNext && items[i + 1]?.kind !== "exercise").map((it) => it.id));');
    expect(day).toContain("...(unlink.has(item.id) ? { superset_next: false } : {})");
    const page = src("app/sessions/[sessionId]/page.tsx");
    expect(page).toContain("linksEndedByNotes(programmed.map((se) => se.exercise_order as number), notePositions)");
    expect(page).toContain("&& !linkEnded.has(se.id),");
  });
  it("an AI-built day redrawn in the builder keeps its headers", () => {
    expect(src("components/coach/desktop/ai-program-builder-box.tsx")).toContain("headersOfWorkouts(supabase, [workoutId])");
    expect(src("lib/program-builder-data.ts")).toContain("...(headerIds.has(n.id) ? { header: true } : {})");
  });
});

describe("the Excel team sheet", () => {
  it("prints headers in a row above the names, and the sheet still reads back exactly", async () => {
    const XLSX = await import("xlsx");
    const { buildSheetWorkbook } = await import("@/lib/team-sheet/export-xlsx");
    const { readUpload } = await import("@/lib/team-sheet/read-upload");
    const { dayLabel, makeRacks } = await import("@/lib/team-sheet/sheet-model");
    const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    for (const mode of ["day", "week"] as const) {
      const wb = buildSheetWorkbook({
        groupId: uuid(1),
        groupName: "Varsity",
        mode,
        unit: "lb",
        days: [{ date: "2026-11-16", label: dayLabel("2026-11-16"), title: "Lower", exercises: [
          { id: uuid(101), name: "Bike", prescription: "1x5", sets: 1, reps: 5, unread: false, section: "Warm-up" },
          { id: uuid(102), name: "Back Squat", prescription: "3x5", sets: 3, reps: 5, unread: false, section: "Strength" },
        ] }],
        racks: makeRacks([{ id: uuid(11), fullName: "Ann Adams" }], 4),
      });
      const ws = wb.Sheets["Rack 1"];
      const cells = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: "" });
      const at = cells.findIndex((r) => r[0] === "Athlete");
      expect(cells[at - 1].slice(1, 3), mode).toEqual(["WARM-UP", "STRENGTH"]);
      expect(cells[at].slice(1, 3)).toEqual(["Bike", "Back Squat"]);
      const read = readUpload(Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" })), "sheet.xlsx");
      expect(read.ok, mode).toBe(true);
      if (read.ok) expect(read.racks[0].headers).toEqual([["Bike", "Back Squat"]]);
    }
  });
});
