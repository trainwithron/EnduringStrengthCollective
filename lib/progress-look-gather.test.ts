import { describe, it, expect } from "vitest";
import { gatherProgressLook, minTargetReps } from "./progress-look-gather";
import { APPLIED_PREFIX, DELIBERATE_PREFIX } from "./progress-look";

const NOW = new Date("2026-10-06T18:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86400000).toISOString();

// A stand-in for the database: each table answers with the rows the test gives it, for any filter; set_logs honours the page range.
function fakeDb(tables: Record<string, any[]>) {
  return {
    from(table: string) {
      let range: [number, number] | null = null;
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        gte: () => chain,
        order: () => chain,
        limit: () => chain,
        not: () => chain,
        or: () => chain,
        range: (a: number, b: number) => {
          range = [a, b];
          return chain;
        },
        maybeSingle: async () => ({ data: (tables[table] ?? [])[0] ?? null }),
        then: (resolve: any) => {
          const rows = tables[table];
          if (rows === undefined && table === "client_inactive") return resolve({ data: null, error: { message: "no table" } });
          const all = rows ?? [];
          resolve({ data: range ? all.slice(range[0], range[1] + 1) : all, error: null });
        },
      };
      return chain;
    },
  } as any;
}

interface World {
  weights?: number[];
  rpes?: (number | null)[];
  note?: string | null;
  title?: string;
  skipSet?: boolean;
  lastDaysAgo?: number;
}

// Sam trains "Tuesday lower" (program p1, day 1) once a week; Back Squat is a tier A main lift.
function world(w: World = {}, extra: Record<string, any[]> = {}) {
  const weights = w.weights ?? [225, 225, 225, 225];
  const lastAgo = w.lastDaysAgo ?? 2;
  const sets: any[] = [];
  const workouts: any[] = [];
  weights.forEach((weight, i) => {
    const completed = daysAgo(lastAgo + (weights.length - 1 - i) * 7);
    workouts.push({ id: `w${i + 1}`, program_id: "p1", week_number: i + 1, day_index: 1, title: w.title ?? "Tuesday lower" });
    const session = { id: `s${i + 1}`, athlete_id: "sam", group_id: "g1", workout_id: `w${i + 1}`, status: "completed", completed_at: completed };
    for (let k = 0; k < 3; k++) {
      sets.push({
        set_order: k,
        weight,
        reps: 5,
        rpe: w.rpes ? w.rpes[i] : null,
        status: w.skipSet && i === weights.length - 1 && k === 2 ? "skipped" : "completed",
        session_exercises: {
          id: `e${i}`,
          exercise_name: "Back Squat",
          group_workout_exercise_id: `x${i}`,
          athlete_note: i === weights.length - 1 ? w.note ?? null : null,
          athlete_sessions: session,
        },
      });
    }
  });
  workouts.push({ id: `w${weights.length + 1}`, program_id: "p1", week_number: weights.length + 1, day_index: 1, title: w.title ?? "Tuesday lower" });
  return fakeDb({
    spotter_recommendation_feedback: [],
    group_memberships: [{ group_id: "g1", profile_id: "sam", profiles: { full_name: "Sam Lee" } }],
    set_logs: sets,
    workouts,
    programs: [{ id: "p1", name: "Strength block", athlete_id: "sam" }],
    group_workout_exercise_sets: [],
    movement_pattern_exercises: [
      { exercise_name: "Back Squat", tier: "A", difficulty_rank: 2, movement_pattern_id: "m1" },
      { exercise_name: "Goblet Squat", tier: "C", difficulty_rank: 1, movement_pattern_id: "m1" },
      { exercise_name: "Front Squat", tier: "A", difficulty_rank: 3, movement_pattern_id: "m1" },
    ],
    nutrition_checkins: [],
    group_workout_exercises: [
      {
        id: "next-sq",
        workout_id: `w${weights.length + 1}`,
        exercise_name: "Back Squat",
        notes: "Brace.",
        group_workout_exercise_sets: [
          { id: "n1", set_order: 0, target_weight: 225, target_reps: "5" },
          { id: "n2", set_order: 1, target_weight: 225, target_reps: "5" },
        ],
      },
    ],
    ...extra,
  });
}
const run = (db: any) => gatherProgressLook(db, { coachId: "coach", groupIds: ["g1"], now: NOW });

describe("the progress look gather", () => {
  it("makes one card for a client whose main lift sat at the same load and reps for four weeks, with where to apply a change", async () => {
    const r = await run(world());
    expect(r.cards).toHaveLength(1);
    const c = r.cards[0];
    expect(c).toMatchObject({ kind: "main", clientName: "Sam Lee", title: "Tuesday lower", programIsPersonal: true });
    expect(c.flagged[0]).toMatchObject({ exerciseName: "Back Squat", sessions: 4, weight: 225, reps: 5 });
    expect(c.nextSlotByExercise["Back Squat"]?.exerciseId).toBe("next-sq");
    expect(c.nextSlotByExercise["Back Squat"]?.sets).toHaveLength(2);
    expect(c.harderByExercise["Back Squat"]).toBe("Front Squat");
    expect(c.key).toContain("progress::sam::g1::p1::1::main");
    expect(r.threshold).toBe(3);
  });

  it("a shared program is not treated as the client's own", async () => {
    const r = await run(world({}, { programs: [{ id: "p1", name: "Group program", athlete_id: null }] }));
    expect(r.cards[0].programIsPersonal).toBe(false);
  });

  it("shows nothing for a client who is moving", async () => {
    expect((await run(world({ weights: [205, 215, 225, 235] }))).cards).toEqual([]);
  });

  it("suppresses: a pain note in the last two weeks", async () => {
    expect((await run(world({ note: "my left knee hurt on the way up" }))).cards).toEqual([]);
  });
  it("suppresses: a deload workout, and a deliberate deficit phase", async () => {
    expect((await run(world({ title: "Week 4 deload" }))).cards).toEqual([]);
    expect((await run(world({}, { nutrition_checkins: [{ athlete_id: "sam", phase: "fat_loss", created_at: daysAgo(10) }] }))).cards).toEqual([]);
  });
  it("suppresses: a client who has not trained in 21 days", async () => {
    expect((await run(world({ lastDaysAgo: 30 }))).cards).toEqual([]);
  });
  it("suppresses: a client set aside as inactive", async () => {
    expect((await run(world({}, { client_inactive: [{ group_id: "g1", athlete_id: "sam" }] }))).cards).toEqual([]);
  });
  it("suppresses: a missed set (information, not a reason to ask)", async () => {
    expect((await run(world({ skipSet: true }))).cards).toEqual([]);
  });
  it("suppresses: a program that is already raising the weight next time", async () => {
    const raising = {
      group_workout_exercises: [
        { id: "next-sq", workout_id: "w5", exercise_name: "Back Squat", notes: null, group_workout_exercise_sets: [{ id: "n1", set_order: 0, target_weight: 230, target_reps: "5" }] },
      ],
    };
    expect((await run(world({}, raising))).cards).toEqual([]);
  });
  it("suppresses: effort that is climbing at the same load", async () => {
    expect((await run(world({ rpes: [7, 8, 8.5, 9] }))).cards).toEqual([]);
  });

  it("a client who logs no effort is never skipped; falling effort is named as getting stronger", async () => {
    expect((await run(world({ rpes: [null, null, null, null] }))).cards).toHaveLength(1);
    expect((await run(world({ rpes: [8, 7, 7, 6.5] }))).cards[0].flagged[0].effort).toBe("falling");
  });

  it("uses the coach's own answers: deliberate keeps it away for 6 weeks, applying gives it 2 weeks, and the threshold follows", async () => {
    const key = "progress::sam::g1::p1::1::main";
    const held = await run(world({}, { spotter_recommendation_feedback: [{ dismissal_key: DELIBERATE_PREFIX + key, action: "confirmed", edit_detail: null, created_at: daysAgo(3) }] }));
    expect(held.cards).toEqual([]);
    expect(held.threshold).toBe(4);
    const applied = await run(world({}, { spotter_recommendation_feedback: [{ dismissal_key: APPLIED_PREFIX + key, action: "confirmed", edit_detail: "+5", created_at: daysAgo(20) }] }));
    expect(applied.cards).toHaveLength(1);
  });

  it("a higher threshold asks later: four same-load sessions are not enough at 5", async () => {
    const r = await run(world({}, { spotter_recommendation_feedback: [{ dismissal_key: "progress-threshold", action: "edited", edit_detail: "5", created_at: daysAgo(30) }] }));
    expect(r.threshold).toBe(5);
    expect(r.cards).toEqual([]);
  });

  it("returns nothing when the coach has no groups or no clients", async () => {
    expect((await gatherProgressLook(world(), { coachId: "coach", groupIds: [], now: NOW })).cards).toEqual([]);
    expect((await run(world({}, { group_memberships: [] }))).cards).toEqual([]);
  });
});

describe("rep targets", () => {
  it("reads the lowest number in a target", () => {
    expect(minTargetReps("8")).toBe(8);
    expect(minTargetReps("8-10")).toBe(8);
    expect(minTargetReps("AMRAP")).toBeNull();
    expect(minTargetReps(null)).toBeNull();
  });
});
