import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { switchToPlannedPhase, NEW_BLOCK_NOTICE } from "@/lib/phase-switch";
import { createBaselineSuggestion } from "@/lib/baseline-suggestion";
import { setReviewDate } from "@/lib/phase-plan-write";
import type { PhasePlan } from "@/lib/phase-plan";
import type { BaselineResult } from "@/lib/nutrition-baseline";

const src = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8").split(String.fromCharCode(13, 10)).join(String.fromCharCode(10));

// A stand-in that records every write.
function fakeDb(opts: { failTable?: string } = {}) {
  const writes: { table: string; op: string; row?: Record<string, unknown>; filters?: [string, unknown][] }[] = [];
  const db = {
    from(table: string) {
      const fail = opts.failTable === table;
      return {
        upsert(row: Record<string, unknown>) {
          writes.push({ table, op: "upsert", row });
          return Promise.resolve({ error: fail ? { message: "x" } : null });
        },
        insert(row: Record<string, unknown>) {
          writes.push({ table, op: "insert", row });
          return Promise.resolve({ error: fail ? { message: "x" } : null });
        },
        delete() {
          const filters: [string, unknown][] = [];
          const chain: Record<string, unknown> = {
            eq: (c: string, v: unknown) => {
              filters.push([c, v]);
              if (filters.length === 2) {
                writes.push({ table, op: "delete", filters });
                return Promise.resolve({ error: null });
              }
              return chain;
            },
          };
          return chain;
        },
        update(row: Record<string, unknown>) {
          const filters: [string, unknown][] = [];
          const chain: Record<string, unknown> = {
            eq: (c: string, v: unknown) => {
              filters.push([c, v]);
              if (filters.length === 2) {
                writes.push({ table, op: "update", row, filters });
                return Promise.resolve({ error: null });
              }
              return chain;
            },
          };
          return chain;
        },
      };
    },
  };
  return { db: db as unknown as SupabaseClient, writes };
}

const plan: PhasePlan = { phase: "fat_loss", startedOn: "2026-09-10", reviewOn: "2026-10-08", plannedNextPhase: "reverse_diet", lastReviewedAt: null };

describe("moving to the planned phase", () => {
  it("sets the phase of record at once, from today, clears the review and the plan, and writes the milestone tag", async () => {
    const { db, writes } = fakeDb();
    const r = await switchToPlannedPhase(db, { athleteId: "a1", groupId: "g1", coachId: "c1", phase: "reverse_diet", todayKey: "2026-10-08", existing: plan });
    expect(r.ok).toBe(true);
    const planWrite = writes.find((w) => w.table === "client_phase_plans")!;
    expect(planWrite.row).toMatchObject({ athlete_id: "a1", group_id: "g1", phase: "reverse_diet", started_on: "2026-10-08", review_on: null, planned_next_phase: null, updated_by: "c1" });
    expect(writes.find((w) => w.table === "nutrition_phases")?.row).toMatchObject({ phase: "reverse_diet", started_at: "2026-10-08" });
  });
  it("asks nothing of the client: it creates no goal and writes nothing to the goals table", async () => {
    const { db, writes } = fakeDb();
    await switchToPlannedPhase(db, { athleteId: "a1", groupId: "g1", coachId: "c1", phase: "maintenance", todayKey: "2026-10-08", existing: plan });
    expect(writes.some((w) => w.table === "client_goals")).toBe(false);
    expect(src("./phase-switch.ts")).not.toContain("client_goals");
    expect(src("../components/coach/nutrition/phase-review-card.tsx")).not.toMatch(/client_goals|proposePhaseMove/);
    // the maintenance move clears the tag, as setting the phase by hand does
    expect(writes.some((w) => w.table === "nutrition_phases" && w.op === "delete")).toBe(true);
  });
  it("reports a failed write", async () => {
    expect((await switchToPlannedPhase(fakeDb({ failTable: "client_phase_plans" }).db, { athleteId: "a1", groupId: "g1", coachId: "c1", phase: "maintenance", todayKey: "2026-10-08", existing: plan })).ok).toBe(false);
  });
  it("tells the client one plain line with no phase words", () => {
    expect(NEW_BLOCK_NOTICE.body).toBe("Your coach started a new training block with you.");
    expect(`${NEW_BLOCK_NOTICE.title} ${NEW_BLOCK_NOTICE.body}`).not.toMatch(/phase|reverse|deficit|cut|bulk|maintenance|calorie/i);
  });
});

describe("the starting target is prepared for the coach, never applied", () => {
  const outcome: BaselineResult = { ok: true, calories: 2400, proteinG: 180, carbsG: 250, fatG: 70, phase: "reverse_diet", maintenance: 2500, bmr: 1800, floor: 1500, belowFloor: false, rationale: "Worked out from their numbers." } as BaselineResult;
  it("saves it as a PENDING baseline suggestion, the same row the Starting target card makes", async () => {
    const { db, writes } = fakeDb();
    expect((await createBaselineSuggestion(db, { athleteId: "a1", groupId: "g1", outcome, archetype: "standard" })).ok).toBe(true);
    expect(writes[0].table).toBe("nutrition_checkin_suggestions");
    expect(writes[0].row).toMatchObject({ athlete_id: "a1", status: "pending", kind: "baseline", phase: "reverse_diet", new_calories: 2400, below_floor: false });
    // nothing here touches the standing target or the plan's meals
    expect(writes.some((w) => w.table === "client_macro_target_history" || w.table === "daily_macros")).toBe(false);
  });
  it("the Starting target card and the phase move share this one writer", () => {
    expect(src("../components/coach/nutrition/baseline-prompt.tsx")).toContain("createBaselineSuggestion(");
    expect(src("../components/coach/nutrition/phase-review-card.tsx")).toContain("createBaselineSuggestion(");
  });
});

describe("answering a review only moves a date", () => {
  it("keeping going marks the review done and sets the next date; extending only moves the date", async () => {
    const keep = fakeDb();
    await setReviewDate(keep.db, { athleteId: "a1", groupId: "g1", coachId: "c1", reviewOn: "2026-10-22", markReviewed: true, todayKey: "2026-10-08" });
    expect(keep.writes[0].row).toMatchObject({ review_on: "2026-10-22", last_reviewed_at: "2026-10-08T12:00:00Z", updated_by: "c1" });
    const extend = fakeDb();
    await setReviewDate(extend.db, { athleteId: "a1", groupId: "g1", coachId: "c1", reviewOn: "2026-10-15", markReviewed: false, todayKey: "2026-10-08" });
    expect(extend.writes[0].row).not.toHaveProperty("last_reviewed_at");
    for (const key of ["phase", "started_on", "planned_next_phase"]) expect(keep.writes[0].row).not.toHaveProperty(key);
  });
});

describe("a date never changes a phase", () => {
  it("the weekly job only READS the plan: it never writes client_phase_plans or the phase tag", () => {
    const cron = src("../app/api/cron/nutrition-checkin-suggestions/route.ts");
    expect(cron).toContain('.from("client_phase_plans")');
    expect(cron).not.toMatch(/client_phase_plans"\)\s*\.(insert|update|upsert|delete)/);
    expect(cron).not.toMatch(/nutrition_phases"\)\s*\.(insert|update|upsert|delete)/);
  });
  it("the review card only appears when the review date has come, and the page shows it without changing anything", () => {
    const page = src("../components/coach/nutrition/client-nutrition.tsx");
    expect(page).toContain("phasePlan && reviewIsDue(phasePlan, todayKey)");
    expect(page).toContain("{reviewCard && <PhaseReviewCard {...reviewCard} />}");
  });
});

describe("a suggestion left over from the old phase", () => {
  it("is set aside (dismissed) before the new phase's target is prepared: every pending suggestion of this client whose phase differs, either kind", async () => {
    const { dismissPendingBaselines } = await import("@/lib/baseline-suggestion");
    const seen: { patch: Record<string, unknown>; filters: [string, unknown][] }[] = [];
    const db = {
      from: () => ({
        update(patch: Record<string, unknown>) {
          const filters: [string, unknown][] = [];
          const chain: Record<string, unknown> = {
            eq: (c: string, v: unknown) => {
              filters.push([c, v]);
              return chain;
            },
            neq: (c: string, v: unknown) => {
              filters.push([`not ${c}`, v]);
              seen.push({ patch, filters });
              return Promise.resolve({ error: null });
            },
          };
          return chain;
        },
      }),
    } as unknown as SupabaseClient;
    expect((await dismissPendingBaselines(db, { athleteId: "a1", groupId: "g1", newPhase: "cut" })).ok).toBe(true);
    expect(seen[0].patch).toEqual({ status: "dismissed" });
    expect(seen[0].filters).toEqual([
      ["athlete_id", "a1"],
      ["group_id", "g1"],
      ["status", "pending"],
      ["not phase", "cut"],
    ]);
    // both kinds: no filter on kind
    expect(seen[0].filters.some(([c]) => c === "kind")).toBe(false);
  });
  it("the card sets the old one aside first, keeps a matching one, and says plainly when the new one could not be prepared", () => {
    const card = src("../components/coach/nutrition/phase-review-card.tsx");
    expect(card.indexOf("dismissPendingBaselines(supabase")).toBeGreaterThan(-1);
    expect(card.indexOf("dismissPendingBaselines(supabase")).toBeLessThan(card.indexOf("createBaselineSuggestion(supabase"));
    expect(card).toContain("newPhase: p.next");
    // dismissed on every move, even when no starting target is being prepared
    expect(card.indexOf("dismissPendingBaselines(supabase")).toBeLessThan(card.indexOf("if (!p.nextBaseline)"));
    expect(card).toContain("p.pendingBaselinePhase === p.next");
    expect(card).toContain("The phase was started, but the starting target could not be prepared");
    // the About-you line is only for a start target that cannot be worked out, not for a failed save
    expect(card.indexOf("Add what's missing in About you")).toBeLessThan(card.indexOf("The phase was started, but"));
  });
});
