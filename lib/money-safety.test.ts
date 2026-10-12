import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");

describe("money safety", () => {
  const webhook = read("app/api/stripe/webhook/route.ts");
  it("the packages table is written by the server only", () => {
    const sql = read("supabase/migrations/0341_coach_packages_server_only.sql");
    for (const p of ["coach_packages_insert_coach", "coach_packages_update_coach", "coach_packages_delete_coach"]) {
      expect(sql).toContain(`drop policy if exists "${p}" on public.coach_packages;`);
    }
    // the app never writes the table from a browser: the packages route and the webhook use the service role
    const route = read("app/api/coach/packages/route.ts");
    expect(route).toContain("serviceRole");
    const code = route
      .split("\n")
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n");
    expect(code.match(/supabase\s*\.from\("coach_packages"\)\s*\.(insert|update|delete)/g)).toBeNull();
  });
  it("a renewal grants the credits the subscriber bought, written on the subscription at checkout", () => {
    const checkout = read("app/api/stripe/checkout/route.ts");
    expect(checkout.match(/credits: String\(pkg\.sessions_granted\)/g)?.length).toBe(3);
    expect(webhook).toContain("const boughtCredits = Number(subscription.metadata?.credits);");
    expect(webhook).toContain("Number.isInteger(boughtCredits) && boughtCredits > 0 ? boughtCredits : pkg.sessions_granted");
    expect(webhook).toContain("p_credits: renewalCredits,");
    expect(webhook).not.toContain("p_credits: pkg.sessions_granted,");
  });
  it("a failed subscription write is an error, so Stripe tries again", () => {
    expect(webhook).toContain("if (newSubscriptionError) throw newSubscriptionError;");
    expect(webhook).toContain("if (liftOffError) throw liftOffError;");
    expect(webhook).toContain("if (subscriptionUpsertError) throw subscriptionUpsertError;");
  });
  it("an event about an older subscription does not overwrite the current one", () => {
    expect(webhook).toContain("currentRow.stripe_subscription_id !== subscription.id && currentRow.status !== \"canceled\"");
    // checked before the write
    expect(webhook.indexOf("currentRow.stripe_subscription_id !== subscription.id")).toBeLessThan(webhook.indexOf("const { error: subscriptionUpsertError }"));
  });
});

describe("a coach's credit grants are recorded and added in one step", () => {
  const webhook = read("app/api/stripe/webhook/route.ts");
  it("the webhook uses the one-step functions, not a record followed by a separate add", () => {
    expect(webhook).toContain('supabase.rpc("grant_coach_credit_pack_once"');
    expect(webhook).toContain('supabase.rpc("grant_lift_off_credits_once"');
    expect(webhook).not.toContain('from("coach_credit_purchases").insert');
    expect(webhook).not.toContain('from("lift_off_credit_grants").insert');
  });
  it("the functions record and add inside one function, and only the server can run them", () => {
    const sql = read("supabase/migrations/0343_coach_credit_grants_once.sql");
    expect(sql.match(/perform public\.adjust_coach_credits/g)?.length).toBe(2);
    expect(sql).toContain("on conflict (stripe_event_id) do nothing");
    expect(sql).toContain("revoke execute on function public.grant_coach_credit_pack_once(text, text, uuid, integer, integer) from public, anon, authenticated;");
    expect(sql).toContain("grant execute on function public.grant_lift_off_credits_once(text, uuid, integer) to service_role;");
  });
});
