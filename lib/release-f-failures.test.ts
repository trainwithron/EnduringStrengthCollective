import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { saved, bestEffort } from "@/lib/saved";
import { showSaveFailed, subscribeSaveFailed, clearSaveFailed } from "@/lib/save-failed";
import { aiFeatureHealth, aiFeaturesToAlert } from "@/lib/ai-health";

const root = join(__dirname, "..");
const src = (p: string) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
function pages(d: string, out: string[] = []): string[] {
  for (const f of readdirSync(join(root, d))) {
    const rel = d + "/" + f;
    if (statSync(join(root, rel)).isDirectory()) pages(rel, out);
    else if (f === "page.tsx") out.push(rel);
  }
  return out;
}

describe("a write whose result nobody looked at now says when it did not save", () => {
  it("saved() returns true and shows nothing when the write worked", async () => {
    const seen: Array<string | null> = [];
    const off = subscribeSaveFailed((m) => seen.push(m));
    expect(await saved(Promise.resolve({ data: [], error: null }))).toBe(true);
    off();
    clearSaveFailed();
    expect(seen).toEqual([null]);
  });
  it("saved() returns false and puts the message on the shared bar when the write failed or threw", async () => {
    const seen: Array<string | null> = [];
    const off = subscribeSaveFailed((m) => seen.push(m));
    expect(await saved(Promise.resolve({ error: { message: "network" } }), "Couldn't rename that.")).toBe(false);
    expect(await saved(Promise.reject(new Error("offline")))).toBe(false);
    off();
    clearSaveFailed();
    expect(seen.filter(Boolean)).toEqual(["Couldn't rename that.", "That didn't save. Try again."]);
  });
  it("saved() counts 'already there' (a unique-key conflict) as saved", async () => {
    expect(await saved(Promise.resolve({ error: { message: "duplicate key value", code: "23505" } }))).toBe(true);
    expect(await saved(Promise.resolve({ error: { message: "other", code: "42501" } }))).toBe(false);
    clearSaveFailed();
  });
  it("bestEffort() looks at the result, never throws, and stays quiet", async () => {
    const spy = vi.fn();
    const off = subscribeSaveFailed(spy);
    spy.mockClear();
    expect(await bestEffort(Promise.resolve({ error: { message: "x" } }))).toBe(false);
    expect(await bestEffort(Promise.reject(new Error("x")))).toBe(false);
    expect(await bestEffort(Promise.resolve({ error: null }))).toBe(true);
    off();
    expect(spy).not.toHaveBeenCalledWith(expect.stringContaining("save"));
    showSaveFailed("x");
    clearSaveFailed();
  });
  it("no screen is left with an unchecked write (the list that could only shrink is now empty)", () => {
    expect(JSON.parse(src("lib/unchecked-writes-baseline.json"))).toEqual({});
  });
  it("the shared bar is mounted once, in the root layout", () => {
    expect(src("app/layout.tsx")).toContain("<SaveFailedToast />");
  });
});

describe("a page whose data could not be read says so instead of looking empty", () => {
  it("no server page reads the member's role without checking the read failed", () => {
    const offenders = pages("app").filter((p) => /const \{ data: membership \} = await supabase/.test(src(p)));
    expect(offenders).toEqual([]);
  });
  it("the workout page tells a failed read from a missing workout and from an empty one", () => {
    const p = src("app/sessions/[sessionId]/page.tsx");
    expect(p).toContain('(sessionError as { code?: string }).code !== "PGRST116"');
    expect(p).toContain("if (sessionExercisesError) {");
  });
});

describe("AI calls that are cut off", () => {
  it("callClaude asks once more with twice the room, and a route that retries in its own way turns that off", () => {
    const c = src("lib/anthropic-client.ts");
    expect(c).toContain("retryOnTruncation = true");
    expect(c).toContain("maxTokens: Math.min(maxTokens * 2, MAX_OUTPUT_TOKENS)");
    for (const f of ["app/api/ai/build-day/route.ts", "app/api/ai/pick-template/route.ts", "app/api/ai/parse-workout/route.ts", "app/api/ai/explain-program/route.ts"]) {
      expect(src(f), f).toContain("retryOnTruncation: false");
    }
  });
  it("credits are taken only after a usable answer (never for a cut-off call)", () => {
    for (const f of ["app/api/ai/build-day/route.ts", "app/api/ai/generate-program/route.ts", "app/api/ai/pick-template/route.ts"]) {
      const t = src(f);
      expect(t.indexOf("callClaude("), f).toBeLessThan(t.indexOf("checkAndSpendCoachCredits("));
    }
  });
  it("a feature whose calls end badly more than 10 percent of the time (with at least 10 calls) is reported", () => {
    const rows = [
      ...Array.from({ length: 8 }, () => ({ feature: "program_day", status: "ok" })),
      ...Array.from({ length: 4 }, () => ({ feature: "program_day", status: "truncated" })),
      ...Array.from({ length: 30 }, () => ({ feature: "program_chat", status: "ok" })),
      { feature: "program_chat", status: "error" },
      { feature: "rare", status: "error" },
      { feature: "rare", status: "started" },
    ];
    const health = aiFeatureHealth(rows);
    expect(health.find((h) => h.feature === "program_day")).toMatchObject({ calls: 12, notOk: 4 });
    expect(aiFeaturesToAlert(health).map((h) => h.feature)).toEqual(["program_day"]);
    expect(src("app/api/cron/cron-watchdog/route.ts")).toContain("aiFeaturesToAlert(");
  });
});
