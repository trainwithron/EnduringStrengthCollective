import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PROGRAM_DESCRIPTION_MAX, descriptionCounter, saveProgramDescription, tidyProgramDescription } from "./program-description";

const src = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

describe("the program description", () => {
  it("is saved as typed: line endings made plain, blank space at the two ends removed, nothing else changed", () => {
    expect(tidyProgramDescription("  Four weeks.\r\nThen test.  ")).toBe("Four weeks.\nThen test.");
    expect(tidyProgramDescription("Keep   the  inner   spaces & symbols <b>")).toBe("Keep   the  inner   spaces & symbols <b>");
  });

  it("an empty or blank box means no description", () => {
    expect(tidyProgramDescription("")).toBeNull();
    expect(tidyProgramDescription("   \n  ")).toBeNull();
    expect(tidyProgramDescription(null)).toBeNull();
    expect(tidyProgramDescription(undefined)).toBeNull();
  });

  it("is capped at 2,000 characters, and the counter warns when little room is left", () => {
    expect(PROGRAM_DESCRIPTION_MAX).toBe(2000);
    expect(tidyProgramDescription("x".repeat(2500))!.length).toBe(2000);
    expect(descriptionCounter("hi")).toEqual({ label: "2 / 2000", nearLimit: false });
    expect(descriptionCounter("x".repeat(1950)).nearLimit).toBe(true);
  });
});

describe("where the description can be changed", () => {
  it("the review screen of an import has an editable box prefilled with the text, a counter and Clear, and what is saved is the confirmed text", () => {
    const wizard = src("components/coach/desktop/import-wizard.tsx");
    expect(wizard).toContain("value={pending.description}");
    expect(wizard).toContain("maxLength={PROGRAM_DESCRIPTION_MAX}");
    expect(wizard).toContain('setPending((prev) => (prev ? { ...prev, description: "" } : prev))');
    expect(wizard).toContain("const description = tidyProgramDescription(importData.description);");
    // the insert uses the confirmed value
    expect(wizard).toMatch(/name: programName \|\| "Imported Program",\n\s+description,/);
  });

  it("the program page lets the coach change it afterwards for any program, saves through saveProgramDescription, and shows Saved only when the write saved a row", () => {
    const builder = src("components/coach/desktop/program-builder-desktop.tsx");
    expect(builder).toContain("<ProgramDescriptionEditor programId={programId} initialDescription={programDescription} />");
    const editor = src("components/coach/program-description-editor.tsx");
    expect(editor).toContain("await saveProgramDescription(");
    const afterSaveCheck = editor.indexOf("if (!result.ok)");
    expect(afterSaveCheck).toBeGreaterThan(-1);
    expect(editor.indexOf('text: "Saved."')).toBeGreaterThan(afterSaveCheck);
    expect(editor).toContain("PROGRAM_DESCRIPTION_MAX");
    expect(editor).toContain("Clear");
  });
});

describe("a coach's description is never overwritten by the AI or lost on a copy", () => {
  it("no AI route and no builder helper writes programs.description on an existing program; only the import insert and saveProgramDescription (the editor) do", () => {
    const writers: string[] = [];
    const walk = (dir: string): string[] => {
      return readdirSync(dir, { withFileTypes: true }).flatMap((e: { name: string; isDirectory(): boolean }) => (e.isDirectory() ? (e.name === "node_modules" ? [] : walk(`${dir}/${e.name}`)) : /\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name) ? [`${dir}/${e.name}`] : []));
    };
    for (const f of [...walk("app"), ...walk("components"), ...walk("lib")]) {
      const text = src(f);
      if (/from\(["']programs["']\)\s*\.update\(\{[^}]*description/.test(text.replace(/\n\s*/g, " "))) writers.push(f);
    }
    expect(writers).toEqual(["lib/program-description.ts"]);
  });

  it("duplicating or assigning a program copies the description (the latest duplicate_program, which assign_program_to_client calls)", () => {
    const sql = src("supabase/migrations/0367_rest_range.sql");
    expect(sql).toContain("src.description");
    expect(src("supabase/migrations/0335_assign_program_to_client.sql")).toContain("public.duplicate_program(");
  });
});

describe("saving tells the truth", () => {
  // A stand-in client: the update comes back with the given rows or error.
  const client = (result: { data?: unknown; error?: { message?: string } | null }) => {
    const seen: { values?: unknown; id?: string } = {};
    const chain = {
      from: () => ({
        update: (values: unknown) => {
          seen.values = values;
          return {
            eq: (_col: string, id: string) => {
              seen.id = id;
              return { select: async () => result, then: undefined } as never;
            },
          };
        },
      }),
    } as never;
    return { chain, seen };
  };

  it("a saved row is a success and returns the tidied text", async () => {
    const { chain, seen } = client({ data: [{ id: "p1" }], error: null });
    const r = await saveProgramDescription(chain, "p1", "  New text \r\n");
    expect(r).toEqual({ ok: true, description: "New text" });
    expect(seen).toEqual({ values: { description: "New text" }, id: "p1" });
  });

  it("an empty box saves nothing as the description", async () => {
    const { chain, seen } = client({ data: [{ id: "p1" }], error: null });
    expect(await saveProgramDescription(chain, "p1", "   ")).toEqual({ ok: true, description: null });
    expect(seen.values).toEqual({ description: null });
  });

  it("row security refusing the update (no error, no rows) is a failure, so 'Saved.' is never shown and the typed text is kept by the screen", async () => {
    const { chain } = client({ data: [], error: null });
    const r = await saveProgramDescription(chain, "p1", "Typed text");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("Couldn't save the description.");
  });

  it("a database error is a failure too", async () => {
    const { chain } = client({ data: null, error: { message: "boom" } });
    expect((await saveProgramDescription(chain, "p1", "x")).ok).toBe(false);
  });
});
