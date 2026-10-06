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
      then: (resolve: any) => resolve({ data: match(), error: null }),
    };
    return chain;
  };
  return { from } as any;
}

beforeAll(() => {
  process.env.SHARE_LINK_SECRET = "test-secret";
});

const COACH = "coach-1";

describe("a settings change by chat", () => {
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
      organizations: [{ id: "org1", terminology_overrides: {} }],
    });
    const db: Record<string, Row[]> = mk();
    const sb = fakeSupabase(db);
    const proposal = await proposeAction(sb, COACH, "change clients to athletes", "g1");
    if (!proposal || !proposal.ok) throw new Error("no proposal");
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
