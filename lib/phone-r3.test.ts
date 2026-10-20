import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// Release 3 (Ron: "it should just default to one. And however you use it, it uses"): Spotlight > Program is ONE box, the same as the computer's New program.
const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
const panel = read("components/coach/mobile/spot-builder-panel.tsx");
const hub = read("components/coach/mobile/coach-spot-hub.tsx");

describe("one Program box", () => {
  it("is the computer's box (ImportWizard), full screen, loaded only when opened, with no AI/Parse switch and no compact steps", () => {
    expect(panel).toContain('const ImportWizard = dynamic(() => import("@/components/coach/desktop/import-wizard").then((m) => m.ImportWizard)');
    expect(panel).toContain('className="fixed inset-0 z-50 bg-graphite overflow-y-auto" data-spot-program-box');
    for (const gone of ["autoGenerate", "initialAiPrompt", 'setMode("parse")', '"compact"', '"expanded"', "parseQuickBuildInput"]) expect(panel, gone).not.toContain(gone);
    expect(existsSync(join(root, "lib/spot-quick-build.ts"))).toBe(false);
  });
  it("a client is optional: none makes the coach's own program in the organization's group; a client makes it in their own group", () => {
    expect(panel).toContain('<option value="">No {term("client")} yet (assign it later)</option>');
    expect(panel).toContain("groupId={athleteId ? (athleteGroupId ?? groupId) : groupId}");
    expect(panel).toContain("getCoachClients(supabase, user.id, groupId),");
    expect(panel).toContain('key={athleteId ?? "none"}');
  });
  it("closing with work open asks first; the ?spotBuilder deep link still opens it for that client", () => {
    expect(panel).toContain('guard: () => (active ? "ask" : "close")');
    expect(panel).toContain("onActivity={setActive}");
    expect(hub).toContain("const [builderOpen, setBuilderOpen] = useState(!!initialAthleteId);");
    expect(read("components/coach/mobile/coach-mobile-shell.tsx")).toContain('const spotBuilderAthleteId = searchParams.get("spotBuilder");');
  });
  it("the Program tile is the box and All programs, nothing else", () => {
    expect(hub).toContain("Build a program\n                      </button>");
    expect(hub).toContain('<a href="/programs"');
    expect(hub).not.toContain("ProgramMiniView");
    expect(hub).toContain("onClose={() => setBuilderOpen(false)}");
  });
  it("the dead panels are gone", () => {
    for (const f of ["components/coach/mobile/spot-business-panel.tsx", "components/coach/desktop/program-mini-view.tsx"]) expect(existsSync(join(root, f)), f).toBe(false);
  });
  it("the box fits a 375px phone: no fixed width wider than the screen", () => {
    const wizard = read("components/coach/desktop/import-wizard.tsx");
    expect(wizard).not.toMatch(/\b(min-)?w-\[(3[8-9]\d|[4-9]\d\d|\d{4,})px\]/);
  });
});
