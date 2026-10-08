import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  AiRateLimitedError,
  burstBucketFor,
  burstLimitFor,
  monthlyCeilingFor,
  userMonthlyCeilingFor,
  currentAllowancePeriod,
  isEnforced,
  type AiCallMeta,
} from "@/lib/ai-usage";

// Server-only half of AI cost control (see lib/ai-usage.ts for the policy
// and pure helpers). Kept separate so client components that import
// constants never pull the service-role client into their bundle.

export interface UsageHandle {
  complete: (result: { model?: string; inputTokens?: number; outputTokens?: number; status: "ok" | "truncated" | "error"; errorClass?: string }) => Promise<void>;
}

const NOOP_HANDLE: UsageHandle = { complete: async () => {} };

// Reserves a log row at call START (atomically enforcing the burst limit
// and any monthly ceiling), so concurrent requests can't all slip past
// before any of them finish. Throws AiRateLimitedError when denied.
// For a metered (enforced) feature this fails CLOSED on infrastructure problems (no service key, DB error):
// if the limit cannot be checked, the call is refused rather than run unbounded. Free, system-run features
// (never limited) still fail open, so logging trouble never breaks them.
export async function reserveAiCall(meta: AiCallMeta): Promise<UsageHandle> {
  const enforced = isEnforced(meta.feature);
  let supabase;
  try {
    supabase = createServiceRoleClient();
  } catch {
    if (enforced) throw new AiRateLimitedError("unavailable");
    return NOOP_HANDLE;
  }
  try {
    // A per-person monthly ceiling (food photos and typed estimates): counted from the person's own log this month, every attempt included. Checked before the call is
    // reserved, so a person at their ceiling never reaches the model. If it cannot be counted the call is refused (fail closed), like the other metered limits.
    const personCeiling = userMonthlyCeilingFor(meta.feature);
    if (personCeiling != null && meta.userId) {
      const { count, error: countError } = await supabase
        .from("ai_usage_log")
        .select("id", { count: "exact", head: true })
        .eq("user_id", meta.userId)
        .eq("feature", meta.feature)
        .gte("created_at", `${currentAllowancePeriod()}T00:00:00Z`);
      if (countError) throw new AiRateLimitedError("unavailable");
      if ((count ?? 0) >= personCeiling) throw new AiRateLimitedError("user_monthly", meta.feature);
    }
    const { data, error } = await supabase.rpc("reserve_ai_call", {
      p_user_id: meta.userId ?? null,
      p_coach_id: meta.coachId ?? null,
      p_feature: meta.feature,
      p_enforce: isEnforced(meta.feature),
      p_burst_limit: burstLimitFor(meta.feature),
      p_burst_features: burstBucketFor(meta.feature),
      p_monthly_ceiling: monthlyCeilingFor(meta.feature),
    });
    if (error) {
      if (enforced) throw new AiRateLimitedError("unavailable");
      return NOOP_HANDLE;
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (row?.denied_reason) throw new AiRateLimitedError(row.denied_reason);
    const logId: string | undefined = row?.log_id;
    if (!logId) {
      if (enforced) throw new AiRateLimitedError("unavailable");
      return NOOP_HANDLE;
    }
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
        // Why it failed (ai_usage_log.error_class, 0292): a separate write, so a database that does not have the column yet still records status and time above.
        if (result.errorClass) {
          try {
            await supabase.from("ai_usage_log").update({ error_class: result.errorClass }).eq("id", logId);
          } catch {
            // best-effort
          }
        }
      },
    };
  } catch (err) {
    if (err instanceof AiRateLimitedError) throw err;
    if (enforced) throw new AiRateLimitedError("unavailable");
    return NOOP_HANDLE;
  }
}
