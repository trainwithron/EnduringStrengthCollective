import { beforeEach, describe, expect, it, vi } from "vitest";

// The refund route with fakes: the signed-in coach's database function is only ever asked for their own flag; the automatic refund runs the server-only
// function, and only when the server's own record shows the AI delivered nothing since the charge.
const state = vi.hoisted(() => ({
  user: { id: "coach-1" } as { id: string } | null,
  charge: { id: "c1", created_at: "2026-10-07T12:00:00Z" } as { id: string; created_at: string } | null,
  delivered: 0,
  userRpcCalls: [] as { fn: string; args: Record<string, unknown> }[],
  serviceRpcCalls: [] as { fn: string; args: Record<string, unknown> }[],
  chargeQuery: [] as string[],
  rpcError: null as { code: string; message: string } | null,
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      state.userRpcCalls.push({ fn, args });
      return state.rpcError ? { data: null, error: state.rpcError } : { data: true, error: null };
    },
  }),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      for (const m of ["select", "eq", "is", "gt", "gte", "order", "limit"]) {
        chain[m] = (...a: unknown[]) => {
          state.chargeQuery.push(`${table}.${m}(${a.map(String).join(",")})`);
          return self();
        };
      }
      chain.maybeSingle = async () => ({ data: table === "ai_charges" ? state.charge : null, error: null });
      // the delivered-count query ends on the builder itself (a head count)
      (chain as { then?: unknown }).then = (resolve: (v: unknown) => void) => resolve({ count: table === "ai_usage_log" ? state.delivered : 0, error: null });
      return chain;
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      state.serviceRpcCalls.push({ fn, args });
      return { data: true, error: null };
    },
  }),
}));

const post = async (body: unknown) => {
  const { POST } = await import("./route");
  return POST(new Request("https://app.test/api/ai/refund-credit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
};

beforeEach(() => {
  state.user = { id: "coach-1" };
  state.charge = { id: "c1", created_at: "2026-10-07T12:00:00Z" };
  state.delivered = 0;
  state.userRpcCalls = [];
  state.serviceRpcCalls = [];
  state.chargeQuery = [];
  state.rpcError = null;
});

describe("the AI refund route", () => {
  it("needs a signed-in user", async () => {
    state.user = null;
    expect((await post({ action: "nutrition_plan", trigger: "coach_flagged", referenceId: "r1" })).status).toBe(401);
  });

  it("the coach's own 'This was wrong' goes through the signed-in database function with the coach_flagged trigger only", async () => {
    const res = await post({ action: "nutrition_plan", trigger: "coach_flagged", referenceId: "r1" });
    expect(res.status).toBe(200);
    expect(state.userRpcCalls).toEqual([{ fn: "refund_coach_credit", args: { p_action: "nutrition_plan", p_trigger: "coach_flagged", p_reference_id: "r1" } }]);
    expect(state.serviceRpcCalls).toEqual([]);
  });

  it("an unknown trigger is refused and nothing is called", async () => {
    const res = await post({ action: "nutrition_plan", trigger: "anything", referenceId: "r1" });
    expect(res.status).toBe(400);
    expect(state.userRpcCalls).toEqual([]);
    expect(state.serviceRpcCalls).toEqual([]);
  });

  it("an automatic refund after the AI delivered suggestions is refused: a coach cannot keep the plan and take the credit back", async () => {
    state.delivered = 3;
    const res = await post({ action: "nutrition_plan", trigger: "auto_validator_failure", referenceId: "r2" });
    expect(res.status).toBe(409);
    expect((await res.json()).refunded).toBe(false);
    expect(state.userRpcCalls).toEqual([]);
    expect(state.serviceRpcCalls).toEqual([]);
  });

  it("an automatic refund when nothing was delivered runs the server-only function for the signed-in coach, never the browser one", async () => {
    state.delivered = 0;
    const res = await post({ action: "nutrition_plan", trigger: "auto_validator_failure", referenceId: "r3" });
    expect(res.status).toBe(200);
    expect(state.serviceRpcCalls).toEqual([
      { fn: "refund_coach_credit_for", args: { p_coach_id: "coach-1", p_action: "nutrition_plan", p_trigger: "auto_validator_failure", p_reference_id: "r3", p_charge_id: "c1" } },
    ]);
    expect(state.userRpcCalls).toEqual([]);
  });

  it("the delivered count only looks at this coach's rows made since the charge", async () => {
    await post({ action: "nutrition_plan", trigger: "auto_validator_failure", referenceId: "r4" });
    const q = state.chargeQuery.join(" | ");
    expect(q).toContain("ai_usage_log.eq(user_id,coach-1)");
    expect(q).toContain("ai_usage_log.eq(feature,meal_plan_slot_delivered)");
    // deliveries count from 30 minutes BEFORE the charge as well as after it (generate first, charge afterwards)
    expect(q).toContain("ai_usage_log.gte(created_at,2026-10-07T11:30:00.000Z)");
  });

  it("with no charge to refund the answer is simply 'not refunded' and nothing is called", async () => {
    state.charge = null;
    const res = await post({ action: "nutrition_plan", trigger: "auto_validator_failure", referenceId: "r5" });
    expect(res.status).toBe(200);
    expect((await res.json()).refunded).toBe(false);
    expect(state.serviceRpcCalls).toEqual([]);
  });

  it("a program generation has no automatic refund at all", async () => {
    const res = await post({ action: "program_generation", trigger: "auto_validator_failure", referenceId: "r6" });
    expect(res.status).toBe(400);
    expect(state.serviceRpcCalls).toEqual([]);
  });

  it("an unknown action is a clean 400, not a database error", async () => {
    expect((await post({ action: "ci_overview", trigger: "coach_flagged", referenceId: "r7" })).status).toBe(400);
    expect(state.userRpcCalls).toEqual([]);
  });

  it("a second refund with the same reference (the database refuses it) is just 'not refunded'", async () => {
    state.rpcError = { code: "23505", message: "duplicate key value violates unique constraint" };
    const res = await post({ action: "nutrition_plan", trigger: "coach_flagged", referenceId: "r8" });
    expect(res.status).toBe(200);
    expect((await res.json()).refunded).toBe(false);
  });

  it("missing fields are refused", async () => {
    expect((await post({ action: "nutrition_plan" })).status).toBe(400);
  });
});
