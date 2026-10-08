import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { moveState, proposePhaseMove, PHASE_GOAL_LABEL, type PhaseGoalRow } from "@/lib/phase-move";
import { setReviewDate } from "@/lib/phase-plan-write";
import type { PhasePlan } from "@/lib/phase-plan";

const src = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8").split(String.fromCharCode(13, 10)).join(String.fromCharCode(10));

// A stand-in for the few calls these functions make.
function fakeDb(opts: { open?: unknown[]; readError?: boolean; insertError?: boolean }) {
  const inserted: Record<string, unknown>[] = [];
  const updated: { table: string; patch: Record<string, unknown>; filters: [string, unknown][] }[] = [];
  const db = {
    from(table: string) {
      return {
        select() {
          const chain: Record<string, unknown> = { eq: () => chain, limit: () => Promise.resolve({ data: opts.open ?? [], error: opts.readError ? { message: "x" } : null }) };
          return chain;
        },
        insert(row: Record<string, unknown>) {
          inserted.push(row);
          return Promise.resolve({ error: opts.insertError ? { message: "x" } : null });
        },
        update(patch: Record<string, unknown>) {
          const filters: [string, unknown][] = [];
          const chain: Record<string, unknown> = {
            eq: (c: string, v: unknown) => {
              filters.push([c, v]);
              if (filters.length === 2) {
                updated.push({ table, patch, filters });
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
  return { db: db as unknown as SupabaseClient, inserted, updated };
}

describe("suggesting the planned phase goes through the goals flow", () => {
  it("makes a coach-suggested custom goal that carries the phase, written by the coach", async () => {
    const { db, inserted } = fakeDb({});
    const r = await proposePhaseMove(db, { athleteId: "a1", groupId: "g1", coachId: "c1", phase: "reverse_diet" });
    expect(r).toEqual({ ok: true, already: false });
    expect(inserted).toEqual([{ athlete_id: "a1", group_id: "g1", goal_type: "custom", custom_label: "Rebuild: reverse diet", nutrition_phase: "reverse_diet", created_by: "c1" }]);
    expect(PHASE_GOAL_LABEL.maintenance).toBe("Next step: maintenance");
  });
  it("asking twice does not stack a second open suggestion", async () => {
    const { db, inserted } = fakeDb({ open: [{ id: "goal1" }] });
    expect(await proposePhaseMove(db, { athleteId: "a1", groupId: "g1", coachId: "c1", phase: "reverse_diet" })).toEqual({ ok: true, already: true });
    expect(inserted).toHaveLength(0);
  });
  it("reports a failed read or write instead of pretending it worked", async () => {
    expect((await proposePhaseMove(fakeDb({ readError: true }).db, { athleteId: "a1", groupId: "g1", coachId: "c1", phase: "maintenance" })).ok).toBe(false);
    expect((await proposePhaseMove(fakeDb({ insertError: true }).db, { athleteId: "a1", groupId: "g1", coachId: "c1", phase: "maintenance" })).ok).toBe(false);
  });
  it("never writes the phase of record itself: only the client's confirmation does (a database trigger)", () => {
    const text = src("./phase-move.ts");
    expect(text).not.toContain("client_phase_plans");
    expect(text).not.toContain("nutrition_phases");
  });
});

describe("where the suggestion stands", () => {
  const plan: PhasePlan = { phase: "fat_loss", startedOn: "2026-09-10", reviewOn: "2026-10-08", plannedNextPhase: "reverse_diet", lastReviewedAt: null };
  const goal = (over: Partial<PhaseGoalRow> = {}): PhaseGoalRow => ({ status: "proposed", created_by: "c1", athlete_id: "a1", nutrition_phase: "reverse_diet", created_at: "2026-10-08T10:00:00Z", ...over });
  it("waiting while the client has not answered; declined once they said not now", () => {
    expect(moveState([goal()], plan)).toBe("waiting");
    expect(moveState([goal({ status: "declined" })], plan)).toBe("declined");
    expect(moveState([], plan)).toBe("none");
  });
  it("the newest suggestion decides", () => {
    expect(moveState([goal({ status: "declined", created_at: "2026-10-01T10:00:00Z" }), goal({ created_at: "2026-10-08T10:00:00Z" })], plan)).toBe("waiting");
  });
  it("ignores a goal the client wrote, an old one from before this phase, another phase, and one already confirmed", () => {
    expect(moveState([goal({ created_by: "a1" })], plan)).toBe("none");
    expect(moveState([goal({ created_at: "2026-09-01T10:00:00Z" })], plan)).toBe("none");
    expect(moveState([goal({ nutrition_phase: "maintenance" })], plan)).toBe("none");
    expect(moveState([goal({ status: "confirmed" })], plan)).toBe("none");
    expect(moveState([goal()], { ...plan, plannedNextPhase: null })).toBe("none");
  });
});

describe("answering a review only moves a date", () => {
  it("keeping going marks the review done and sets the next date; extending only moves the date", async () => {
    const keep = fakeDb({});
    await setReviewDate(keep.db, { athleteId: "a1", groupId: "g1", coachId: "c1", reviewOn: "2026-10-22", markReviewed: true, todayKey: "2026-10-08" });
    expect(keep.updated[0].table).toBe("client_phase_plans");
    expect(keep.updated[0].patch).toMatchObject({ review_on: "2026-10-22", last_reviewed_at: "2026-10-08T12:00:00Z", updated_by: "c1" });
    const extend = fakeDb({});
    await setReviewDate(extend.db, { athleteId: "a1", groupId: "g1", coachId: "c1", reviewOn: "2026-10-15", markReviewed: false, todayKey: "2026-10-08" });
    expect(extend.updated[0].patch).not.toHaveProperty("last_reviewed_at");
  });
  it("never touches the phase, when it started, or the planned next phase", async () => {
    const t = fakeDb({});
    await setReviewDate(t.db, { athleteId: "a1", groupId: "g1", coachId: "c1", reviewOn: "2026-10-22", markReviewed: true, todayKey: "2026-10-08" });
    for (const key of ["phase", "started_on", "planned_next_phase"]) expect(t.updated[0].patch).not.toHaveProperty(key);
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
