import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..");
const src = (p: string) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");

describe("Release H: importers", () => {
  it("every history import carries one batch id, saved on each workout it creates, and the whole batch can be undone", () => {
    const lib = src("lib/exercise-history-import.ts");
    expect(lib).toContain("import_batch_id: params.importBatchId");
    expect(lib).toContain("importBatchId: batchId");
    // Undo removes only historical workouts of that person in that batch, never one logged live.
    expect(lib).toMatch(/\.eq\("import_batch_id", batchId\)\.eq\("athlete_id", athleteId\)\.eq\("is_historical", true\)/);
    expect(src("supabase/migrations/0390_import_batch_undo.sql")).toContain("add column if not exists import_batch_id uuid");
    const ui = src("components/coach/exercise-history-uploader.tsx");
    expect(ui).toContain("Undo this import");
    expect(ui).toContain("batchId: csvBatchId ?? undefined");
  });

  it("the history screen shows every skipped row with its row number and reason, and an athlete's own import never writes an unclear flag", () => {
    const ui = src("components/coach/exercise-history-uploader.tsx");
    expect(ui).toContain("canFlag: viewerIsCoach");
    expect(ui).toContain("Row {s.rowNumber}: {s.detail}");
    expect(ui).not.toContain("csvSkippedCount");
  });

  it("a typed quick entry is checked against the database's value limits before it is sent", () => {
    const ui = src("components/coach/exercise-history-uploader.tsx");
    expect(ui).toContain("SET_VALUE_LIMITS.weightLb");
    expect(ui).toContain("SET_VALUE_LIMITS.reps");
    expect(ui).toContain("SET_VALUE_LIMITS.rpe");
  });

  it("a program spreadsheet always stops on a preview, with the rows it left out named by row number", () => {
    const wiz = src("components/coach/desktop/import-wizard.tsx");
    expect(wiz).toContain("previewFirst: true");
    expect(wiz).toContain("!isAiSourced && !extras.previewFirst");
    expect(wiz).toContain("no exercise name and");
  });

  it("a roster is added through the same function as one client, one person at a time failing never stops the rest, and the page lists who was not added", () => {
    expect(src("app/api/clients/invite/route.ts")).toContain("createUnclaimedClient(");
    const route = src("app/api/clients/import-roster/route.ts");
    expect(route).toContain("createUnclaimedClient(");
    expect(route).toContain("runPool(");
    expect(route).toContain("pool.failed");
    expect(route).toContain("one_on_one");
    expect(route).toContain('rateLimitResponse("client-roster-import"');
    expect(src("components/coach/desktop/add-client-button.tsx")).toContain("RosterImportPanel");
  });

  it("taking a roster back removes only people who have never signed in, and keeps the coach's records about them", () => {
    const undo = src("app/api/clients/import-roster/undo/route.ts");
    expect(undo).toContain("profile.claimed_at");
    expect(undo).toContain("deletionBlocker(");
    expect(undo).toContain("eraseHistory: false");
  });
});
