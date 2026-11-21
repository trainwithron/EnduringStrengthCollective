import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: { id: "coach-1" } as { id: string } | null,
  tables: {} as Record<string, { data: any; error?: any }>,
  rpcCalls: [] as { name: string; args: any }[],
  rpcQueue: [] as { data: any; error: any }[],
  limited: false,
  aiOn: true,
  replies: [] as (string | Error)[],
  calls: [] as any[],
}));

function fakeDb() {
  return {
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    rpc: async (name: string, args: any) => {
      state.rpcCalls.push({ name, args });
      return state.rpcQueue.shift() ?? { data: null, error: null };
    },
    from(table: string) {
      let from = 0;
      let to = 999;
      let paged = false;
      const filters: ((row: any) => boolean)[] = [];
      const chain: any = {};
      for (const m of ["select", "eq", "order", "neq", "gte", "lte", "is", "limit"]) chain[m] = () => chain;
      chain.in = (col: string, vals: unknown[]) => {
        filters.push((row) => !(col in (row ?? {})) || vals.includes(row[col]));
        return chain;
      };
      chain.range = (f: number, t: number) => {
        from = f;
        to = t;
        paged = true;
        return chain;
      };
      const answer = () => {
        const t = state.tables[table] ?? { data: null };
        if (t.error) return { data: null, error: t.error };
        const rows = Array.isArray(t.data) ? t.data.filter((row: any) => filters.every((fn) => fn(row))) : t.data;
        return { data: paged && Array.isArray(rows) ? rows.slice(from, to + 1) : rows, error: null };
      };
      const first = () => {
        const a = answer();
        return { data: Array.isArray(a.data) ? (a.data[0] ?? null) : a.data, error: a.error };
      };
      chain.maybeSingle = async () => first();
      chain.single = async () => first();
      chain.then = (res: any, rej: any) => Promise.resolve(answer()).then(res, rej);
      return chain;
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({ createServerClient: async () => fakeDb() }));
vi.mock("@/lib/rate-limit", () => ({ rateLimitResponse: async () => (state.limited ? new Response(JSON.stringify({ error: "slow down" }), { status: 429 }) : null) }));
vi.mock("@/lib/timezone", async (original) => ({ ...(await original<typeof import("@/lib/timezone")>()), getGroupCoachTimezone: async () => "America/New_York" }));
vi.mock("@/lib/anthropic-client", async (original) => {
  const real = await original<typeof import("@/lib/anthropic-client")>();
  return {
    ...real,
    isAiConfigured: () => state.aiOn,
    callClaude: async (opts: any) => {
      state.calls.push(opts);
      const next = state.replies.shift();
      if (next instanceof Error) throw next;
      return next ?? "{}";
    },
  };
});

import { POST as photo } from "@/app/api/team-sheet/photo/route";
import { POST as save } from "@/app/api/team-sheet/save/route";
import { AiRateLimitedError } from "@/lib/ai-usage";
import { MAX_IMAGE_BASE64_CHARS } from "@/lib/anthropic-client";
import { dayLabel, makeRacks, type SheetExercise, type SheetModel } from "@/lib/team-sheet/sheet-model";
import { encodeSheetCode } from "@/lib/team-sheet/sheet-code";
import { rackCode } from "@/lib/team-sheet/export-pdf";
import { TEAM_SHEET_PHOTO_PROMPT, UNCLEAR_CELL } from "@/lib/team-sheet/photo-read";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const G = uuid(1);
const MON = uuid(50);
const ex = (n: number, name: string): SheetExercise => ({ id: uuid(100 + n), name, prescription: "3x5", sets: 3, reps: 5, unread: false });
const model = (groupId = G): SheetModel => ({
  groupId,
  groupName: "Varsity Football",
  mode: "day",
  unit: "lb",
  days: [{ date: "2026-10-19", label: dayLabel("2026-10-19"), title: "Lower A", exercises: [ex(1, "Back squat"), ex(2, "Bench press")] }],
  racks: makeRacks([{ id: uuid(11), fullName: "Ann Adams" }, { id: uuid(12), fullName: "Bo Brown" }], 4),
});
const gwe = (n: number, name: string, display: string | null = null) => ({ id: uuid(100 + n), workout_id: MON, exercise_name: name, display_name: display, tracked_fields: ["reps", "weight"], group_workout_exercise_sets: [1, 2, 3].map((i) => ({ set_order: i, target_reps: "5" })) });
function seed(over: Partial<Record<string, { data: any; error?: any }>> = {}) {
  state.tables = {
    group_memberships: { data: [{ role: "coach", profile_id: uuid(11), profiles: { full_name: "Ann Adams" } }, { role: "coach", profile_id: uuid(12), profiles: { full_name: "Bo Brown" } }] },
    group_workout_exercises: { data: [gwe(1, "Back squat"), gwe(2, "Bench press")] },
    workouts: { data: [{ id: MON, title: "Lower A" }] },
    athlete_sessions: { data: [] },
    ...over,
  } as any;
}
const codeText = (g = G) => encodeSheetCode(rackCode(model(g), model(g).racks[0]));
const IMG = "aGVsbG8=";
const req = (body: unknown) => new Request("https://app.test/api/team-sheet/photo", { method: "POST", headers: { "Content-Type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });
const one = (over: Record<string, unknown> = {}) => ({ groupId: G, photos: [{ imageBase64: IMG, mediaType: "image/jpeg", codeText: codeText(), ...over }] });
const b = (text: string, sure = true) => ({ text, sure });
// the model's reply for the printed page: rows in printed order (Adams, Brown), one smudged box
const reply = JSON.stringify({
  columns: ["Back squat", "Bench press"],
  rows: [
    { name: "Ann A.", cells: [[b("225x5"), b("235x5"), b("245x5")], [b("185x5")]], notes: b("") },
    { name: "Bo B.", cells: [[b("300x5")], [b("2?5", false)]], notes: b("") },
  ],
});

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-01T12:00:00Z"));
});
afterAll(() => vi.useRealTimers());
beforeEach(() => {
  state.user = { id: "coach-1" };
  state.limited = false;
  state.aiOn = true;
  state.replies = [];
  state.calls = [];
  state.rpcCalls = [];
  state.rpcQueue = [];
  seed();
});

describe("reading a photo of the printed team sheet", () => {
  it("a mocked model reply comes back as the same review an upload gets: the boxes where the code puts them, the unsure one as '?', nothing written", async () => {
    state.replies = [reply];
    const res = await photo(req(one()));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const out = await res.json();
    expect(out.source).toBe("photo");
    expect(out.unclear).toBe(1);
    const rows = out.review.sheets[0].rows;
    expect(rows[0].days[0][0].described).toBe("225 lb x 5, 235 lb x 5, 245 lb x 5");
    expect(rows[1].days[0][1].text).toBe(UNCLEAR_CELL);
    expect(rows[1].days[0][1].result.kind).toBe("unsure");
    expect(out.review.summary.unsure).toBe(1);
    expect(rows.map((r: any) => r.nameChanged)).toEqual([false, false]);
    expect(state.rpcCalls).toHaveLength(0);
    // one model call, as the coach, on the team sheet photo allowance, with the sheet's own names
    expect(state.calls).toHaveLength(1);
    expect(state.calls[0].meta).toEqual({ feature: "team_sheet_photo", userId: "coach-1" });
    expect(state.calls[0].system).toBe(TEAM_SHEET_PHOTO_PROMPT);
    expect(state.calls[0].userText).toContain("Back squat");
    expect(state.calls[0].image).toEqual({ mediaType: "image/jpeg", base64Data: IMG });
  });

  it("the names sent are the ones printed (the display name when there is one)", async () => {
    seed({ group_workout_exercises: { data: [gwe(1, "Back squat", "High-bar squat"), gwe(2, "Bench press")] } });
    state.replies = [reply.replace("Back squat", "High-bar squat")];
    const res = await photo(req(one()));
    expect(res.status).toBe(200);
    expect(state.calls[0].userText).toContain("High-bar squat");
  });

  it("a printed name that is not the athlete's in that row is flagged by the review's own name check (and starts left out)", async () => {
    state.replies = [reply.replace("Bo B.", "Cy C.")];
    const out = await (await photo(req(one()))).json();
    expect(out.review.sheets[0].rows[1].nameChanged).toBe(true);
  });

  it("only a coach of the group: not signed in 401, not a coach 403, no group 400; the model is never called", async () => {
    state.user = null;
    expect((await photo(req(one()))).status).toBe(401);
    state.user = { id: "u" };
    seed({ group_memberships: { data: { role: "athlete" } } });
    expect((await photo(req(one()))).status).toBe(403);
    seed();
    expect((await photo(req({ ...one(), groupId: "nope" }))).status).toBe(400);
    expect(state.calls).toHaveLength(0);
  });

  it("a sheet code for another group, a damaged code or none is refused before the model is called", async () => {
    const other = await photo(req(one({ codeText: codeText(uuid(2)) })));
    expect(other.status).toBe(422);
    expect((await other.json()).error).toMatch(/different group/);
    expect((await photo(req(one({ codeText: codeText().slice(0, -1) + "0" })))).status).toBe(422);
    const none = await photo(req(one({ codeText: "" })));
    expect(none.status).toBe(422);
    expect((await none.json()).error).toMatch(/bottom right corner/);
    expect(state.calls).toHaveLength(0);
  });

  it("an oversized image is refused (413), and so is a request too large to be photos at all; a wrong type or too many photos is 400", async () => {
    expect((await photo(req(one({ imageBase64: "a".repeat(MAX_IMAGE_BASE64_CHARS + 1) })))).status).toBe(413);
    expect((await photo(req("x".repeat(4 * (MAX_IMAGE_BASE64_CHARS + 4_000) + 10_001)))).status).toBe(413);
    expect((await photo(req(one({ mediaType: "image/gif" })))).status).toBe(400);
    expect((await photo(req({ groupId: G, photos: Array.from({ length: 5 }, () => one().photos[0]) }))).status).toBe(400);
    expect((await photo(req({ groupId: G, photos: [] }))).status).toBe(400);
    expect(state.calls).toHaveLength(0);
  });

  it("the AI allowance: a cap or burst refusal is 429 with its own words; AI not set up is 503; the route's own limit is 429", async () => {
    state.replies = [new AiRateLimitedError("monthly_ceiling", "team_sheet_photo", "You've used this month's sheet readings.")];
    const capped = await photo(req(one()));
    expect(capped.status).toBe(429);
    expect((await capped.json()).error).toBe("You've used this month's sheet readings.");
    state.aiOn = false;
    const off = await photo(req(one()));
    expect(off.status).toBe(503);
    expect((await off.json()).error).not.toMatch(/ANTHROPIC/);
    state.aiOn = true;
    state.limited = true;
    expect((await photo(req(one()))).status).toBe(429);
  });

  it("a reply that is not a reading, an error reply, or names that are not this sheet's is refused, never guessed", async () => {
    state.replies = ["not json at all"];
    expect((await photo(req(one()))).status).toBe(422);
    state.replies = [JSON.stringify({ error: "this is a menu" })];
    expect((await (await photo(req(one()))).json()).error).toMatch(/this is a menu/);
    state.replies = [reply.replace("Bench press", "Deadlift")];
    expect((await (await photo(req(one()))).json()).error).toMatch(/don't match the sheet/);
    state.replies = [new Error("network")];
    expect((await photo(req(one()))).status).toBe(502);
  });

  it("two photos of the same rack are one review; a box read differently on each is '?'", async () => {
    const half = (cols: string[], cells: (r: number) => any[]) => JSON.stringify({ columns: cols, rows: [0, 1].map((r) => ({ name: r === 0 ? "Ann A." : "Bo B.", cells: cells(r), notes: b("") })) });
    state.replies = [half(["Back squat", "Bench press"], (r) => [[b(r === 0 ? "225x5" : "300x5")], [b("185x5")]]), half(["Bench press"], (r) => [[b(r === 0 ? "195x5" : "185x5")]])];
    const res = await photo(req({ groupId: G, photos: [one().photos[0], one().photos[0]] }));
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out.review.sheets).toHaveLength(1);
    expect(out.review.sheets[0].rows[0].days[0][1].text).toBe(UNCLEAR_CELL);
    expect(out.review.sheets[0].rows[1].days[0][1].text).toBe("185x5");
    expect(state.calls).toHaveLength(2);
  });
});

describe("saving a sheet read from a photo", () => {
  const body = (source: string) => ({ groupId: G, source, replace: false, sheets: [{ code: codeText(), rows: [{ athleteId: uuid(11), cells: [["225x5", "185x5"]] }, { athleteId: uuid(12), cells: [["300x5", "?"]] }] }] });

  it("is recorded as a photo, and the '?' box saves nothing", async () => {
    state.rpcQueue = [{ data: { batch: uuid(70), saved: 2, kept: 0, replaced: 0, records: 0, skipped: [] }, error: null }];
    const res = await save(new Request("https://app.test/api/team-sheet/save", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body("photo")) }));
    expect(res.status).toBe(200);
    expect((await res.json()).droppedUnsure).toBe(1);
    expect(state.rpcCalls[0].args.p_source).toBe("photo");
    const bo = state.rpcCalls[0].args.p_rows.find((r: any) => r.athlete_id === uuid(12));
    expect(bo.exercises).toHaveLength(1);
  });

  it("before step 217 is applied the database refuses the source: the save says so, saves nothing, and never saves it as Excel instead", async () => {
    state.rpcQueue = [{ data: null, error: { message: "unknown source" } }];
    const res = await save(new Request("https://app.test/api/team-sheet/save", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body("photo")) }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/isn't switched on yet. Nothing was saved/);
    expect(state.rpcCalls).toHaveLength(1);
    expect(state.rpcCalls[0].args.p_source).toBe("photo");
  });

  it("an unknown source from the browser is still read as Excel (as before), and only csv and photo are anything else", async () => {
    state.rpcQueue = [{ data: { batch: uuid(70), saved: 2, kept: 0, replaced: 0, records: 0, skipped: [] }, error: null }];
    await save(new Request("https://app.test/api/team-sheet/save", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body("zip")) }));
    expect(state.rpcCalls[0].args.p_source).toBe("xlsx");
  });
});

describe("the screens", () => {
  const src = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
  it("the upload screen takes photos (any image, several, the camera or the gallery), reads the code in the browser first and says the photo goes to an outside AI service", () => {
    const c = src("components/coach/team-sheet-upload.tsx");
    expect(c).toContain('type="file" accept="image/*" multiple');
    expect(c).not.toContain("capture=");
    expect(c).toContain("readSheetCodeFromPhoto(files[i])");
    expect(c.indexOf("readSheetCodeFromPhoto(files[i])")).toBeLessThan(c.indexOf("resizePhoto(files[i])"));
    expect(c).toContain("/api/team-sheet/photo");
    expect(c).toContain("The photo is read by an outside AI service (Anthropic's Claude) to pull out the numbers.");
    expect(c).toContain("couldn't read with certainty");
    expect(c).toContain('data.source === "photo" ? "photo"');
  });

  it("a saved photo upload is listed as Photo", () => {
    expect(src("components/coach/team-sheet-saved-uploads.tsx")).toContain('u.source === "photo" ? "Photo"');
  });
});

describe("the beta notice", () => {
  it("says what a team sheet photo sends, and that the photo is not kept", async () => {
    const { BETA_NOTICE_PARAGRAPHS } = await import("@/lib/legal");
    const ai = BETA_NOTICE_PARAGRAPHS.find((p) => p.startsWith("AI is used.")) ?? "";
    expect(ai).toContain("When a coach reads a filled-in team sheet from a photo, the photo is sent as taken (the athletes' names as printed, first name and last initial, and what they wrote) with the sheet's exercise names; the photo is not kept.");
  });
});
