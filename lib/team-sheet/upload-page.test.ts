import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

describe("the upload page and its screens", () => {
  it("the page is for a coach of the group, lists saved uploads, and still loads before the table exists", () => {
    const p = src("app/(coach)/groups/[groupId]/team-sheet/upload/page.tsx");
    expect(p).toContain('membership?.role !== "coach"');
    expect(p).toContain("TeamSheetSavedUploads");
    expect(p).toContain("uploads.error ? []");
    expect(src("app/(coach)/groups/[groupId]/team-sheet/page.tsx")).toContain("/team-sheet/upload");
  });

  it("the review screen: Excel or CSV only, nothing saved until Save, boxes can be corrected, unsure boxes are marked and save nothing", () => {
    const c = src("components/coach/team-sheet-upload.tsx");
    expect(c).toContain('accept=".xlsx,.csv"');
    expect(c).toContain("Nothing is saved until you check it here and press Save.");
    expect(c).toContain("/api/team-sheet/upload");
    expect(c).toContain("/api/team-sheet/save");
    expect(c).toContain("readBox(");
    expect(c).toContain("not sure: left blank");
    expect(c).toContain("fix them or they will be left blank");
    // the code goes back as printed; the cell text is all the browser contributes
    expect(c).toContain("code: s.codeText,");
    expect(c).not.toContain("encodeSheetCode");
    // an athlete can be left out, and one who is gone cannot be put back in
    expect(c).toContain("disabled={row.gone}");
    expect(c).toContain("not in this group any more");
    expect(c).toContain("printed as {row.printedName}: check it is the right person");
  });

  it("an athlete's own session is kept unless the coach chooses to replace it, and replacing asks first and says it cannot be undone", () => {
    const c = src("components/coach/team-sheet-upload.tsx");
    expect(c).toContain("Keep what is there (recommended)");
    expect(c).toContain("const [replace, setReplace] = useState(false);");
    expect(c).toContain("their own session is deleted and cannot be brought back");
    expect(c).toContain("destructive: true");
    expect(c).toContain("Undoing this upload removes the sheet&apos;s workouts but does not bring back the sessions it replaced.");
  });

  it("after a save: what happened in plain words, nobody but the coach is told, and a way to undo", () => {
    const c = src("components/coach/team-sheet-upload.tsx");
    expect(c).toContain("No one is notified except you.");
    expect(c).toContain("Undo this upload");
    expect(c).toContain("/api/team-sheet/undo");
    const s = src("components/coach/team-sheet-saved-uploads.tsx");
    expect(s).toContain("Undo upload");
    expect(s).toContain("Nothing has been saved from an uploaded sheet yet.");
    expect(s).toContain("router.refresh()");
  });

  it("the client code never pulls in the server-only parts (no node modules in the browser bundle)", () => {
    for (const f of ["components/coach/team-sheet-upload.tsx", "components/coach/team-sheet-saved-uploads.tsx", "lib/team-sheet/cell-parser.ts"]) {
      const s = src(f);
      expect(s, f).not.toMatch(/from "node:|require\(/);
      expect(s, f).not.toContain("sheet-code");
    }
  });

  it("every route is a coach-only write through the database function, none writes a table itself", () => {
    for (const f of ["app/api/team-sheet/upload/route.ts", "app/api/team-sheet/save/route.ts", "app/api/team-sheet/undo/route.ts"]) {
      const s = src(f);
      expect(s, f).toMatch(/requireCoach\(/);
      expect(s, f).toContain("rateLimitResponse(");
      expect(s, f).not.toMatch(/\.insert\(|\.update\(|\.upsert\(|\.delete\(/);
    }
    expect(src("app/api/team-sheet/save/route.ts")).toContain('supabase.rpc("team_sheet_save"');
    expect(src("app/api/team-sheet/undo/route.ts")).toContain('supabase.rpc("team_sheet_undo"');
    expect(src("app/api/team-sheet/upload/route.ts")).not.toContain("rpc(");
  });
});
