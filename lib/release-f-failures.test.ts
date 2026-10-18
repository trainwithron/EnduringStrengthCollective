import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { saved, bestEffort } from "@/lib/saved";
import { showSaveFailed, subscribeSaveFailed, clearSaveFailed } from "@/lib/save-failed";
import { aiFeatureHealth, aiFeaturesToAlert } from "@/lib/ai-health";
import { isReadFailure } from "@/lib/read-failed";

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
    expect(p).toContain("isReadFailure(sessionError)");
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

describe("review follow-ups: the check that watches the AI, and a bar that restarts", () => {
  it("a cut-off call whose retry finished is not counted as a failure the person saw", () => {
    const at = (s: number) => new Date(Date.UTC(2026, 9, 16, 12, 0, s)).toISOString();
    const rows = [
      { feature: "inbody_scan_parse", status: "truncated", created_at: at(0), user_id: "u1", coach_id: null },
      { feature: "inbody_scan_parse", status: "ok", created_at: at(5), user_id: "u1", coach_id: null },
      // a cut-off call with no finished retry, and one by someone else, still count
      { feature: "inbody_scan_parse", status: "truncated", created_at: at(60), user_id: "u2", coach_id: null },
      { feature: "inbody_scan_parse", status: "ok", created_at: at(65), user_id: "u3", coach_id: null },
    ];
    expect(aiFeatureHealth(rows).find((h) => h.feature === "inbody_scan_parse")).toMatchObject({ calls: 3, notOk: 1 });
  });
  it("the daily check reads the last 24 hours a page at a time, oldest first (a request returns at most 1,000 rows)", () => {
    const w = src("app/api/cron/cron-watchdog/route.ts");
    expect(w).toContain("86400000");
    expect(w).toContain("pageAll(");
    expect(w).not.toContain(".limit(20000)");
  });
  it("a retry the usage rules refuse gives back the cut-off answer, not an out-of-uses message", () => {
    const c = src("lib/anthropic-client.ts");
    expect(c).toContain("retryError instanceof AiRateLimitedError");
  });
  it("a second failure with the same words restarts the bar's timer", () => {
    expect(src("components/ui/save-failed-toast.tsx")).toContain("[message, shownCount]");
  });
  it("the Add button and auto-add mode insert reminders instead of upserting onto a partial unique index", () => {
    for (const f of ["components/coach/desktop/needs-attention-panel.tsx", "lib/needs-attention-data.ts"]) {
      expect(src(f), f).not.toContain('onConflict: "coach_id,linked_athlete_id,trigger_key"');
    }
  });
  it("the Stripe routes stop when the ids they just created could not be saved", () => {
    expect(src("app/api/coach/packages/route.ts")).toContain("if (priceSaveError) throw priceSaveError;");
    expect(src("app/api/stripe/connect/onboard/route.ts")).toContain("if (saveError) {");
  });
});

describe("a malformed id in the address is 'not found', not 'couldn't load'", () => {
  it("isReadFailure treats an invalid uuid (22P02) and a no-row answer (PGRST116) as not a failure", () => {
    expect(isReadFailure(null)).toBe(false);
    expect(isReadFailure({ code: "22P02" })).toBe(false);
    expect(isReadFailure({ code: "PGRST116" })).toBe(false);
    expect(isReadFailure({ code: "57014" })).toBe(true);
    expect(isReadFailure({})).toBe(true);
  });
  it("no page returns the load-failed page on a bare membership error", () => {
    const offenders = pages("app").filter((p) => src(p).includes("if (membershipError) return <LoadFailedPage />"));
    expect(offenders).toEqual([]);
  });
});

describe("a screen shows the saved state only when the write saved (saved() returned true)", () => {
  // The files fixed in the Release F review: each keeps the result of saved() and acts on it. A bare 'await saved(' statement followed by a state change would bring the old behaviour back.
  const FIXED = [
    "components/athlete/progress-photo-journal.tsx",
    "components/coach/desktop/program-card-grid.tsx",
    "components/coach/desktop/habit-manager.tsx",
    "components/coach/desktop/pro-shop-manager.tsx",
    "components/coach/desktop/referral-directory-manager.tsx",
    "components/coach/desktop/session-type-manager.tsx",
    "components/coach/desktop/stat-field-manager.tsx",
    "components/coach/goal-confirmation-control.tsx",
    "components/coach/history-import-access-toggle.tsx",
    "components/coach/main-lift-picker.tsx",
    "components/coach/desktop/team-depth-chart.tsx",
    "components/coach/desktop/coach-position-scope-list.tsx",
    "components/coach/desktop/recipe-vote-favorite.tsx",
    "components/share/customize-share-panel.tsx",
    "components/share/background-picker.tsx",
    "components/coach/availability-manager.tsx",
    "components/coach/desktop/org-notifications-panel.tsx",
    "components/coach/nutrition-phase-control.tsx",
    "components/session/complete-workout-button.tsx",
  ];
  for (const f of FIXED) {
    it(f + " does not ignore what saved() returns", () => {
      const text = src(f);
      expect(text.split("\n").some((line) => line.trim().startsWith("await saved(")), f).toBe(false);
    });
  }
});

describe("a write whose result is deliberately not used says why", () => {
  function allFiles(d: string, out: string[] = []): string[] {
    for (const f of readdirSync(join(root, d))) {
      const rel = d + "/" + f;
      if (statSync(join(root, rel)).isDirectory()) allFiles(rel, out);
      else if (/\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f)) out.push(rel);
    }
    return out;
  }
  it("every 'await saved(' that stands alone has a comment line above it that starts with Deliberately", () => {
    const offenders: string[] = [];
    for (const f of [...allFiles("app"), ...allFiles("components"), ...allFiles("lib")]) {
      const lines = src(f).split("\n");
      lines.forEach((line, i) => {
        if (!line.trim().startsWith("await saved(")) return;
        const above = (lines[i - 1] ?? "").trim();
        if (!(above.startsWith("//") && above.includes("Deliberately"))) offenders.push(f + ":" + (i + 1));
      });
    }
    expect(offenders).toEqual([]);
  });
});
