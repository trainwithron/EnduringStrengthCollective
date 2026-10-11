import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { filterPrograms, orderForAssign, programLabel, SEARCH_FROM, type PickableProgram } from "@/lib/assign-picker";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");
const p = (id: string, over: Partial<PickableProgram> = {}): PickableProgram => ({ id, name: `Program ${id}`, createdAt: `2026-0${id.length}-01`, aiDraft: false, clientName: null, sourceProgramId: null, ...over });

describe("the list a coach assigns from", () => {
  it("the most-copied programs come first, then the newest", () => {
    const list = orderForAssign([
      p("a", { createdAt: "2026-01-01" }),
      p("b", { createdAt: "2026-03-01" }),
      p("c", { createdAt: "2026-02-01" }),
      p("x1", { createdAt: "2026-04-01", sourceProgramId: "a", clientName: "Ann" }),
      p("x2", { createdAt: "2026-04-02", sourceProgramId: "a", clientName: "Bo" }),
      p("x3", { createdAt: "2026-04-03", sourceProgramId: "c", clientName: "Cy" }),
    ]);
    expect(list.map((x) => x.id)).toEqual(["a", "c", "x3", "x2", "x1", "b"]);
    expect(list[0].uses).toBe(2);
  });
  it("search matches the program name or the client it was made for, ignoring capitals", () => {
    const list = orderForAssign([p("a", { name: "Strength Block" }), p("b", { name: "Hypertrophy", clientName: "Robyn Lewis" })]);
    expect(filterPrograms(list, "strength").map((x) => x.id)).toEqual(["a"]);
    expect(filterPrograms(list, "ROBYN").map((x) => x.id)).toEqual(["b"]);
    expect(filterPrograms(list, "  ").length).toBe(2);
    expect(filterPrograms(list, "zzz")).toEqual([]);
  });
  it("labels say shared, whose copy it is, how often it was used, or that an AI draft must be signed off first", () => {
    expect(programLabel({ aiDraft: false, clientName: null, uses: 0 })).toBe("Shared");
    expect(programLabel({ aiDraft: false, clientName: "Ann", uses: 0 })).toBe("Ann's copy");
    expect(programLabel({ aiDraft: false, clientName: null, uses: 3 })).toBe("Shared · used 3 times");
    expect(programLabel({ aiDraft: false, clientName: null, uses: 1 })).toBe("Shared · used 1 time");
    expect(programLabel({ aiDraft: true, clientName: null, uses: 0 })).toBe("AI draft: signed off when you assign");
  });
});

describe("the client's Programs tab", () => {
  const actions = read("components/coach/client-program-actions.tsx");
  const section = read("components/coach/desktop/client-programs-section.tsx");
  const page = read("app/(coach)/groups/[groupId]/athletes/[athleteId]/page.tsx");

  it("the client's programs are listed right away (no 'View assigned programs' step); the old three-choice menu is gone", () => {
    expect(section).toContain('.eq("athlete_id", athleteId)');
    expect(section).toContain("programs.map((p)");
    expect(page).toContain("<ClientProgramActions");
    expect(page).not.toContain("ClientProgrammingMenu");
    expect(actions).not.toContain("View Assigned Programs");
    expect(() => readFileSync(join(__dirname, "..", "components/coach/client-programming-menu.tsx"))).toThrow();
  });
  it("two plain buttons: Assign program and Build with AI", () => {
    expect(actions).toContain("Assign program\n");
    expect(actions).toContain("Build with AI\n");
    expect(actions).toContain("/programs/new?method=ai&athleteId=${athleteId}");
  });
  it("assigning is one click with the existing copy engine, a start date that defaults to today, and no confirmation popup", () => {
    expect(actions).toContain("assignProgramToClient(supabase, {");
    expect(actions).toContain("const [startDate, setStartDate] = useState(localDateKey());");
    expect(actions).toContain("startDate: startDate || undefined");
    expect(actions).not.toContain("confirmDialog");
    expect(actions).not.toContain("window.confirm");
    expect(actions).toContain("router.refresh();");
  });
  it("offers all of the coach's own programs, newest and most-copied first, with a search box once the list is long", () => {
    expect(actions).toContain('.eq("created_by", user.id)');
    expect(actions).toContain("orderForAssign(");
    expect(actions).toContain("searchFrom={SEARCH_FROM}");
    expect(read("components/coach/search-pick-list.tsx")).toContain("items.length >= searchFrom");
    expect(SEARCH_FROM).toBeGreaterThan(1);
  });
  it("an unsigned AI draft can be picked: the click signs it off and assigns it", () => {
    expect(actions).toContain("if (busyId) return;");
    expect(actions).toContain("ensureSignedOff({ aiDraft: program.aiDraft, programId: program.id })");
    expect(actions).not.toContain("disabled: p.aiDraft");
    expect(section).toContain('p.ai_draft ? "AI draft"');
  });
  it("fits a phone: buttons and rows are at least 44px, the date and search fill the width", () => {
    expect(actions).toContain("min-h-11");
    expect(actions).toContain("w-full sm:w-48");
    expect(read("components/coach/search-pick-list.tsx")).toContain("max-h-72 overflow-y-auto");
  });
});
