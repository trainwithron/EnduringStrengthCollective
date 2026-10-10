import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CLIENT_SHOWN, OTHERS_SHOWN, clientIdFromPath, panelProgramLabel, panelPrograms, type PanelProgramRow } from "@/lib/program-panel";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");
const r = (id: string, over: Partial<PanelProgramRow> = {}): PanelProgramRow => ({ id, name: `P ${id}`, groupId: "g1", athleteId: null, clientName: null, isActive: true, aiDraft: false, createdAt: `2026-01-${id.padStart(2, "0")}`, ...over });

describe("the side panel's program list", () => {
  it("outside a client's profile it is the coach's active programs, newest first, with unsigned AI drafts marked and kept", () => {
    const out = panelPrograms([r("1"), r("3"), r("2", { isActive: false }), r("4", { isActive: false, aiDraft: true })], null, null);
    expect(out.forClient).toEqual([]);
    expect(out.others.map((p) => p.id)).toEqual(["4", "3", "1"]);
    expect(panelProgramLabel(out.others[0])).toBe("AI draft");
  });
  it("inside a client's profile their programs come first (active first), then the other programs without repeating them", () => {
    const rows = [
      r("1"),
      r("2", { athleteId: "ann", clientName: "Ann", isActive: false }),
      r("3", { athleteId: "ann", clientName: "Ann" }),
      r("4", { athleteId: "bo", clientName: "Bo" }),
    ];
    const out = panelPrograms(rows, "ann", null);
    expect(out.forClient.map((p) => p.id)).toEqual(["3", "2"]);
    expect(out.others.map((p) => p.id)).toEqual(["4", "1"]);
    expect(panelProgramLabel(out.forClient[1])).toBe("Ann · not active");
    expect(panelProgramLabel(out.others[0])).toBe("Bo");
    expect(panelProgramLabel(out.others[1])).toBe("Shared");
  });
  it("is short: a few of the client's programs and a few others, with a count of what is not shown", () => {
    const many = Array.from({ length: 20 }, (_, i) => r(String(i + 1)));
    const out = panelPrograms(many, null, null);
    expect(out.others.length).toBe(OTHERS_SHOWN);
    expect(out.moreCount).toBe(20 - OTHERS_SHOWN);
    const mine = Array.from({ length: 10 }, (_, i) => r(String(i + 1), { athleteId: "ann", clientName: "Ann" }));
    expect(panelPrograms(mine, "ann", null).forClient.length).toBe(CLIENT_SHOWN);
  });
  it("shows only programs in the organization's groups", () => {
    const out = panelPrograms([r("1"), r("2", { groupId: "other" })], null, ["g1"]);
    expect(out.others.map((p) => p.id)).toEqual(["1"]);
  });
  it("finds the client from the address", () => {
    expect(clientIdFromPath("/groups/g1/athletes/abc-123")).toBe("abc-123");
    expect(clientIdFromPath("/groups/g1/athletes/abc-123/calendar")).toBe("abc-123");
    expect(clientIdFromPath("/groups/g1/programs/p1")).toBeNull();
    expect(clientIdFromPath(null)).toBeNull();
  });
});

describe("the Program tab", () => {
  const panel = read("components/coach/desktop/shell-list-panel.tsx");
  const list = read("components/coach/desktop/program-panel-list.tsx");
  it("the tab shows the list, not the whole builder", () => {
    expect(panel).toContain('{view === "program" && <ProgramPanelList groupId={groupId} />}');
    expect(panel).not.toContain("EmbeddedProgramBuilder");
    // the in-panel full builder and its data route were removed with this change
    expect(existsSync(join(__dirname, "..", "components/coach/desktop/embedded-program-builder.tsx"))).toBe(false);
    expect(existsSync(join(__dirname, "..", "app/api/coach/program-builder-data/route.ts"))).toBe(false);
  });
  it("has the Build a program action (the existing new-program entry), 44px rows, opens a program by one tap, and uses the coach's word for client", () => {
    expect(list).toContain("Build a program");
    expect(list).toContain("/programs/new");
    expect(list).toContain("min-h-11");
    expect(list).toContain("`/groups/${r.groupId}/programs/${r.id}`");
    expect(list).toContain('term("client")');
    expect(list).toContain('.eq("created_by", user.id)');
  });
});
