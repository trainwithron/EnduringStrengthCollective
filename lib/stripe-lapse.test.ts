import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { endsGroupAccess, storedSubscriptionStatus } from "@/lib/subscription-status";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");

describe("when a subscription lapses", () => {
  it("canceled, unpaid and a first payment that never completed are lapsed (stored as canceled); past_due is a grace period", () => {
    for (const s of ["canceled", "unpaid", "incomplete_expired"]) expect(storedSubscriptionStatus("customer.subscription.updated", s)).toBe("canceled");
    expect(storedSubscriptionStatus("customer.subscription.updated", "past_due")).toBe("past_due");
    expect(storedSubscriptionStatus("customer.subscription.updated", "active")).toBe("active");
    expect(storedSubscriptionStatus("customer.subscription.updated", "incomplete")).toBe("incomplete");
    expect(storedSubscriptionStatus("customer.subscription.paused", "paused")).toBe("paused");
    expect(storedSubscriptionStatus("customer.subscription.deleted", "active")).toBe("canceled");
  });
  it("a status this app does not model leaves the row alone", () => {
    expect(storedSubscriptionStatus("customer.subscription.updated", "trialing")).toBeNull();
  });
  it("only a lapse takes the group access away, never the grace period", () => {
    expect(endsGroupAccess("canceled")).toBe(true);
    for (const s of ["active", "past_due", "incomplete", "paused"] as const) expect(endsGroupAccess(s)).toBe(false);
  });
});

describe("the payment webhook", () => {
  const hook = read("app/api/stripe/webhook/route.ts");
  it("records the event and grants the sessions in one database step, for packs and for renewals", () => {
    expect(hook).toContain('supabase.rpc("grant_purchase_once"');
    expect(hook).toContain('supabase.rpc("grant_subscription_credits_once"');
    // the old two-step pattern (write the record, then grant) is gone
    expect(hook).not.toContain('supabase.from("credit_purchases").insert');
    expect(hook).not.toContain('supabase.from("subscription_credit_grants").insert');
  });
  it("a one-time pack needs a settled payment, and a delayed payment that settles later is handled the same way", () => {
    expect(hook).toContain('if (session.payment_status !== "paid") break;');
    expect(hook).toContain('case "checkout.session.async_payment_succeeded":');
  });
  it("a paid invoice gives the group access back, and the outside notice is sent only once per event", () => {
    expect(hook).toContain("A paid invoice gives back the group access");
    expect(hook).toContain("if (granted === true) {");
    expect(hook).toContain("if (renewalGranted === true) {");
  });
  it("a retried payment never copies the linked program twice", () => {
    expect(hook).toContain("athleteHasCopyOfProgram(supabase");
    expect(hook).toContain('.neq("stripe_event_id", event.id)');
  });
});

describe("the one-database-step functions (migration 0331)", () => {
  const sql = read("supabase/migrations/0331_purchase_grants_once.sql");
  it("write the record and grant the sessions in the same function, server only", () => {
    expect(sql).toContain("insert into public.credit_purchases");
    expect(sql).toContain("insert into public.subscription_credit_grants");
    expect(sql.match(/perform public\.grant_session_credits/g)?.length).toBe(2);
    expect(sql).toContain("exception when unique_violation then");
    expect(sql).toContain("to service_role");
    expect(sql).toContain("from public, anon, authenticated");
  });
});

describe("assigning a package by hand", () => {
  const route = read("app/api/coach/package-assignments/route.ts");
  it("copies the linked program only the first time", () => {
    expect(route).toContain("!!existingAssignment || (await athleteHasCopyOfProgram(");
    expect(route).toContain("if (pkg.default_program_id && !alreadyHasProgram) {");
  });
});
