import { describe, it, expect, beforeAll } from "vitest";
import { confirmAction, proposeAction, undoAction } from "./assistant-actions-server";
import { signToken } from "./signed-token";

// A tiny in-memory stand-in for the coach's Supabase client: just the calls the action layer makes.
type Row = Record<string, any>;
function fakeSupabase(db: Record<string, Row[]>, opts: { denyOrgUpdate?: boolean } = {}) {
  const from = (table: string) => {
    const rows = (db[table] ??= []);
    const filters: [string, any][] = [];
    let pendingUpdate: Row | null = null;
    const match = () => rows.filter((r) => filters.every(([k, v]) => r[k] === v));
    const chain: any = {
      select: (cols?: string) => {
        if (pendingUpdate) {
          const hit = opts.denyOrgUpdate && table === "organizations" ? [] : match();
          hit.forEach((r) => Object.assign(r, pendingUpdate));
          pendingUpdate = null;
          return Promise.resolve({ data: hit.map((r) => ({ id: r.id })), error: null });
        }
        void cols;
        return chain;
      },
      eq: (k: string, v: any) => {
        filters.push([k, v]);
        return chain;
      },
      limit: () => chain,
      maybeSingle: () => Promise.resolve({ data: match()[0] ?? null, error: null }),
      update: (patch: Row) => {
        pendingUpdate = patch;
        return chain;
      },
      upsert: (row: Row) => {
        const existing = rows.find((r) => r.coach_id === row.coach_id);
        if (existing) Object.assign(existing, row);
        else rows.push({ ...row });
        return Promise.resolve({ error: null });
      },
      insert: (row: Row) => {
        rows.push({ ...row });
        return Promise.resolve({ error: null });
      },
      then: (resolve: any) => {
        if (pendingUpdate) {
          const hit = match();
          hit.forEach((r) => Object.assign(r, pendingUpdate));
          pendingUpdate = null;
          return resolve({ data: hit, error: null });
        }
        return resolve({ data: match(), error: null });
      },
    };
    return chain;
  };
  return { from } as any;
}

beforeAll(() => {
  process.env.SHARE_LINK_SECRET = "test-secret";
});

const COACH = "coach-1";

describe("expiry is not changed by chat", () => {
  it("is refused with where to do it, and nothing is read or written", async () => {
    const db: Record<string, Row[]> = { coach_booking_policies: [{ coach_id: COACH, credit_expiry_days: 180 }] };
    const res = await proposeAction(fakeSupabase(db), COACH, "set expiry to 18 days", null);
    expect(res && res.ok).toBe(false);
    if (res && !res.ok) expect(res.message).toMatch(/Settings/);
    expect(db.coach_booking_policies[0].credit_expiry_days).toBe(180);
  });
});

describe("which organization a word change is for", () => {
  const orgs = (roles: string[]) => ({
    organization_memberships: roles.map((role, i) => ({ profile_id: COACH, organization_id: "org" + i, role })),
    organizations: roles.map((_, i) => ({ id: "org" + i, name: "Org " + i, terminology_overrides: {} })),
  });
  it("asks when there is no page group and the coach runs more than one", async () => {
    const res = await proposeAction(fakeSupabase(orgs(["owner", "admin"])), COACH, "change clients to athletes", null);
    expect(res && res.ok).toBe(false);
    if (res && !res.ok) expect(res.message).toMatch(/more than one organization/);
  });
  it("uses the only organization the coach owns or administers, and never a plain-coach one", async () => {
    const res = await proposeAction(fakeSupabase(orgs(["coach", "owner"])), COACH, "change clients to athletes", null);
    expect(res && res.ok).toBe(true);
    if (res && res.ok) expect(res.card.title).toContain("Org 1");
    const none = await proposeAction(fakeSupabase(orgs(["coach"])), COACH, "change clients to athletes", null);
    expect(none && none.ok).toBe(false);
  });
});

describe("a settings change by chat", () => {
  it("refuses to write when the setting changed since the card, and a replayed confirm does nothing", async () => {
    const db: Record<string, Row[]> = { coach_booking_policies: [{ coach_id: COACH, buffer_minutes: 5 }] };
    const sb = fakeSupabase(db);
    const proposal = await proposeAction(sb, COACH, "set my buffer to 15 minutes", null);
    if (!proposal || !proposal.ok) throw new Error("no proposal");
    db.coach_booking_policies[0].buffer_minutes = 20;
    expect((await confirmAction(sb, COACH, proposal.card.token)).ok).toBe(false);
    expect(db.coach_booking_policies[0].buffer_minutes).toBe(20);
    db.coach_booking_policies[0].buffer_minutes = 5;
    expect((await confirmAction(sb, COACH, proposal.card.token)).ok).toBe(true);
    // An old card can never overwrite a later hand edit.
    db.coach_booking_policies[0].buffer_minutes = 40;
    expect((await confirmAction(sb, COACH, proposal.card.token)).ok).toBe(false);
    expect(db.coach_booking_policies[0].buffer_minutes).toBe(40);
  });

  it("a bigger gap carries a caution about repeating weekly sessions; a smaller one does not", async () => {
    const sb = fakeSupabase({ coach_booking_policies: [{ coach_id: COACH, buffer_minutes: 5 }] });
    const up = await proposeAction(sb, COACH, "set my buffer to 100 minutes", null);
    expect(up && up.ok && up.card.caution).toMatch(/repeating/);
    const down = await proposeAction(sb, COACH, "set my buffer to 0", null);
    expect(down && down.ok && down.card.caution).toBeUndefined();
  });

  it("free booking carries a plain caution on the card", async () => {
    const res = await proposeAction(fakeSupabase({ coach_booking_policies: [] }), COACH, "let clients book themselves", null);
    expect(res && res.ok).toBe(true);
    if (res && res.ok) expect(res.card.caution).toMatch(/book any open time/);
  });

  it("session length: changes every window, and undo gives each window its own old length back", async () => {
    const win = (id: string, minutes: number | null) => ({ id, coach_id: COACH, session_minutes: minutes, start_time: "06:00:00", end_time: "17:00:00" });
    const db: Record<string, Row[]> = { coach_availability_windows: [win("w1", null), win("w2", 45), win("w3", 60)] };
    const sb = fakeSupabase(db);
    const proposal = await proposeAction(sb, COACH, "set my session length to 55 minutes", null);
    if (!proposal || !proposal.ok) throw new Error("no proposal");
    expect(proposal.card.beforeText).toBe("different lengths on different days");
    const done = await confirmAction(sb, COACH, proposal.card.token);
    if (!done.ok || !done.undoToken) throw new Error("no undo");
    expect(db.coach_availability_windows.map((w) => w.session_minutes)).toEqual([55, 55, 55]);
    const undone = await undoAction(sb, COACH, done.undoToken);
    expect(undone.ok).toBe(true);
    expect(db.coach_availability_windows.map((w) => w.session_minutes)).toEqual([null, 45, 60]);
  });

  it("session length: the common case (all windows the same as the slot) undoes too, and a hand edit stops the undo", async () => {
    const win = (id: string, minutes: number | null) => ({ id, coach_id: COACH, session_minutes: minutes, start_time: "06:00:00", end_time: "17:00:00" });
    const db: Record<string, Row[]> = { coach_availability_windows: [win("w1", null), win("w2", null)] };
    const sb = fakeSupabase(db);
    const p = await proposeAction(sb, COACH, "set my session length to 55 minutes", null);
    if (!p || !p.ok) throw new Error("no proposal");
    const done = await confirmAction(sb, COACH, p.card.token);
    if (!done.ok || !done.undoToken) throw new Error("no undo");
    expect((await undoAction(sb, COACH, done.undoToken)).ok).toBe(true);
    expect(db.coach_availability_windows.map((w) => w.session_minutes)).toEqual([null, null]);

    const p2 = await proposeAction(sb, COACH, "set my session length to 50 minutes", null);
    if (!p2 || !p2.ok) throw new Error("no proposal");
    const d2 = await confirmAction(sb, COACH, p2.card.token);
    if (!d2.ok || !d2.undoToken) throw new Error("no undo");
    db.coach_availability_windows[0].session_minutes = 40;
    expect((await undoAction(sb, COACH, d2.undoToken)).ok).toBe(false);
    expect(db.coach_availability_windows[0].session_minutes).toBe(40);
  });

  it("session length is refused when a window is shorter than it", async () => {
    const db: Record<string, Row[]> = { coach_availability_windows: [{ id: "w1", coach_id: COACH, session_minutes: null, start_time: "06:00:00", end_time: "06:30:00" }] };
    const sb = fakeSupabase(db);
    const p = await proposeAction(sb, COACH, "set my session length to 55 minutes", null);
    if (!p || !p.ok) throw new Error("no proposal");
    const res = await confirmAction(sb, COACH, p.card.token);
    expect(res.ok).toBe(false);
    expect(db.coach_availability_windows[0].session_minutes).toBeNull();
  });

  it("shows what it is now and what it will be, and changes nothing yet", async () => {
    const db = { coach_booking_policies: [{ coach_id: COACH, buffer_minutes: 0 }] };
    const sb = fakeSupabase(db);
    const res = await proposeAction(sb, COACH, "set my buffer to 10 minutes", null);
    expect(res && res.ok).toBe(true);
    if (res && res.ok) {
      expect(res.card.afterText).toBe("10 minutes");
      expect(res.card.beforeText).toBe("0 minutes");
    }
    expect(db.coach_booking_policies[0].buffer_minutes).toBe(0);
  });

  it("is not a command when the message is a question or unrelated", async () => {
    const sb = fakeSupabase({ coach_booking_policies: [] });
    expect(await proposeAction(sb, COACH, "how do I change my buffer?", null)).toBeNull();
    expect(await proposeAction(sb, COACH, "open Johann's program", null)).toBeNull();
  });

  it("refuses a number outside the settings screen's limits before reading anything", async () => {
    const sb = fakeSupabase({});
    const res = await proposeAction(sb, COACH, "set my buffer to 999 minutes", null);
    expect(res && res.ok).toBe(false);
  });

  it("changes it on confirm with the token, records it, and undo puts it back", async () => {
    const db: Record<string, Row[]> = { coach_booking_policies: [{ coach_id: COACH, buffer_minutes: 5 }] };
    const sb = fakeSupabase(db);
    const proposal = await proposeAction(sb, COACH, "set my buffer to 15 minutes", null);
    if (!proposal || !proposal.ok) throw new Error("no proposal");
    const done = await confirmAction(sb, COACH, proposal.card.token);
    expect(done.ok).toBe(true);
    expect(db.coach_booking_policies[0].buffer_minutes).toBe(15);
    expect(db.spotter_recommendation_feedback).toHaveLength(1);
    expect(db.spotter_recommendation_feedback[0].spotter_kind).toBe("assistant_action");
    if (!done.ok || !done.undoToken) throw new Error("no undo");
    const undone = await undoAction(sb, COACH, done.undoToken);
    expect(undone.ok).toBe(true);
    expect(db.coach_booking_policies[0].buffer_minutes).toBe(5);
  });

  it("will not undo over a later change made by hand", async () => {
    const db: Record<string, Row[]> = { coach_booking_policies: [{ coach_id: COACH, buffer_minutes: 5 }] };
    const sb = fakeSupabase(db);
    const proposal = await proposeAction(sb, COACH, "set my buffer to 15 minutes", null);
    if (!proposal || !proposal.ok) throw new Error("no proposal");
    const done = await confirmAction(sb, COACH, proposal.card.token);
    if (!done.ok || !done.undoToken) throw new Error("no undo");
    db.coach_booking_policies[0].buffer_minutes = 30;
    const undone = await undoAction(sb, COACH, done.undoToken);
    expect(undone.ok).toBe(false);
    expect(db.coach_booking_policies[0].buffer_minutes).toBe(30);
  });

  it("a token is only good for the coach it was shown to, and a made-up token does nothing", async () => {
    const db: Record<string, Row[]> = { coach_booking_policies: [{ coach_id: COACH, buffer_minutes: 5 }] };
    const sb = fakeSupabase(db);
    const proposal = await proposeAction(sb, COACH, "set my buffer to 15 minutes", null);
    if (!proposal || !proposal.ok) throw new Error("no proposal");
    expect((await confirmAction(sb, "someone-else", proposal.card.token)).ok).toBe(false);
    expect((await confirmAction(sb, COACH, "not-a-token")).ok).toBe(false);
    expect((await confirmAction(sb, COACH, undefined)).ok).toBe(false);
    expect(db.coach_booking_policies[0].buffer_minutes).toBe(5);
  });

  it("an expired proposal is refused", async () => {
    const sb = fakeSupabase({ coach_booking_policies: [{ coach_id: COACH, buffer_minutes: 5 }] });
    const old = signToken(
      "assistant-action",
      { kind: "confirm", coachId: COACH, groupId: null, action: { id: "set_buffer", params: { amount: 15 } }, before: { amount: 5 } },
      600,
      Date.now() - 11 * 60 * 1000
    );
    expect((await confirmAction(sb, COACH, old)).ok).toBe(false);
  });

  it("a forged amount cannot get past the limits even with a valid signature shape", async () => {
    const db: Record<string, Row[]> = { coach_booking_policies: [{ coach_id: COACH, buffer_minutes: 5 }] };
    const sb = fakeSupabase(db);
    const token = signToken("assistant-action", { kind: "confirm", coachId: COACH, groupId: null, action: { id: "set_buffer", params: { amount: 9999 } }, before: { amount: 5 } }, 600);
    const res = await confirmAction(sb, COACH, token);
    expect(res.ok).toBe(false);
    expect(db.coach_booking_policies[0].buffer_minutes).toBe(5);
  });

  it("an undo token cannot be used as a confirm, and a confirm token cannot be used as an undo", async () => {
    const db: Record<string, Row[]> = { coach_booking_policies: [{ coach_id: COACH, buffer_minutes: 5 }] };
    const sb = fakeSupabase(db);
    const proposal = await proposeAction(sb, COACH, "set my buffer to 15 minutes", null);
    if (!proposal || !proposal.ok) throw new Error("no proposal");
    expect((await undoAction(sb, COACH, proposal.card.token)).ok).toBe(false);
    const done = await confirmAction(sb, COACH, proposal.card.token);
    if (!done.ok || !done.undoToken) throw new Error("no undo");
    expect((await confirmAction(sb, COACH, done.undoToken)).ok).toBe(false);
  });

  it("the word for clients: changes only when the database lets this coach, and says so when it does not", async () => {
    const mk = () => ({
      groups: [{ id: "g1", organization_id: "org1" }],
      organization_memberships: [{ profile_id: COACH, organization_id: "org1" }],
      organizations: [{ id: "org1", name: "Enduring Strength Co.", terminology_overrides: {} }],
    });
    const db: Record<string, Row[]> = mk();
    const sb = fakeSupabase(db);
    const proposal = await proposeAction(sb, COACH, "change clients to athletes", "g1");
    if (!proposal || !proposal.ok) throw new Error("no proposal");
    expect(proposal.card.title).toBe('Change the word "clients" to "athletes" in Enduring Strength Co.?');
    const done = await confirmAction(sb, COACH, proposal.card.token);
    expect(done.ok).toBe(true);
    expect(db.organizations[0].terminology_overrides.client).toEqual({ kind: "preset", value: "athlete" });
    if (done.ok) expect(done.reload).toBe(true);

    const db2: Record<string, Row[]> = mk();
    const sb2 = fakeSupabase(db2, { denyOrgUpdate: true });
    const p2 = await proposeAction(sb2, COACH, "change clients to athletes", "g1");
    if (!p2 || !p2.ok) throw new Error("no proposal");
    const denied = await confirmAction(sb2, COACH, p2.card.token);
    expect(denied.ok).toBe(false);
    expect(db2.organizations[0].terminology_overrides).toEqual({});
  });
});
