import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");

describe("the rail's group-id list holds still between renders", () => {
  const hook = read("lib/use-org-group-ids.ts");
  it("useOrgGroupIds returns a memoised list, so an effect that depends on it runs once per change, not once per render", () => {
    expect(hook).toContain("return useMemo(() => (groups ? groups.map((g) => g.id) : null), [groups]);");
    expect(hook).not.toContain("return groups ? groups.map((g) => g.id) : null;");
  });
  it("the three widgets that wait on it list it as an effect dependency (which is why it must be stable)", () => {
    for (const f of ["components/coach/desktop/roster-mini-list.tsx", "components/coach/desktop/business-mini-dashboard.tsx", "components/coach/desktop/needs-attention-strip.tsx"]) {
      const src = read(f);
      expect(src).toContain("useOrgGroupIds(groupId)");
      expect(src).toMatch(/\}, \[[^\]]*groupIds[^\]]*\]\);/);
    }
  });
  it("the groups themselves are stored once in state, so the memo only changes when they do", () => {
    expect(hook).toContain("const [groups, setGroups] = useState<CoachedGroup[] | null>(null);");
  });
});

describe("one answer per page render for the shared lookups", () => {
  it("the coached groups, the coach's time zone and the viewer's display zone are read once per render and shared", () => {
    expect(read("lib/coach-groups.ts")).toContain("export const getCoachedGroups = cache(readCoachedGroups);");
    expect(read("lib/timezone.ts")).toContain("export const getGroupCoachTimezone = cache(readGroupCoachTimezone);");
    expect(read("lib/display-timezone-server.ts")).toContain("export const getViewerDisplayTimezone = cache(readViewerDisplayTimezone);");
  });
  it("they share the request's one Supabase client, which is what makes the shared answer possible", () => {
    expect(read("lib/supabase/server.ts")).toContain("export const createServerClient = cache(buildServerClient);");
  });
});
