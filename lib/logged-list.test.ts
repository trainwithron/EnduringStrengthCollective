import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mergeLoggedList } from "@/lib/logged-list";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

// Ron: History becomes part of Logged workouts: "Import or add past history", and imported workouts appear in the list, marked Imported.
describe("Logged workouts with imported history", () => {
  const logs = [
    { id: "l1", created_at: "2026-10-10T18:00:00Z" },
    { id: "l2", created_at: "2026-09-01T18:00:00Z" },
  ];
  const imported = [
    { id: "i1", started_at: "2026-09-20T12:00:00", exercises: 5 },
    { id: "i2", started_at: "2025-01-05T12:00:00", exercises: 3 },
  ];
  it("both kinds in date order, newest first, each knowing which it is", () => {
    const list = mergeLoggedList(logs, imported, 50);
    expect(list.map((i) => i.key)).toEqual(["l1", "i1", "l2", "i2"]);
    expect(list.filter((i) => i.imported).map((i) => i.key)).toEqual(["i1", "i2"]);
    expect(list.find((i) => i.key === "l1")!.imported).toBeNull();
    expect(list.find((i) => i.key === "i1")!.log).toBeNull();
  });
  it("only the most recent are kept", () => {
    expect(mergeLoggedList(logs, imported, 2).map((i) => i.key)).toEqual(["l1", "i1"]);
  });
  it("nothing at all stays an empty list (the page then says No completed workouts yet.)", () => {
    expect(mergeLoggedList([], [], 50)).toEqual([]);
  });
});

describe("the profile", () => {
  const page = read("app/(coach)/groups/[groupId]/athletes/[athleteId]/page.tsx");
  it("the tab strip no longer has a History link; Logged workouts has Import or add past history to the same page", () => {
    expect(read("components/coach/desktop/client-profile-tabs.tsx")).not.toContain("History");
    expect(page).toContain("Import or add past history");
    expect(page).toContain("`/groups/${params.groupId}/athletes/${params.athleteId}/history`");
  });
  it("imported rows say Imported and open the same session page; the empty state stays", () => {
    expect(page).toContain(">Imported<");
    expect(page).toContain("href={`/sessions/${imported.id}`}");
    expect(page).toContain("No completed workouts yet.");
    expect(page).toContain("loggedList.length === 0");
  });
  it("the Workouts, Volume and PRs numbers are the logged workouts plus the counted imported history (lib/imported-prs.ts)", () => {
    expect(page).toContain("const statEvents: StatEvent[] = [");
    expect(page).toContain("...(allLogs ?? []).map((l) => ({ date: dateKeyInZone(l.created_at as string, displayZone)");
    expect(page).toContain("for (const log of allLogs ?? []) {");
    // the Logged workouts list's own count is the logs plus the imported sessions it lists (or those that match a search), never the stats total
    expect(page).toContain("const loggedListTotal = logsForList.length + (searching ? importedForList.length : Math.max(0, (importedTotal ?? importedSessions?.length ?? 0) - promotedAmongImported));");
    // imported sessions are read for the list in the first batch of waits, with no extra queries
    expect(page).not.toContain("importedSetRows");
    expect(page).toContain('.eq("is_historical", true)');
  });
  it("the History page itself is still there", () => {
    expect(read("app/(coach)/groups/[groupId]/athletes/[athleteId]/history/page.tsx").length).toBeGreaterThan(100);
  });
});
