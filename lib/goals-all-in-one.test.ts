import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EMPTY_GOAL_SHEET, type GoalSheetRow } from "@/lib/goal-sheet";
import {
  cleanMainGoal,
  cleanNewSubGoals,
  foodLoggedDays,
  goalSheetAnsweredCount,
  goalSheetSummary,
  goalsCardPill,
  goalsCardState,
  goalsSentNotice,
  mainGoalLine,
  sameMainGoal,
} from "@/lib/goals-all-in-one";

// Goals, all in one (Ron, Nov 23: "send a client the full goals ... linked with the goal sheet, like all in one").
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

// ---- an in-memory stand-in for the database, shared by the caller's client and the server's, with the two goal notices the database itself makes (step 0284) ----
type Row = Record<string, any>;
const store: { tables: Record<string, Row[]>; pushes: string[] } = { tables: {}, pushes: [] };
let seq = 0;
const now = () => new Date(Date.now() + seq++).toISOString();
function dbNotices(table: string, op: "insert" | "update", row: Row, before?: Row) {
  if (table !== "client_goals") return;
  const n = store.tables.notifications;
  if (op === "insert" && row.status === "proposed" && row.created_by !== row.athlete_id) n.push({ id: `n${seq++}`, profile_id: row.athlete_id, group_id: row.group_id, type: "goal_proposed", body: "Your coach suggested a goal: X", created_at: now() });
  if (op === "update" && before?.status === "proposed" && row.status === "confirmed")
    for (const c of store.tables.group_memberships.filter((m) => m.group_id === row.group_id && m.role === "coach")) n.push({ id: `n${seq++}`, profile_id: c.profile_id, group_id: row.group_id, type: "goal_answered", body: "Robyn confirmed the goal: X", created_at: now() });
}
function from(table: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let op: "select" | "insert" | "update" | "upsert" = "select";
  let payload: any = null;
  let limit = Infinity;
  const rows = () => (store.tables[table] ??= []);
  const run = () => {
    if (op === "insert") {
      for (const p of Array.isArray(payload) ? payload : [payload]) {
        const row = { id: `${table}-${seq++}`, status: table === "client_goals" ? "proposed" : p.status, created_at: now(), ...p };
        rows().push(row);
        dbNotices(table, "insert", row);
      }
      return { data: null, error: null };
    }
    if (op === "update") {
      for (const r of rows().filter((x) => filters.every((f) => f(x)))) {
        const before = { ...r };
        Object.assign(r, payload);
        dbNotices(table, "update", r, before);
      }
      return { data: null, error: null };
    }
    if (op === "upsert") {
      const hit = rows().find((r) => r.athlete_id === payload.athlete_id && r.group_id === payload.group_id);
      if (hit) Object.assign(hit, payload);
      else rows().push({ ...payload });
      return { data: null, error: null };
    }
    // copies, as a real database returns (a row read before a write keeps what it said)
    return { data: rows().filter((r) => filters.every((f) => f(r))).slice(0, limit).map((r) => ({ ...r })), error: null };
  };
  const b: any = {
    select: () => b,
    eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), b),
    gte: (k: string, v: string) => (filters.push((r) => String(r[k]) >= v), b),
    order: () => b,
    limit: (n: number) => ((limit = n), b),
    insert: (p: any) => ((op = "insert"), (payload = p), b),
    update: (p: any) => ((op = "update"), (payload = p), b),
    upsert: (p: any) => ((op = "upsert"), (payload = p), b),
    maybeSingle: async () => {
      const r = run();
      // newest first, as the routes ask
      const list = (r.data ?? []).slice().sort((x: Row, y: Row) => String(y.created_at ?? "").localeCompare(String(x.created_at ?? "")));
      return { data: list[0] ?? null, error: null };
    },
    then: (res: (v: any) => void, rej: (e: any) => void) => Promise.resolve(run()).then(res, rej),
  };
  return b;
}
let caller = "coach-1";
let role: "coach" | "client" = "coach";
vi.mock("@/lib/supabase/server", () => ({ createServerClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: caller } } }) }, from }) }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({ from }) }));
vi.mock("@/lib/rate-limit", () => ({ rateLimitResponse: async () => null }));
vi.mock("@/lib/goal-sheet-server", () => ({ goalSheetActor: async () => ({ role }) }));
vi.mock("@/lib/send-push", () => ({ sendPushToProfile: async (_db: unknown, id: string, title: string) => (store.pushes.push(`${id}: ${title}`), 1) }));
vi.mock("@/lib/coach-notice", () => ({ sendCoachPush: async (_db: unknown, id: string, _k: string, title: string) => (store.pushes.push(`${id}: ${title}`), 1) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/lib/supabase/client", () => ({ createBrowserClient: () => ({}) }));

const G = "11111111-1111-4111-8111-111111111111";
const A = "22222222-2222-4222-8222-222222222222";
const post = (body: object) => new Request("http://x/api", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => {
  seq = 0;
  store.pushes = [];
  store.tables = {
    notifications: [],
    client_goals: [],
    client_sub_goals: [],
    client_goal_sheets: [],
    group_memberships: [{ group_id: G, profile_id: "coach-1", role: "coach" }, { group_id: G, profile_id: A, role: "athlete" }],
    profiles: [{ id: "coach-1", full_name: "Ron Arnold" }, { id: A, full_name: "Robyn Smith" }],
  };
});
const noticesFor = (id: string) => store.tables.notifications.filter((n) => n.profile_id === id);

describe("one send = ONE notice to the client (bell + push), straight to the one goals page", () => {
  it("without a suggested goal: one bell, one push, the sheet marked sent", async () => {
    caller = "coach-1";
    role = "coach";
    const { POST } = await import("@/app/api/goal-sheet/send/route");
    expect((await POST(post({ groupId: G, athleteId: A }))).status).toBe(200);
    expect(noticesFor(A)).toHaveLength(1);
    expect(noticesFor(A)[0]).toMatchObject({ type: "goal_proposed", body: "Your goals: Ron sent your goals to fill in.", link_path: `/groups/${G}/goal?edit=1` });
    expect(store.pushes).toEqual([`${A}: Your goals`]);
    expect(store.tables.client_goal_sheets[0]).toMatchObject({ requested_by: "coach-1" });
  });
  it("with a suggested main goal: the database's own 'suggested a goal' bell becomes the one notice (never two)", async () => {
    caller = "coach-1";
    role = "coach";
    const { POST } = await import("@/app/api/goal-sheet/send/route");
    await POST(post({ groupId: G, athleteId: A, suggestion: { goalType: "weight_loss", targetDate: "2027-03-01" } }));
    expect(store.tables.client_goals).toHaveLength(1);
    expect(store.tables.client_goals[0]).toMatchObject({ goal_type: "weight_loss", target_date: "2027-03-01", created_by: "coach-1", status: "proposed" });
    expect(noticesFor(A)).toHaveLength(1);
    expect(noticesFor(A)[0].body).toBe("Your goals: Ron sent your goals to fill in.");
    expect(store.pushes).toHaveLength(1);
  });
  it("no second suggestion while a goal is being agreed; remind sends the notice again and keeps the sent date", async () => {
    caller = "coach-1";
    role = "coach";
    const { POST } = await import("@/app/api/goal-sheet/send/route");
    await POST(post({ groupId: G, athleteId: A, suggestion: { goalType: "weight_loss" } }));
    await POST(post({ groupId: G, athleteId: A, suggestion: { goalType: "muscle_gain" } }));
    expect(store.tables.client_goals).toHaveLength(1);
    const sentAt = store.tables.client_goal_sheets[0].requested_at;
    await new Promise((r) => setTimeout(r, 5));
    await POST(post({ groupId: G, athleteId: A, remind: true }));
    expect(sentAt).toBeTruthy();
    expect(store.tables.client_goal_sheets[0].requested_at).toBe(sentAt);
    // the send again (without a new suggestion: one is being agreed) and the reminder: one notice each
    expect(noticesFor(A)).toHaveLength(3);
  });
  it("only a coach may send", () => {
    expect(read("app/api/goal-sheet/send/route.ts")).toContain('if (actor?.role !== "coach") return NextResponse.json({ error: "Not found." }, { status: 404 });');
  });
});

describe("one save writes the goal, the smaller goals and the sheet; the coach who sent it gets ONE notice", () => {
  it("the client keeps the coach's suggestion (that confirms it), adds a smaller goal and answers the sheet", async () => {
    caller = "coach-1";
    role = "coach";
    const send = (await import("@/app/api/goal-sheet/send/route")).POST;
    await send(post({ groupId: G, athleteId: A, suggestion: { goalType: "weight_loss", targetDate: "2027-03-01" } }));
    caller = A;
    role = "client";
    const { POST } = await import("@/app/api/goals/route");
    await new Promise((r) => setTimeout(r, 5));
    const res = await POST(
      post({
        groupId: G,
        athleteId: A,
        goal: { goalType: "weight_loss", targetDate: "2027-03-01" },
        subGoals: ["Walk 8,000 steps a day", "", "walk 8,000 steps a day", "Protein at every meal"],
        answers: { ...EMPTY_GOAL_SHEET, why_matters: "Keep up with my kids", want_score: 9, days_per_week: 3 },
      })
    );
    expect(res.status).toBe(200);
    expect(store.tables.client_goals).toHaveLength(1);
    expect(store.tables.client_goals[0].status).toBe("confirmed");
    expect(store.tables.client_sub_goals.map((s) => s.title)).toEqual(["Walk 8,000 steps a day", "Protein at every meal"]);
    expect(store.tables.client_sub_goals.every((s) => s.proposed_by === A)).toBe(true);
    expect(store.tables.client_goal_sheets[0]).toMatchObject({ why_matters: "Keep up with my kids", want_score: 9, days_per_week: 3, filled_by: A });
    expect(noticesFor("coach-1")).toHaveLength(1);
    expect(noticesFor("coach-1")[0].body).toMatch(/^Robyn Smith filled in their goals\./);
    expect(store.pushes.filter((p) => p.startsWith("coach-1"))).toEqual(["coach-1: Robyn Smith filled in their goals"]);
  });
  it("a changed goal goes back to the coach; a goal the client chooses is proposed by them", async () => {
    caller = A;
    role = "client";
    const { POST } = await import("@/app/api/goals/route");
    await POST(post({ groupId: G, athleteId: A, goal: { goalType: "muscle_gain" }, subGoals: [], answers: {} }));
    expect(store.tables.client_goals).toEqual([expect.objectContaining({ goal_type: "muscle_gain", created_by: A, status: "proposed" })]);
    // the same again changes nothing
    await POST(post({ groupId: G, athleteId: A, goal: { goalType: "muscle_gain" }, subGoals: [], answers: {} }));
    expect(store.tables.client_goals).toHaveLength(1);
    // an empty sheet is not saved as filled in
    expect(store.tables.client_goal_sheets).toHaveLength(0);
  });
  it("the routes check who is asking and save through the caller's own rules", () => {
    const src = read("app/api/goals/route.ts");
    expect(src).toContain("goalSheetActor(supabase, db, user.id, body.groupId, body.athleteId)");
    expect(src).toContain('await supabase.from("client_goals").insert(');
    expect(src).toContain('await supabase.from("client_sub_goals").insert(');
    expect(read("lib/workspace-mutation.ts")).toContain("|goal-sheet|goals|");
  });
});

describe("the Goals card", () => {
  const base: GoalSheetRow = { ...EMPTY_GOAL_SHEET, filled_by: null, filled_at: null, requested_by: null, requested_at: null };
  const sent: GoalSheetRow = { ...base, requested_by: "coach-1", requested_at: "2026-11-23T15:00:00Z" };
  const done: GoalSheetRow = { ...sent, why_matters: "Kids", success_90_days: "Down 15 lb", obstacles: "Late shifts", days_per_week: 3, want_score: 9, work_willing: "Hard", food_day_1: "Eggs", filled_by: A, filled_at: "2026-11-24T15:00:00Z" };
  it("one status: Not started / Sent · waiting / Filled in", () => {
    expect(goalsCardState(null)).toBe("new");
    expect(goalsCardState(sent)).toBe("sent");
    expect(goalsCardState(done)).toBe("done");
    expect(goalsCardPill("new", null, "Robyn")).toBe("Not started");
    expect(goalsCardPill("sent", sent, "Robyn", "UTC")).toBe("Sent Nov 23 · waiting on Robyn");
    expect(goalsCardPill("done", done, "Robyn", "UTC")).toBe("Filled in Nov 24");
    // sent again after it was filled in: waiting again
    expect(goalsCardState({ ...done, requested_at: "2026-11-25T15:00:00Z" })).toBe("sent");
  });
  it("the rows: the main goal with who it waits on, the sheet in one line", () => {
    expect(mainGoalLine({ goal_type: "weight_loss", custom_label: null, target_date: "2027-03-01", status: "proposed", created_by: "coach-1" }, A, "Robyn")).toEqual({ text: "Weight loss, by Mar 1, 2027", note: "you suggested; Robyn confirms" });
    expect(mainGoalLine({ goal_type: "custom", custom_label: "Run a 5k", target_date: null, status: "confirmed", created_by: A }, A, "Robyn")).toEqual({ text: "Run a 5k", note: null });
    expect(mainGoalLine({ goal_type: "muscle_gain", custom_label: null, target_date: null, status: "declined", created_by: A }, A, "Robyn")).toBeNull();
    expect(goalSheetSummary(done)).toBe("All 7 answered · wants it 9/10 · 3 days a week");
    expect(goalSheetAnsweredCount({ ...EMPTY_GOAL_SHEET, want_why: "x", food_day_3: "y" })).toBe(2);
  });
  it("on screen: the buttons by state, the answers folded, 'Not filled in' never twice", async () => {
    const { GoalsCard } = await import("@/components/coach/goals-card");
    const card = (sheet: GoalSheetRow | null) =>
      renderToStaticMarkup(createElement(GoalsCard, { groupId: G, athleteId: A, viewerId: "coach-1", clientFirstName: "Robyn", timeZone: "UTC", sheet, goal: null, subGoals: [] }));
    const n = card(null);
    expect(n).toContain("Not started");
    expect(n).toContain("Send to Robyn");
    expect(n).toContain("Fill in with Robyn");
    expect(n.match(/Not filled in/g)?.length ?? 0).toBeLessThanOrEqual(1);
    const s = card(sent);
    expect(s).toContain("Remind Robyn");
    expect(s).toContain("Fill in with Robyn");
    expect(s).toContain("Robyn fills this in");
    const d = card(done);
    expect(d).toContain("Edit");
    expect(d).toContain("Send again (redo)");
    expect(d).toContain("Read Robyn&#x27;s answers");
    expect(d).toContain("All 7 answered · wants it 9/10 · 3 days a week");
    expect(d).not.toContain("Not filled in");
  });
  it("keeps the confirm / decline of a goal the client proposed inside the card", () => {
    const page = read("app/(coach)/groups/[groupId]/athletes/[athleteId]/page.tsx");
    expect(page.indexOf("<GoalsCard")).toBeLessThan(page.indexOf("<GoalConfirmationControl"));
    expect(page).toContain("goalControl={");
  });
});

describe("the client's one page", () => {
  it("a goal the coach suggested is already filled in, theirs to change", async () => {
    const { GoalsForm } = await import("@/components/shared/goals-form");
    const html = renderToStaticMarkup(
      createElement(GoalsForm, {
        groupId: G,
        athleteId: A,
        viewer: "client",
        viewerId: A,
        otherFirstName: "Ron",
        goal: { id: "g1", goalType: "weight_loss", customLabel: null, targetDate: "2027-03-01", eventType: null, eventPriority: null, weightClassFlag: false, status: "proposed", createdBy: "coach-1" },
        subGoals: [],
        sheet: EMPTY_GOAL_SHEET,
      })
    );
    expect(html).toMatch(/<option value="weight_loss" selected="">Weight loss<\/option>/);
    expect(html).toContain('value="2027-03-01"');
    expect(html).toContain("Ron suggested this. Change it if it isn&#x27;t right.");
    // main goal, then smaller goals, then Ron's questions (his wording), one button
    for (const [a, b] of [["Main goal", "Smaller goals"], ["Smaller goals", "About you"], ["About you", "Why does this goal matter to you?"], ["The last 3 days of eating", "Send to Ron"]]) expect(html.indexOf(a)).toBeLessThan(html.indexOf(b));
    expect(html.match(/Send to Ron/g)).toHaveLength(1);
    expect(html).toContain("+ Add another");
  });
  it("the Home prompt says Fill in your goals and opens this page", () => {
    const card = read("components/athlete/goal-sheet-prompt-card.tsx");
    expect(card).toContain("Fill in your goals");
    expect(card).toContain("/goal#goal-sheet");
  });
});

describe("cleaning what the page sends", () => {
  it("a main goal: a known type, words for a custom one, a real date, the event fields only where they belong", () => {
    expect(cleanMainGoal({ goalType: "nope" })).toBeNull();
    expect(cleanMainGoal({ goalType: "custom", customLabel: "  " })).toBeNull();
    expect(cleanMainGoal({ goalType: "weight_loss", targetDate: "Mar 1", eventType: "Race" })).toEqual({ goalType: "weight_loss", customLabel: null, targetDate: null, eventType: null, eventPriority: null, weightClassFlag: false });
    expect(cleanMainGoal({ goalType: "endurance_event", targetDate: "2027-04-12", eventType: " Boston ", eventPriority: "A" })).toMatchObject({ eventType: "Boston", eventPriority: "A" });
    const g = cleanMainGoal({ goalType: "weight_loss", targetDate: "2027-03-01" })!;
    expect(sameMainGoal(g, { goal_type: "weight_loss", custom_label: null, target_date: "2027-03-01" })).toBe(true);
    expect(sameMainGoal(g, { goal_type: "weight_loss", custom_label: null, target_date: null })).toBe(false);
  });
  it("smaller goals: trimmed, no blanks or repeats (of each other or ones already there), at most 10", () => {
    expect(cleanNewSubGoals([" A ", "", "a", "B", 5], ["b"])).toEqual(["A"]);
    expect(cleanNewSubGoals(Array.from({ length: 15 }, (_, i) => `g${i}`))).toHaveLength(10);
    expect(cleanNewSubGoals("x")).toEqual([]);
  });
  it("the notice's words", () => {
    expect(goalsSentNotice("Ron")).toEqual({ title: "Your goals", body: "Ron sent your goals to fill in." });
    expect(goalsSentNotice(null).body).toBe("Your coach sent your goals to fill in.");
  });
});

describe("Food logged: X/7 days (replaces 'Macro targets set ... actual intake isn't logged yet')", () => {
  it("counts the days among the client's last 7 with at least one food entry", () => {
    expect(foodLoggedDays(["2026-11-23", "2026-11-23", "2026-11-20", "2026-11-17", "2026-11-16", "2026-11-24"], "2026-11-23")).toBe(3);
    expect(foodLoggedDays([], "2026-11-23")).toBe(0);
  });
  it("is on the client's page, in the client's time zone, and the old line and its comments are gone", () => {
    const page = read("app/(coach)/groups/[groupId]/athletes/[athleteId]/page.tsx");
    expect(page).toContain("Food logged: {foodLoggedCount}/7 days");
    expect(page).toContain("todayKeyInZone(clientZone)");
    expect(page).toContain('supabase.from("food_log_entries").select("log_date")');
    expect(page).not.toContain("Macro targets set");
    expect(page).not.toContain("nothing in this app logs");
  });
});
