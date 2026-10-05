import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  AiRateLimitedError,
  burstBucketFor,
  burstLimitFor,
  monthlyCeilingFor,
  isEnforced,
  type AiCallMeta,
} from "@/lib/ai-usage";

// Server-only half of AI cost control (see lib/ai-usage.ts for the policy
// and pure helpers). Kept separate so client components that import
// constants never pull the service-role client into their bundle.

export interface UsageHandle {
  complete: (result: { model?: string; inputTokens?: number; outputTokens?: number; status: "ok" | "truncated" | "error" }) => Promise<void>;
}

const NOOP_HANDLE: UsageHandle = { complete: async () => {} };

// Reserves a log row at call START (atomically enforcing the burst limit
// and any monthly ceiling), so concurrent requests can't all slip past
// before any of them finish. Throws AiRateLimitedError when denied.
// Fails OPEN on infrastructure problems (no service key, DB error): cost
// logging must never be the reason a coach's request breaks.
export async function reserveAiCall(meta: AiCallMeta): Promise<UsageHandle> {
  let supabase;
  try {
    supabase = createServiceRoleClient();
  } catch {
    return NOOP_HANDLE;
  }
  try {
    const { data, error } = await supabase.rpc("reserve_ai_call", {
      p_user_id: meta.userId ?? null,
      p_coach_id: meta.coachId ?? null,
      p_feature: meta.feature,
      p_enforce: isEnforced(meta.feature),
      p_burst_limit: burstLimitFor(meta.feature),
      p_burst_features: burstBucketFor(meta.feature),
      p_monthly_ceiling: monthlyCeilingFor(meta.feature),
    });
    if (error) return NOOP_HANDLE;
    const row = Array.isArray(data) ? data[0] : data;
    if (row?.denied_reason) throw new AiRateLimitedError(row.denied_reason);
    const logId: string | undefined = row?.log_id;
    if (!logId) return NOOP_HANDLE;
    return {
      complete: async (result) => {
        try {
          await supabase
            .from("ai_usage_log")
            .update({
              model: result.model ?? null,
              input_tokens: result.inputTokens ?? null,
              output_tokens: result.outputTokens ?? null,
              status: result.status,
              completed_at: new Date().toISOString(),
            })
            .eq("id", logId);
        } catch {
          // logging is best-effort
        }
      },
    };
  } catch (err) {
    if (err instanceof AiRateLimitedError) throw err;
    return NOOP_HANDLE;
  }
}
